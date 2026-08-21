import { createHash, timingSafeEqual } from "node:crypto";

function safeEqual(left, right) {
  const leftHash = createHash("sha256").update(String(left)).digest();
  const rightHash = createHash("sha256").update(String(right)).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function parseAuthorization(value) {
  if (typeof value !== "string" || !value.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(value.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export function basicAuthConfigFromEnv(env = process.env) {
  return {
    enabled: String(env.APP_BASIC_AUTH_ENABLED || "false").toLowerCase() === "true",
    username: env.APP_BASIC_AUTH_USERNAME,
    password: env.APP_BASIC_AUTH_PASSWORD,
  };
}

export function createBasicAuthMiddleware(config = basicAuthConfigFromEnv()) {
  if (!config.enabled) return (req, res, next) => next();

  const username = String(config.username || "").trim();
  const password = String(config.password || "");
  if (!username || username.includes(":")) throw new Error("APP_BASIC_AUTH_USERNAMEを確認してください。");
  if (password.length < 16) throw new Error("APP_BASIC_AUTH_PASSWORDは16文字以上で設定してください。");

  return (req, res, next) => {
    const credentials = parseAuthorization(req.headers.authorization);
    if (credentials && safeEqual(credentials.username, username) && safeEqual(credentials.password, password)) {
      req.basicAuthUser = username;
      next();
      return;
    }

    res.setHeader("WWW-Authenticate", 'Basic realm="SEO PULSE", charset="UTF-8"');
    res.setHeader("Cache-Control", "no-store");
    res.status(401).json({ error: "認証が必要です。", code: "AUTH_REQUIRED" });
  };
}
