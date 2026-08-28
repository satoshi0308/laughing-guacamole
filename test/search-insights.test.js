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
  assert.ok(result.targets.includes("Web・マーケティング担当者"));
  assert.ok(result.targets.includes("中小企業・中堅企業"));
  assert.ok(result.problems.includes("集客・認知を増やしたい"));
  assert.ok(result.explicitKeywords.includes("SEO対策"));
  assert.ok(result.latentKeywords.includes("SEO対策 費用"));
  assert.deepEqual(result.intents.map(({ type }) => type), ["比較・検討", "行動・取引"]);
  assert.equal(result.confidence, "high");
  assert.equal(result.method, "local");
  assert.equal(result.summary, "Web担当者の検索流入と問い合わせ不足を改善するマーケティング支援です。");
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
  assert.deepEqual(result.targets, ["AI活用を進めたい企業・担当者（推定）"]);
  assert.ok(!result.services.includes("サービス"));
  assert.ok(!result.explicitKeywords.includes("する"));
});

test("understands a product page by section hierarchy without treating one product as the page purpose", () => {
  const result = analyzeSearchInsights(`<!doctype html><html><head><title>プロダクト | Neuralix</title></head><body><main>
    <p>WHAT WE DO</p><h1>AI活用を、実務の形にする。</h1>
    <p>戦略設計から開発、導入、運用改善まで。企業の状況に合わせて、使い続けられる仕組みをつくります。</p>
    <h2>構想から定着まで、一つの流れで。</h2>
    <h3>AIコンサルティング</h3><p>AI活用領域の選定、業務棚卸し、導入ロードマップの策定を支援します。</p>
    <h3>AI業務自動化</h3><p>定型業務や資料作成を自動化します。</p>
    <h3>AIツール開発</h3><p>社内データや既存業務に合わせたAIツールを開発します。</p>
    <h3>AI導入支援</h3><p>社内展開、運用ルール整備、現場への定着を支援します。</p>
    <h2>プロダクト一覧</h2><a>006 SEO SEO PULSE URLを入力するだけでSEO課題を可視化する診断サービス</a>
    <h2>お問い合わせ</h2><a>相談する</a></main></body></html>`);

  assert.equal(result.pageType, "AIサービス・プロダクト一覧");
  assert.equal(result.summary, "戦略設計から開発、導入、運用改善まで。企業の状況に合わせて、使い続けられる仕組みをつくります。");
  assert.deepEqual(result.services, ["AIコンサルティング", "AI業務自動化", "AIツール開発", "AI導入支援"]);
  assert.ok(result.targets.includes("AI活用を進めたい企業・担当者（推定）"));
  assert.ok(result.problems.includes("AI導入の進め方や定着方法を整理したい"));
  assert.ok(!result.problems.includes("検索で見つかりやすくしたい"));
  assert.ok(result.evidence.some(({ source }) => /導入ロードマップ/.test(source)));
});
