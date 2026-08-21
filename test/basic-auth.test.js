import test from "node:test";
import assert from "node:assert/strict";
import { createBasicAuthMiddleware } from "../server/basic-auth.js";

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

const config = { enabled: true, username: "seo-pulse", password: "a-secure-password" };

test("Basic authentication can be disabled for local development", () => {
  let nextCalled = false;
  createBasicAuthMiddleware({ enabled: false })({ headers: {} }, responseMock(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test("Basic authentication accepts valid credentials", () => {
  const req = { headers: { authorization: `Basic ${Buffer.from("seo-pulse:a-secure-password").toString("base64")}` } };
  let nextCalled = false;
  createBasicAuthMiddleware(config)(req, responseMock(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.basicAuthUser, "seo-pulse");
});

test("Basic authentication rejects missing or invalid credentials", () => {
  const middleware = createBasicAuthMiddleware(config);
  for (const authorization of [undefined, `Basic ${Buffer.from("seo-pulse:wrong-password").toString("base64")}`]) {
    const res = responseMock();
    middleware({ headers: { authorization } }, res, () => assert.fail());
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, "AUTH_REQUIRED");
    assert.match(res.headers["WWW-Authenticate"], /^Basic /);
  }
});

test("Basic authentication fails closed for a short password", () => {
  assert.throws(() => createBasicAuthMiddleware({ enabled: true, username: "seo-pulse", password: "short" }), /16文字以上/);
});
