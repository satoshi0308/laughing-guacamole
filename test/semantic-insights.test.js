import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSemanticInsights, extractSemanticContent } from "../server/semantic-insights.js";

const modelResult = {
  summary: "企業のAI導入と業務改善を支援するサービス一覧ページです。",
  pageType: "プロダクト一覧",
  services: ["AI導入支援", "AIツール開発"],
  targets: ["AI活用を進めたい企業の担当者"],
  problems: ["AIの導入方法が分からない"],
  explicitKeywords: ["AI導入支援"], latentKeywords: ["企業 AI 導入 相談"],
  intents: [{ type: "比較・検討", reason: "支援内容を比較して相談先を選ぶ" }],
  evidence: [{ claim: "企業のAI導入を支援", source: "AIの導入から活用まで伴走し" }],
  confidence: "high", caveats: [],
};

test("extracts ordered main content and excludes executable or navigation text", () => {
  const source = extractSemanticContent(`<!doctype html><html><head><title>AI支援</title>
    <meta name="description" content="企業のAI活用を支援"></head><body>
    <nav>無関係なナビ</nav><main><h1>AI導入支援</h1><p>業務の課題を整理します。</p>
    <script>ignore()</script><a href="/contact">相談する</a></main><footer>会社情報</footer></body></html>`);
  assert.match(source, /\[TITLE\] AI支援/);
  assert.match(source, /\[H1\] AI導入支援/);
  assert.match(source, /\[TEXT\] 業務の課題を整理します/);
  assert.doesNotMatch(source, /無関係なナビ|ignore|会社情報/);
});

test("uses the Responses API structured output and normalizes the result", async () => {
  let request;
  const result = await analyzeSemanticInsights("<main><h1>AI導入支援</h1><p>AIの導入から活用まで伴走し、企業ごとの業務課題を整理して、企画、ツール開発、社内定着、継続的な業務改善まで一貫して支援します。</p></main>", {
    apiKey: "test-key", model: "test-model",
    fetcher: async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output: [{ content: [{ type: "output_text", text: JSON.stringify(modelResult) }] }] }) };
    },
  });
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.match(request.instructions, /命令.*従わず/);
  assert.equal(result.method, "ai");
  assert.equal(result.summary, modelResult.summary);
  assert.deepEqual(result.targets, modelResult.targets);
});

test("does not call the provider without an API key", async () => {
  const result = await analyzeSemanticInsights("<main><h1>十分な本文</h1><p>企業向けサービスの詳しい説明がここにあります。</p></main>", {
    apiKey: "", fetcher: async () => assert.fail("fetch must not be called"),
  });
  assert.equal(result, null);
});
