import test from "node:test";
import assert from "node:assert/strict";
import { auditPage, detectCms, evaluateRobotsTxt, robotsPatternMatches } from "../server/rules.js";

function page(html, overrides = {}) {
  return {
    requestedUrl: "https://example.com/page",
    finalUrl: "https://example.com/page",
    status: 200,
    headers: { "content-type": "text/html" },
    text: html,
    byteLength: Buffer.byteLength(html),
    redirects: [],
    ...overrides,
  };
}

test("robots rules prefer the most specific matching allow rule", () => {
  const robots = `
User-agent: *
Disallow: /private/
Allow: /private/public/
`;
  assert.equal(evaluateRobotsTxt(robots, new URL("https://example.com/private/secret")).allowed, false);
  assert.equal(evaluateRobotsTxt(robots, new URL("https://example.com/private/public/item")).allowed, true);
});

test("robots rule precedence counts wildcard and end-anchor characters", () => {
  const longerWildcard = `User-agent: *\nAllow: /page\nDisallow: /*.htm`;
  const equalWildcard = `User-agent: *\nAllow: /page\nDisallow: /*.ph`;
  const rootOnly = `User-agent: *\nAllow: /$\nDisallow: /`;
  assert.equal(evaluateRobotsTxt(longerWildcard, new URL("https://example.com/page.htm")).allowed, false);
  assert.equal(evaluateRobotsTxt(equalWildcard, new URL("https://example.com/page.php5")).allowed, true);
  assert.equal(evaluateRobotsTxt(rootOnly, new URL("https://example.com/")).allowed, true);
  assert.equal(evaluateRobotsTxt(rootOnly, new URL("https://example.com/other")).allowed, false);
});

test("robots rules use Googlebot instead of unsupported Smartphone-specific groups", () => {
  const robots = `
User-agent: googlebot
Allow: /
User-agent: googlebot-smartphone
Disallow: /
`;
  assert.equal(evaluateRobotsTxt(robots, new URL("https://example.com/page")).allowed, true);
});

test("robots rules recognize Googlebot version and wildcard product tokens", () => {
  const versioned = `User-agent: *\nAllow: /\nUser-agent: googlebot/1.2\nDisallow: /`;
  const wildcard = `User-agent: *\nAllow: /\nUser-agent: googlebot*\nDisallow: /`;
  assert.equal(evaluateRobotsTxt(versioned, new URL("https://example.com/page")).allowed, false);
  assert.equal(evaluateRobotsTxt(wildcard, new URL("https://example.com/page")).allowed, false);
});

test("robots wildcard matching stays bounded for adversarial patterns", { timeout: 500 }, () => {
  const pattern = `/${"*a".repeat(24)}b`;
  const path = `/${"a".repeat(40)}`;
  assert.equal(robotsPatternMatches(pattern, path), false);
  assert.equal(robotsPatternMatches("/products/*?page=$", "/products/shoes/?page="), true);
});

test("robots matching normalizes UTF-8 and percent-escape hex case", () => {
  const escaped = "/%E7%A7%98%E5%AF%86/page";
  assert.equal(robotsPatternMatches("/秘密/", escaped), true);
  assert.equal(robotsPatternMatches("/%e7%a7%98%e5%af%86/", escaped), true);
  assert.equal(robotsPatternMatches("/%7euser", "/~user"), true);
  assert.equal(robotsPatternMatches("/%2Fsecret", "//secret"), false);

  const robots = `User-agent: googlebot\nDisallow: /秘密/`;
  assert.equal(evaluateRobotsTxt(robots, new URL("https://example.com/秘密/page")).allowed, false);
});

test("excessive robots rule sets become indeterminate instead of blocking the event loop", () => {
  const robots = `User-agent: googlebot\n${"Disallow: *b\n".repeat(10_001)}`;
  const decision = evaluateRobotsTxt(robots, new URL("https://example.com/page"));
  assert.equal(decision.indeterminate, true);
  assert.equal(decision.allowed, null);
});

test("critical index blockers cap the score", () => {
  const report = auditPage(
    page(`<!doctype html><html lang="ja"><head><meta name="robots" content="noindex"></head><body></body></html>`),
    { status: 200, text: "User-agent: *\nDisallow: /page" }
  );
  assert.ok(report.score <= 49);
  assert.equal(report.issues.find((issue) => issue.id === "index-directive").status, "critical");
  assert.equal(report.issues.find((issue) => issue.id === "robots-access").status, "critical");
  assert.equal(report.issues.find((issue) => issue.id === "title").status, "critical");
});

