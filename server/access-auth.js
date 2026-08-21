import { createRemoteJWKSet, jwtVerify } from "jose";

function normalizeTeamDomain(value) {
  const input = String(value || "").trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("CF_ACCESS_TEAM_DOMAINを確認してください。");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".cloudflareaccess.com") ||
    url.hostname === "cloudflareaccess.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("CF_ACCESS_TEAM_DOMAINはhttps://<team>.cloudflareaccess.com形式で指定してください。");
  }
  return url.origin;
}

function parseAllowedEmails(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function accessConfigFromEnv(env = process.env) {
  return {
    enabled: String(env.CF_ACCESS_ENABLED || "false").toLowerCase() === "true",
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    audience: env.CF_ACCESS_AUD,
    allowedEmails: env.CF_ACCESS_ALLOWED_EMAILS,
  };
}

export function createCloudflareAccessMiddleware(config = accessConfigFromEnv(), dependencies = {}) {
  if (!config.enabled) return (req, res, next) => next();

  const teamDomain = normalizeTeamDomain(config.teamDomain);
  const audience = String(config.audience || "").trim();
  const allowedEmails = parseAllowedEmails(config.allowedEmails);
  if (!audience) throw new Error("CF_ACCESS_AUDが未設定です。");
  if (allowedEmails.size === 0) throw new Error("CF_ACCESS_ALLOWED_EMAILSが未設定です。");

  let verifyAssertion = dependencies.verifyAssertion;
  if (!verifyAssertion) {
    const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
    });
    verifyAssertion = (token) =>
      jwtVerify(token, jwks, {
        issuer: teamDomain,
        audience,
        algorithms: ["RS256"],
      });
  }

  return async (req, res, next) => {
    const token = req.headers["cf-access-jwt-assertion"];
    if (typeof token !== "string" || !token) {
      res.setHeader("Cache-Control", "no-store");
      res.status(403).json({ error: "アクセスが許可されていません。", code: "ACCESS_TOKEN_REQUIRED" });
      return;
    }

    try {
      const { payload } = await verifyAssertion(token);
      const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
      if (payload.type !== "app" || !allowedEmails.has(email)) {
        res.setHeader("Cache-Control", "no-store");
        res.status(403).json({ error: "アクセスが許可されていません。", code: "ACCESS_DENIED" });
        return;
      }
      req.accessUser = { email, sub: typeof payload.sub === "string" ? payload.sub : "" };
      next();
    } catch {
      res.setHeader("Cache-Control", "no-store");
      res.status(403).json({ error: "アクセスが許可されていません。", code: "ACCESS_TOKEN_INVALID" });
    }
  };
}
