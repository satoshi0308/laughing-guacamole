import dns from "node:dns/promises";
import net from "node:net";
import ipaddr from "ipaddr.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443"]);

export class TargetUrlError extends Error {
  constructor(message, code = "INVALID_URL") {
    super(message);
    this.name = "TargetUrlError";
    this.code = code;
  }
}

export function normalizeTargetUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new TargetUrlError("URLを入力してください。");

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new TargetUrlError("URLの形式を確認してください。");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new TargetUrlError("httpまたはhttpsのURLを入力してください。");
  }
  if (url.username || url.password) {
    throw new TargetUrlError("認証情報を含むURLは診断できません。");
  }
  if (!url.hostname || url.hostname.length > 253) {
    throw new TargetUrlError("ホスト名を確認してください。");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new TargetUrlError("診断できるポートは80と443です。", "PORT_NOT_ALLOWED");
  }

  url.hash = "";
  return url;
}

const BLOCKED_IPV4_RANGES = [ipaddr.parseCIDR("198.18.0.0/15")];
const GLOBAL_IPV6_RANGE = ipaddr.parseCIDR("2000::/3");
const BLOCKED_IPV6_RANGES = [
  ipaddr.parseCIDR("64:ff9b:1::/48"),
  ipaddr.parseCIDR("100::/64"),
  ipaddr.parseCIDR("2001::/23"),
  ipaddr.parseCIDR("2002::/16"),
  ipaddr.parseCIDR("3fff::/20"),
  ipaddr.parseCIDR("5f00::/16"),
  ipaddr.parseCIDR("fec0::/10"),
];

function stripIpv6Brackets(value) {
  const address = String(value || "").trim().split("%")[0];
  return address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
}

export function isPublicAddress(address) {
  const normalized = stripIpv6Brackets(address);
  if (!ipaddr.isValid(normalized)) return false;

  const parsed = ipaddr.parse(normalized);
  if (parsed.kind() === "ipv4") {
    return parsed.range() === "unicast" && !BLOCKED_IPV4_RANGES.some((range) => parsed.match(range));
  }

  if (parsed.isIPv4MappedAddress()) return isPublicAddress(parsed.toIPv4Address().toString());
  return (
    parsed.range() === "unicast" &&
    parsed.match(GLOBAL_IPV6_RANGE) &&
    !BLOCKED_IPV6_RANGES.some((range) => parsed.match(range))
  );
}

export async function resolvePublicAddresses(hostname) {
  const normalizedHostname = stripIpv6Brackets(hostname);
  if (net.isIP(normalizedHostname)) {
    if (!isPublicAddress(normalizedHostname)) {
      throw new TargetUrlError("ローカルまたは非公開ネットワークのURLは診断できません。", "PRIVATE_TARGET");
    }
    return [{ address: normalizedHostname, family: net.isIP(normalizedHostname) }];
  }

  let records;
  try {
    records = await dns.lookup(normalizedHostname, { all: true, verbatim: true });
  } catch {
    throw new TargetUrlError("ドメイン名を解決できませんでした。", "DNS_ERROR");
  }

  if (!records.length || records.some(({ address }) => !isPublicAddress(address))) {
    throw new TargetUrlError("安全に取得できないURLです。", "PRIVATE_TARGET");
  }
  return records;
}