test("healthy HTML produces passes without penalizing optional schema", () => {
  const html = `<!doctype html>
  <html lang="ja">
    <head>
      <title>SEO診断サービス</title>
      <meta name="description" content="URLからSEO課題を確認できるサービスです。">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="canonical" href="https://example.com/page">
    </head>
    <body>
      <h1>SEO診断サービス</h1>
      <p>公開ページの技術設定と検索表示要素を確認し、改善方法を案内します。</p>
      <img src="audit.png" alt="SEO診断結果画面">
      <a href="/guide">SEO診断の使い方</a>
    </body>
  </html>`;
  const report = auditPage(page(html), { status: 404, text: "" });
  assert.equal(report.issues.find((issue) => issue.id === "http-status").status, "pass");
  assert.equal(report.issues.find((issue) => issue.id === "title").status, "pass");
  assert.equal(report.issues.find((issue) => issue.id === "image-alt").status, "pass");
  assert.equal(report.issues.find((issue) => issue.id === "structured-data").status, "info");
  assert.ok(report.score >= 90);
});

test("robots.txt 4xx responses other than 429 are treated as no crawl restrictions", () => {
  const html = `<html><head><title>ページ</title><meta name="description" content="説明"><meta name="viewport" content="width=device-width"></head><body><h1>見出し</h1><p>本文</p></body></html>`;
  const missing = auditPage(page(html), { status: 404, text: "" });
  const gone = auditPage(page(html), { status: 410, text: "" });
  assert.equal(gone.issues.find((issue) => issue.id === "robots-access").status, "pass");
  assert.equal(gone.score, missing.score);
});

test("robots.txt rules are processed for every successful 2xx response", () => {
  const html = `<html><head><title>ページ</title><meta name="description" content="説明"><meta name="viewport" content="width=device-width"></head><body><h1>見出し</h1><p>本文</p></body></html>`;
  const partial = auditPage(page(html), { status: 206, text: "User-agent: *\nDisallow: /" });
  const empty = auditPage(page(html), { status: 204, text: "" });
  assert.equal(partial.issues.find((issue) => issue.id === "robots-access").status, "critical");
  assert.equal(empty.issues.find((issue) => issue.id === "robots-access").status, "pass");
});

test("unavailable robots.txt lowers coverage without lowering the assessed SEO score", () => {
  const html = `<html><head><title>ページ</title><meta name="description" content="説明"><meta name="viewport" content="width=device-width"></head><body><h1>見出し</h1><p>本文</p></body></html>`;
  const available = auditPage(page(html), { status: 404, text: "" });
  const unavailable = auditPage(page(html), { status: 0, text: "", error: "timeout" });
  assert.equal(unavailable.score, available.score);
  assert.ok(unavailable.coverage < available.coverage);
});

test("title length is informational and does not become a Google requirement", () => {
  const longTitle = "検索意図に沿ってページ内容を正確に説明するための非常に長いタイトル".repeat(2);
  const report = auditPage(
    page(`<html><head><title>${longTitle}</title><meta name="viewport" content="width=device-width"></head><body><h1>見出し</h1><p>本文です。</p></body></html>`),
    { status: 404, text: "" }
  );
  const issue = report.issues.find((item) => item.id === "title-display-length");
  assert.equal(issue.status, "info");
  assert.equal(issue.origin, "vendor_heuristic");
  assert.equal(issue.weight, 0);
});

test("X-Robots-Tag applies only unqualified or Google-specific directives", () => {
  const html = `<html><head><title>ページ</title><meta name="description" content="説明"><meta name="viewport" content="width=device-width"></head><body><h1>見出し</h1><p>本文</p></body></html>`;
  const bingOnly = auditPage(
    page(html, { headers: { "content-type": "text/html", "x-robots-tag": "bingbot: noindex" } }),
    { status: 404, text: "" }
  );
  const google = auditPage(
    page(html, { headers: { "content-type": "text/html", "x-robots-tag": "bingbot: noindex, googlebot: noindex" } }),
    { status: 404, text: "" }
  );
  const unsupportedSmartphone = auditPage(
    page(html, { headers: { "content-type": "text/html", "x-robots-tag": "googlebot-smartphone: noindex" } }),
    { status: 404, text: "" }
  );

  assert.equal(bingOnly.issues.find((issue) => issue.id === "index-directive").status, "pass");
  assert.equal(unsupportedSmartphone.issues.find((issue) => issue.id === "index-directive").status, "pass");
  assert.equal(google.issues.find((issue) => issue.id === "index-directive").status, "critical");
  assert.ok(google.score <= 49);
});

