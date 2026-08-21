import test from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, normalizeTargetUrl, resolvePublicAddresses } from "../server/security.js";

test("private and documentation addresses are rejected", () => {
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("10.10.0.2"), false);
  assert.equal(isPublicAddress("169.254.10.2"), false);
  assert.equal(isPublicAddress("192.168.1.10"), false);
  assert.equal(isPublicAddress("203.0.113.4"), false);
  assert.equal(isPublicAddress("::1"), false);
  assert.equal(isPublicAddress("fc00::1"), false);
  assert.equal(isPublicAddress("2001:db8::1"), false);
  assert.equal(isPublicAddress("0:0:0:0:0:ffff:7f00:1"), false);
  assert.equal(isPublicAddress("64:ff9b::7f00:1"), false);
  assert.equal(isPublicAddress("fec0::1"), false);
  assert.equal(isPublicAddress("198.18.0.1"), false);
});

test("public addresses are accepted", () => {
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicAddress("[2606:4700:4700::1111]"), true);
});

test("IPv6 URL literals are normalized before address validation", async () => {
  await assert.rejects(() => resolvePublicAddresses("[::1]"), { code: "PRIVATE_TARGET" });
  assert.deepEqual(await resolvePublicAddresses("[2606:4700:4700::1111]"), [
    { address: "2606:4700:4700::1111", family: 6 },
  ]);
});

test("target URL normalization allows only standard web URLs", () => {
  assert.equal(normalizeTargetUrl("example.com/path#section").toString(), "https://example.com/path");
  assert.throws(() => normalizeTargetUrl("file:///etc/passwd"));
  assert.throws(() => normalizeTargetUrl("https://example.com:8080"));
  assert.throws(() => normalizeTargetUrl("https://user:pass@example.com"));
});
