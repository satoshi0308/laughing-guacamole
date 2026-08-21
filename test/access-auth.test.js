import test from "node:test";
import assert from "node:assert/strict";
import { createCloudflareAccessMiddleware } from "../server/access-auth.js";

function responseMock() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

const config = {
  enabled: true,
  teamDomain: "https://example.cloudflareaccess.com",
  audience: "test-audience",
  allowedEmails: "Owner@Example.com",
};

test("Cloudflare Access can be disabled for local development", async () => {
  const middleware = createCloudflareAccessMiddleware({ enabled: false });
  let nextCalled = false;
  await middleware({ headers: {} }, responseMock(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test("Cloudflare Access rejects requests without an assertion", async () => {
  const middleware = createCloudflareAccessMiddleware(config, { verifyAssertion: async () => assert.fail() });
  const res = responseMock();
  await middleware({ headers: {} }, res, () => assert.fail());
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "ACCESS_TOKEN_REQUIRED");
});

test("Cloudflare Access accepts only an allowed application user", async () => {
  const middleware = createCloudflareAccessMiddleware(config, {
    verifyAssertion: async () => ({ payload: { type: "app", email: "owner@example.com", sub: "user-1" } }),
  });
  const req = { headers: { "cf-access-jwt-assertion": "signed-token" } };
  let nextCalled = false;
  await middleware(req, responseMock(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.deepEqual(req.accessUser, { email: "owner@example.com", sub: "user-1" });
});

test("Cloudflare Access rejects another user and an invalid token", async () => {
  const denied = createCloudflareAccessMiddleware(config, {
    verifyAssertion: async () => ({ payload: { type: "app", email: "other@example.com" } }),
  });
  const deniedRes = responseMock();
  await denied({ headers: { "cf-access-jwt-assertion": "signed-token" } }, deniedRes, () => assert.fail());
  assert.equal(deniedRes.body.code, "ACCESS_DENIED");

  const invalid = createCloudflareAccessMiddleware(config, {
    verifyAssertion: async () => {
      throw new Error("bad signature");
    },
  });
  const invalidRes = responseMock();
  await invalid({ headers: { "cf-access-jwt-assertion": "invalid-token" } }, invalidRes, () => assert.fail());
  assert.equal(invalidRes.body.code, "ACCESS_TOKEN_INVALID");
});

test("Cloudflare Access fails closed when required settings are missing", () => {
  assert.throws(
    () => createCloudflareAccessMiddleware({ enabled: true, teamDomain: "", audience: "", allowedEmails: "" }),
    /CF_ACCESS_TEAM_DOMAIN/,
  );
});
