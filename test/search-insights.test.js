import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSearchInsights } from "../server/search-insights.js";

test("extracts audience, needs, keywords, and intent from a Japanese service page", () => {
  const result = analyzeSearchInsights(`<!doctype html><html lang="ja"><head>
    <title>中小企業向けSEO対策・Webサイト制作｜Example</title>
    <meta name="description" content="Web担当者の検索流入と問い合わせ不足を改善するマーケティング支援です。">
    </head><body><h1>集客できるWebサイト制作とSEO対策</h1>
    <h2>検索順位を改善し、売上につなげる</h2><h2>料金プランと導入事例</h2>
    <a href="/contact">無料相談・お問い合わせ</a></body></html>`);

  assert.ok(result.services.includes("SEO対策"));
  assert.ok(result.services.includes("Webサイト制作"));
  assert.ok(result.targets.includes("企業・事業者の担当者"));
  assert.ok(result.targets.includes("中小企業・成長企業"));
  assert.ok(result.problems.includes("集客・認知を増やしたい"));
  assert.ok(result.explicitKeywords.includes("SEO対策"));
  assert.ok(result.latentKeywords.includes("SEO コンサルティング"));
  assert.deepEqual(result.intents.map(({ type }) => type), ["比較・検討", "行動・取引"]);
  assert.equal(result.confidence, "high");
});

test("returns a low-confidence empty result when public HTML has little information", () => {
  const result = analyzeSearchInsights("<!doctype html><html><body>Home</body></html>");
  assert.equal(result.confidence, "low");
  assert.deepEqual(result.services, []);
  assert.match(result.note, /推定できません/);
});

test("uses an explicit inference label when a business page does not state its audience", () => {
  const result = analyzeSearchInsights(`<!doctype html><html><head><title>AI導入支援</title>
    <meta name="description" content="AIを活用して業務効率化を支援します。"></head>
    <body><h1>AIツール開発と導入支援</h1><h2>企業の業務を自動化</h2></body></html>`);
  assert.deepEqual(result.targets, ["業務課題を解決したい企業・担当者（推定）"]);
  assert.ok(!result.services.includes("サービス"));
  assert.ok(!result.explicitKeywords.includes("する"));
});
