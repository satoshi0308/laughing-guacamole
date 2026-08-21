import http from "node:http";
import https from "node:https";
import net from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { normalizeTargetUrl, resolvePublicAddresses, TargetUrlError } from "./security.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 12000);
const DEFAULT_MAX_BYTES = Number(process.env.AUDIT_MAX_BYTES || 2_097_152);
const USER_AGENT =
  "Mozilla/5.0 (compatible; SEO-PULSE/1.0; +https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers)";

export class FetchError extends Error {
  constructor(message, code = "FETCH_FAILED", details = {}) {
    super(message);
    this.name = "FetchError";
    this.code = code;
    this.details = details;
  }
}

function decodeBody(buffer, encoding, maxBytes) {
  const normalized = String(encoding || "").toLowerCase();
  try {
    if (normalized.includes("br")) return brotliDecompressSync(buffer, { maxOutputLength: maxBytes });
    if (normalized.includes("gzip")) return gunzipSync(buffer, { maxOutputLength: maxBytes });
    if (normalized.includes("deflate")) return inflateSync(buffer, { maxOutputLength: maxBytes });
    return buffer;
  } catch {
    throw new FetchError("ページの圧縮データを読み取れませんでした。", "DECODE_FAILED");
  }
}

function decodeText(buffer, headers) {
  const contentType = String(headers["content-type"] || "");
  const headerCharset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
  const bomCharset =
    buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
      ? "utf-8"
      : buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe
        ? "utf-16le"
        : buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff
          ? "utf-16be"
          : "";
  const head = buffer.subarray(0, 4096).toString("latin1");
  const metaCharset =
    head.match(/<meta[^>]+charset\s*=\s*["']?([^\s"'/>]+)/i)?.[1] ||
    head.match(/<meta[^>]+content=["'][^"']*charset\s*=\s*([^;\s"']+)/i)?.[1];
  const requested = String(headerCharset || bomCharset || metaCharset || "utf-8")
    .trim()
    .toLowerCase();
  const aliases = {
    sjis: "shift_jis",
    "shift-jis": "shift_jis",
    "windows-31j": "shift_jis",
    "x-sjis": "shift_jis",
    eucjp: "euc-jp",
    utf8: "utf-8",
  };

  try {
    return new TextDecoder(aliases[requested] || requested).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function publicFetchError(error, fallbackMessage = "ページを取得できませんでした。") {
  if (error instanceof FetchError || error instanceof TargetUrlError) return error;
  const networkCode = typeof error?.code === "string" ? error.code : "NETWORK_ERROR";
  const tlsFailure = /^(CERT_|ERR_TLS_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_)/.test(networkCode);
  return new FetchError(
    tlsFailure ? "ページとの安全な接続を確認できませんでした。" : fallbackMessage,
    tlsFailure ? "TLS_ERROR" : "FETCH_FAILED",
    { networkCode }
  );
}

function requestAddress(url, record, options) {
  const client = url.protocol === "https:" ? https : http;
  const defaultPort = url.protocol === "https:" ? 443 : 80;
  const targetHostname = url.hostname.replace(/^\[|\]$/g, "");

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseRef = null;
    let deadlineTimer;

    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      handler(value);
    };
    const fail = (error, fallbackMessage) => settle(reject, publicFetchError(error, fallbackMessage));

    const request = client.request(
      {
        protocol: url.protocol,
        hostname: record.address,
        family: record.family,
        port: Number(url.port || defaultPort),
        servername: net.isIP(targetHostname) ? undefined : targetHostname,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        headers: {
          Host: url.host,
          "User-Agent": USER_AGENT,
          Accept: options.accept,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "ja,en;q=0.8",
          Connection: "close",
        },
      },
      (response) => {
        responseRef = response;
        const chunks = [];
        let byteLength = 0;

        const failResponse = (error, fallbackMessage) => {
          fail(error, fallbackMessage);
          response.destroy();
          request.destroy();
        };

        response.on("data", (chunk) => {
          byteLength += chunk.length;
          if (byteLength > options.maxBytes) {
            failResponse(new FetchError("ページ容量が診断上限を超えました。", "RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });

        response.on("aborted", () => {
          failResponse(new FetchError("ページの応答が途中で切断されました。", "INCOMPLETE_RESPONSE"));
        });
        response.on("error", (error) => {
          failResponse(error, "ページの応答を最後まで受信できませんでした。");
        });
        response.on("close", () => {
          if (!response.complete && !settled) {
            failResponse(new FetchError("ページの応答が途中で切断されました。", "INCOMPLETE_RESPONSE"));
          }
        });

        response.on("end", () => {
          if (settled) return;
          const raw = Buffer.concat(chunks);
          let body;
          try {
            body = decodeBody(raw, response.headers["content-encoding"], options.maxBytes);
          } catch (error) {
            fail(error);
            return;
          }
          if (body.length > options.maxBytes) {
            fail(new FetchError("ページ容量が診断上限を超えました。", "RESPONSE_TOO_LARGE"));
            return;
          }
          settle(resolve, { status: response.statusCode || 0, headers: response.headers, body });
        });
      }
    );

    deadlineTimer = setTimeout(() => {
      const error = new FetchError("ページから時間内に応答がありませんでした。", "TIMEOUT");
      settle(reject, error);
      responseRef?.destroy();
      request.destroy();
    }, options.timeoutMs);
    request.on("error", (error) => fail(error));
    request.end();
  });
}

async function resolveBeforeDeadline(hostname, deadline) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new FetchError("ページから時間内に応答がありませんでした。", "TIMEOUT");

  let timer;
  try {
    return await Promise.race([
      resolvePublicAddresses(hostname),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new FetchError("ドメイン名の解決が時間内に完了しませんでした。", "TIMEOUT")),
          remainingMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function requestOnce(url, options, deadline) {
  const addresses = await resolveBeforeDeadline(url.hostname, deadline);
  let lastError;
  for (const record of addresses.slice(0, 4)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new FetchError("ページから時間内に応答がありませんでした。", "TIMEOUT");
    }
    try {
      return await requestAddress(url, record, { ...options, timeoutMs: remainingMs });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new FetchError("ページを取得できませんでした。");
}

export async function safeFetchText(input, customOptions = {}) {
  const options = {
    timeoutMs: customOptions.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxBytes: customOptions.maxBytes || DEFAULT_MAX_BYTES,
    maxRedirects: customOptions.maxRedirects ?? 5,
    accept: customOptions.accept || "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.7,*/*;q=0.1",
  };

  let current = normalizeTargetUrl(input);
  const redirects = [];
  const deadline = Math.min(customOptions.deadline || Number.POSITIVE_INFINITY, Date.now() + options.timeoutMs);

  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    const response = await requestOnce(current, options, deadline);
    const location = response.headers.location;
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      if (hop === options.maxRedirects) {
        throw new FetchError("リダイレクト回数が上限を超えました。", "TOO_MANY_REDIRECTS", {
          redirects,
        });
      }
      let next;
      try {
        next = normalizeTargetUrl(new URL(location, current).toString());
      } catch (error) {
        if (error instanceof TargetUrlError) throw error;
        throw new FetchError("リダイレクト先URLを解釈できません。", "INVALID_REDIRECT");
      }
      redirects.push({ from: current.toString(), to: next.toString(), status: response.status });
      current = next;
      continue;
    }

    return {
      requestedUrl: normalizeTargetUrl(input).toString(),
      finalUrl: current.toString(),
      status: response.status,
      headers: response.headers,
      text: decodeText(response.body, response.headers),
      byteLength: response.body.length,
      redirects,
    };
  }

  throw new FetchError("ページを取得できませんでした。");
}
