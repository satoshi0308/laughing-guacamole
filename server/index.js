import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPage } from "./rules.js";
import { safeFetchText, FetchError } from "./fetch-page.js";
import { getSources } from "./sources.js";
import { TargetUrlError } from "./security.js";
import { createCloudflareAccessMiddleware } from "./access-auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8787);
const auditDeadlineMs = Number(process.env.AUDIT_TOTAL_TIMEOUT_MS || 18_000);
const maxConcurrentAudits = Number(process.env.AUDIT_MAX_CONCURRENT || 4);
const auditRateLimit = Number(process.env.AUDIT_RATE_LIMIT || 30);
const auditRateWindowMs = Number(process.env.AUDIT_RATE_WINDOW_MS || 60_000);
const cloudflareAccess = createCloudflareAccessMiddleware();
const app = express();
const auditWindows = new Map();
let activeAudits = 0;

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "SEO PULSE", version: "1.0.0" });
});

app.use(cloudflareAccess);
app.use(express.json({ limit: "12kb" }));

app.get("/api/sources", (req, res) => {
  res.json({ sources: getSources() });
});

function admitAudit(req, res, next) {
  const now = Date.now();
  const client = req.accessUser?.email || req.socket.remoteAddress || "unknown";
  const current = auditWindows.get(client);
  const window = !current || current.resetAt <= now ? { count: 0, resetAt: now + auditRateWindowMs } : current;

  if (window.count >= auditRateLimit) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((window.resetAt - now) / 1000))));
    res.status(429).json({ error: "診断回数が上限に達しました。少し待ってから再試行してください。", code: "RATE_LIMITED" });
    return;
  }
  if (activeAudits >= maxConcurrentAudits) {
    res.setHeader("Retry-After", "2");
    res.status(429).json({ error: "診断が混み合っています。少し待ってから再試行してください。", code: "BUSY" });
    return;
  }

  window.count += 1;
  auditWindows.set(client, window);
  if (auditWindows.size > 1000) {
    for (const [key, value] of auditWindows) {
      if (value.resetAt <= now) auditWindows.delete(key);
    }
  }

  activeAudits += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeAudits = Math.max(0, activeAudits - 1);
  };
  res.locals.releaseAudit = release;
  next();
}

app.post("/api/audit", admitAudit, async (req, res, next) => {
  try {
    const input = String(req.body?.url || "").trim();
    if (input.length > 2048) {
      res.status(400).json({ error: "URLが長すぎます。", code: "INVALID_URL" });
      return;
    }

    const deadline = Date.now() + auditDeadlineMs;
    const page = await safeFetchText(input, { deadline });
    const contentType = String(page.headers["content-type"] || "").toLowerCase();
    const looksLikeHtml = /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i.test(page.text.slice(0, 2000));
    if (page.status === 200 && !contentType.includes("text/html") && !looksLikeHtml) {
      res.status(415).json({
        error: "HTMLページを取得できませんでした。公開中のWebページURLを入力してください。",
        code: "NOT_HTML",
        details: { status: page.status, contentType: contentType || "不明" },
      });
      return;
    }

    let robotsResult = null;
    if (page.status === 200) {
      const robotsUrl = new URL("/robots.txt", page.finalUrl).toString();
      try {
        robotsResult = await safeFetchText(robotsUrl, {
          maxBytes: 512_000,
          timeoutMs: 7000,
          maxRedirects: 3,
          accept: "text/plain,*/*;q=0.2",
          deadline,
        });
      } catch (error) {
        robotsResult = { error: error.message, code: error.code, status: 0, text: "" };
      }
    }

    res.json({ report: auditPage(page, robotsResult) });
  } catch (error) {
    next(error);
  } finally {
    res.locals.releaseAudit?.();
  }
});

app.use(express.static(dist, { index: false, maxAge: "1h" }));
app.get("*splat", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "APIが見つかりません。", code: "NOT_FOUND" });
    return;
  }
  res.sendFile(path.join(dist, "index.html"), (error) => {
    if (error) next(error);
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof TargetUrlError) {
    res.status(error.code === "DNS_ERROR" ? 502 : 400).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof FetchError) {
    const status = ["TIMEOUT", "DNS_ERROR"].includes(error.code) ? 504 : 502;
    res.status(status).json({ error: error.message, code: error.code, details: error.details });
    return;
  }
  if (error?.type === "entity.parse.failed") {
    res.status(400).json({ error: "リクエスト形式を確認してください。", code: "INVALID_JSON" });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "診断中に予期しないエラーが発生しました。", code: "INTERNAL_ERROR" });
});

app.listen(port, host, () => {
  console.log(`SEO PULSE: http://${host}:${port}`);
});