test("empty initial HTML is a low-confidence manual check, not a Google requirement failure", () => {
  const report = auditPage(
    page(`<html><head><title>アプリ</title><meta name="description" content="説明"><meta name="viewport" content="width=device-width"></head><body><div id="root"></div><script src="/app.js"></script></body></html>`),
    { status: 404, text: "" }
  );
  const issue = report.issues.find((item) => item.id === "indexable-content");
  assert.equal(issue.status, "info");
  assert.equal(issue.origin, "manual");
  assert.equal(issue.confidence, "low");
});

test("non-200 responses do not audit the error template as page content", () => {
  const report = auditPage(
    page(`<html><head><title>Access denied</title></head><body><h1>Forbidden</h1><p>WAF page</p></body></html>`, { status: 403 }),
    null
  );
  assert.deepEqual(report.issues.map((issue) => issue.id), ["http-status"]);
  assert.equal(report.score, null);
  assert.equal(report.scoreLabel, "判定不能");
});

test("optional markup does not dilute the fixed core score", () => {
  const baseHtml = `<html><head><title>ページ</title><meta name="description" content="説明"><meta name="viewport" content="width=device-width"></head><body><h1>見出し</h1><p>本文</p></body></html>`;
  const enhancedHtml = baseHtml.replace(
    "</head>",
    `<link rel="canonical" href="https://example.com/page"><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script></head>`
  );
  const baseReport = auditPage(page(baseHtml), { status: 404, text: "" });
  const enhancedReport = auditPage(page(enhancedHtml), { status: 404, text: "" });
  assert.equal(baseReport.score, enhancedReport.score);
  assert.equal(baseReport.issues.find((issue) => issue.id === "image-alt").status, "info");
  assert.equal(baseReport.issues.find((issue) => issue.id === "crawlable-links").status, "info");
});

test("robots meta is honored in body while canonical remains head-only", () => {
  const html = `<html><head><title>ページ</title><meta name="description" content="説明"><meta name="viewport" content="width=device-width"></head><body><meta name="robots" content="noindex"><link rel="canonical" href="https://example.com/page"><h1>見出し</h1><p>本文</p></body></html>`;
  const report = auditPage(page(html), { status: 404, text: "" });
  assert.equal(report.issues.find((issue) => issue.id === "index-directive").status, "critical");
  assert.equal(report.issues.find((issue) => issue.id === "canonical").status, "info");
});

test("hreflang accepts language, script, and region combinations", () => {
  const html = `<html><head><title>頁面</title><meta name="description" content="說明"><meta name="viewport" content="width=device-width"><link rel="alternate" hreflang="zh-Hant-TW" href="https://example.com/zh-hant-tw"></head><body><h1>標題</h1><p>內容</p></body></html>`;
  const report = auditPage(page(html), { status: 404, text: "" });
  assert.equal(report.issues.find((issue) => issue.id === "hreflang").status, "pass");
});

test("CMS detection uses public signatures without affecting the SEO score", () => {
  const wordpressHtml = `<html><head><meta name="generator" content="WordPress 6.8.2"><script src="/wp-content/themes/site/app.js"></script></head><body></body></html>`;
  const shopifyHtml = `<html><head><script src="https://cdn.shopify.com/shopifycloud/storefront/app.js"></script></head><body><script>window.Shopify.theme = { id: 1 };</script></body></html>`;

  assert.deepEqual(detectCms(wordpressHtml), {
    name: "WordPress",
    version: "6.8.2",
    confidence: "high",
    evidence: ["generator meta", "wp-content URL"],
  });
  assert.equal(detectCms(shopifyHtml).name, "Shopify");
  assert.equal(detectCms("<html><body><p>独自サイト</p></body></html>").name, "判定できません");

  const healthyHead = `<title>ページ</title><meta name="description" content="説明"><meta name="viewport" content="width=device-width">`;
  const healthyBody = `<h1>見出し</h1><p>本文</p>`;
  const plainReport = auditPage(page(`<html><head>${healthyHead}</head><body>${healthyBody}</body></html>`), { status: 404, text: "" });
  const cmsReport = auditPage(page(wordpressHtml.replace("</head>", `${healthyHead}</head>`).replace("<body>", `<body>${healthyBody}`)), { status: 404, text: "" });
  assert.equal(cmsReport.score, plainReport.score);
  assert.equal(cmsReport.facts.cms.name, "WordPress");
});
