import * as cheerio from "cheerio";

const STOP_WORDS = new Set([
  "こと", "もの", "ため", "よう", "こちら", "サイト", "ページ", "サービス", "株式会社", "合同会社",
  "お客様", "ください", "について", "による", "できる", "します", "いる", "ある", "から", "まで",
  "with", "this", "that", "your", "the", "and", "for", "です", "ます", "する", "見る",
]);

const TARGET_RULES = [
  [/中小企業|中堅企業/, "中小企業・中堅企業"],
  [/スタートアップ|ベンチャー/, "スタートアップ・成長企業"],
  [/個人事業主|フリーランス|副業/, "個人事業主・フリーランス"],
  [/EC事業者|ネットショップ|通販事業/, "EC・ネットショップ運営者"],
  [/Web担当|マーケティング担当|マーケター|広報担当/, "Web・マーケティング担当者"],
  [/人事担当|採用担当/, "人事・採用担当者"],
  [/経営者|経営層/, "経営者・経営層"],
  [/求職者|転職希望|就職/, "求職者"],
  [/初心者|はじめて|初めて/, "初めて検討する人"],
];

const PROBLEM_RULES = [
  [/AI活用領域|導入ロードマップ|社内展開|運用ルール|現場への定着/, "AI導入の進め方や定着方法を整理したい"],
  [/定型業務|自動化|効率化|工数|時間削減|生産性/, "業務の手間や時間を減らしたい"],
  [/集客|アクセス|流入|認知/, "集客・認知を増やしたい"],
  [/売上|成約|コンバージョン|CVR|問い合わせ不足/, "売上・問い合わせを増やしたい"],
  [/検索順位|検索流入|検索で見つか|SEO課題/, "検索で見つかりやすくしたい"],
  [/採用難|求人|応募不足|人材不足/, "必要な人材を採用したい"],
  [/コスト削減|費用を抑|予算/, "コストを抑えたい"],
  [/既存データ|既存業務|データ連携/, "既存の業務やデータに合う仕組みを作りたい"],
  [/リニューアル|サイト改善|デザイン改善/, "Webサイトを制作・改善したい"],
];

const SERVICE_SUFFIX = /(?:支援|開発|制作|対策|運用|診断|コンサルティング|コンサル|自動化|代行|販売|予約|スクール|講座|ツール|システム)$/i;
const SERVICE_SECTION = /WHAT WE DO|SERVICE|事業|支援内容|提供内容|プロダクト|商品|機能/i;
const GENERIC_HEADINGS = /^(サービス|事業内容|提供内容|プロダクト一覧|商品一覧|機能一覧|特徴|強み|料金|事例|実績|よくある質問|FAQ|お問い合わせ)$/i;

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function trimPhrase(value, max = 80) {
  const text = clean(value).replace(/^[｜|:：>≫»\-–—・]+|[｜|:：>≫»\-–—・。]+$/g, "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
function unique(values, limit = values.length) { return [...new Set(values.map(clean).filter(Boolean))].slice(0, limit); }
function firstMatch(values, pattern) { return values.find((value) => pattern.test(value)) || ""; }

function buildBlocks($, root) {
  const blocks = [];
  let section = "";
  root.find("h1, h2, h3, h4, p, li, blockquote, a").each((_, node) => {
    const tag = node.tagName.toLowerCase();
    const text = clean($(node).text());
    if (!text || text.length > 500) return;
    if (tag === "h2") section = text;
    blocks.push({ tag, text, section });
  });
  return blocks;
}

function detectPageType(title, h1, h2, context) {
  const headings = h2.join(" ");
  if (/プロダクト一覧|商品一覧|製品一覧/.test(headings)) return /AI/i.test(context) ? "AIサービス・プロダクト一覧" : "サービス・プロダクト一覧";
  if (/サービス一覧|事業内容|WHAT WE DO/i.test(headings)) return "サービス紹介ページ";
  if (/料金|価格|プラン/.test(`${title} ${h1.join(" ")}`) && /申込|購入|相談/.test(context)) return "料金・申込みページ";
  if (/導入事例|お客様事例|CASE STUDY/i.test(context)) return "導入事例ページ";
  if (/記事|コラム|解説|ニュース|BLOG/i.test(`${title} ${h1.join(" ")}`)) return "記事・解説ページ";
  if (/会社概要|私たちについて|ABOUT/i.test(context)) return "企業情報ページ";
  return "サービス・情報ページ";
}

function findSummary(description, blocks) {
  const h1Index = blocks.findIndex(({ tag }) => tag === "h1");
  const hero = blocks.slice(Math.max(0, h1Index + 1)).find(({ tag, text }) =>
    tag === "p" && text.length >= 24 && text.length <= 220 && !/^[A-Z\s&]+$/.test(text)
  )?.text || "";
  return hero || (description.length >= 28 && description.length <= 220 ? description : "");
}

function serviceCandidates(blocks, title, h1) {
  const scopedHeadings = blocks.filter(({ tag, section }) => ["h3", "h4"].includes(tag) && SERVICE_SECTION.test(section))
    .map(({ text }) => trimPhrase(text));
  const explicitHeadings = blocks.filter(({ tag, text }) => ["h1", "h2", "h3", "h4"].includes(tag) && !GENERIC_HEADINGS.test(text))
    .flatMap(({ text }) => text.split(/(?:と|・|／|\/|＆|&|\+|、)/).map((value) => trimPhrase(value)))
    .filter((value) => value.length >= 3 && SERVICE_SUFFIX.test(value));
  const titlePhrases = [title, ...h1].flatMap((value) => value.split(/[｜|:：–—\-・]/)).map((value) => trimPhrase(value))
    .filter((value) => value.length >= 3 && SERVICE_SUFFIX.test(value));
  const candidates = unique([...scopedHeadings, ...explicitHeadings, ...titlePhrases]);
  return candidates.filter((candidate) => !candidates.some((other) =>
    other !== candidate && other.length >= 3 && other.length < candidate.length && candidate.includes(other)
  )).slice(0, 7);
}

function serviceSectionNames(blocks) {
  const sections = new Map();
  for (const block of blocks) {
    if (!["h3", "h4"].includes(block.tag) || !SERVICE_SUFFIX.test(trimPhrase(block.text))) continue;
    sections.set(block.section, (sections.get(block.section) || 0) + 1);
  }
  return new Set([...sections].filter(([section, count]) => SERVICE_SECTION.test(section) || count >= 2).map(([section]) => section));
}

function inferTheme(h1, summary, services) {
  const context = `${h1.join(" ")} ${summary} ${services.join(" ")}`;
  if (/AI|人工知能/.test(context)) return "AI活用";
  if (/SEO|検索流入|検索順位/.test(context)) return "SEO・検索集客";
  if (/Webマーケ|デジタルマーケ|集客/.test(context)) return "Web集客";
  if (/採用|求人|人材/.test(context)) return "採用";
  if (/EC|ネットショップ|通販/.test(context)) return "EC運営";
  return services[0] ? services[0].replace(SERVICE_SUFFIX, "").slice(0, 24) : "掲載内容";
}

function inferTargets(priorityTexts, theme, services) {
  const targets = [];
  const evidence = [];
  for (const [pattern, label] of TARGET_RULES) {
    const source = firstMatch(priorityTexts, pattern);
    if (!source) continue;
    targets.push(label);
    evidence.push({ claim: `対象: ${label}`, source });
  }
  const explicit = priorityTexts.flatMap((text) => [...text.matchAll(/([\p{L}\p{N}・ー\s]{2,22})(?:向け|の担当者|の方へ)/gu)]
    .map((match) => trimPhrase(match[1], 30)));
  for (const value of explicit) {
    if (!targets.some((target) => target.includes(value))) targets.push(`${value}向け`);
  }
  if (!targets.length && /企業|法人|業務|社内|導入|BtoB|ビジネス/i.test(priorityTexts.join(" "))) {
    const label = `${theme}を進めたい企業・担当者（推定）`;
    targets.push(label);
    const source = firstMatch(priorityTexts, /企業|法人|業務|社内|導入|BtoB|ビジネス/i);
    if (source) evidence.push({ claim: `対象: ${label}`, source });
  } else if (!targets.length && services.length) targets.push("掲載サービスを検討している人（推定）");
  return { targets: unique(targets, 5), evidence };
}

function inferProblems(priorityTexts) {
  const problems = [];
  const evidence = [];
  for (const [pattern, label] of PROBLEM_RULES) {
    const source = firstMatch(priorityTexts, pattern);
    if (!source) continue;
    problems.push(label);
    evidence.push({ claim: `課題: ${label}`, source });
  }
  return { problems: unique(problems, 6), evidence };
}

function weightedKeywords(parts) {
  const scores = new Map();
  const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
  for (const { text, weight } of parts) {
    for (const item of segmenter.segment(text)) {
      const word = clean(item.segment).replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
      if (!item.isWordLike || word.length < 2 || word.length > 24 || STOP_WORDS.has(word.toLowerCase()) || /^\d+$/.test(word)) continue;
      scores.set(word, (scores.get(word) || 0) + weight);
    }
  }
  return [...scores.entries()].filter(([, score]) => score >= 3)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([word]) => word);
}

function buildLatentKeywords(services, problems, theme) {
  const values = [];
  for (const service of services.slice(0, 3)) values.push(`${service} 費用`, `${service} 事例`);
  if (problems.some((value) => /進め方|定着/.test(value))) values.push(`${theme} 進め方`, `${theme} 社内定着`);
  if (problems.some((value) => /手間|時間/.test(value))) values.push("業務自動化 方法", "業務効率化 ツール");
  if (problems.some((value) => /集客|認知/.test(value))) values.push(`${theme} 集客方法`);
  if (!values.length && theme !== "掲載内容") values.push(`${theme} 比較`, `${theme} 相談`);
  return unique(values, 8);
}

function inferSearchIntent(pageType, context) {
  const intents = [];
  if (/一覧|紹介|料金|事例/.test(pageType) || /料金|価格|費用|プラン|比較|選び方|事例|実績|評判/.test(context)) {
    intents.push({ type: "比較・検討", reason: "提供内容や実績を確認し、候補を比較する意図" });
  }
  if (/問い合わせ|相談|見積|申込|購入|予約|資料請求|無料診断|ダウンロード/.test(context)) {
    intents.push({ type: "行動・取引", reason: "相談・問い合わせ・申込みなど次の行動へ進む意図" });
  }
  if (/記事|解説/.test(pageType) || /とは|方法|やり方|解説|FAQ|課題|悩み/.test(context)) {
    intents.push({ type: "情報収集", reason: "課題や解決方法を理解する意図" });
  }
  return intents.length ? intents.slice(0, 3) : [{ type: "情報収集・比較", reason: "ページ内容を理解し、選択肢として検討する意図" }];
}

export function analyzeSearchInsights(html) {
  const $ = cheerio.load(String(html || ""));
  $("script, style, noscript, template, svg, canvas, iframe, form, nav, footer, header").remove();
  const title = clean($("head title").first().text());
  const description = clean($("head meta[name='description' i]").first().attr("content"));
  const root = $("main").first().length ? $("main").first() : $("body").first();
  const blocks = buildBlocks($, root);
  const h1 = unique(blocks.filter(({ tag }) => tag === "h1").map(({ text }) => text), 3);
  const h2 = unique(blocks.filter(({ tag }) => tag === "h2").map(({ text }) => text), 20);
  const summary = findSummary(description, blocks);
  const services = serviceCandidates(blocks, title, h1);
  const serviceSections = serviceSectionNames(blocks);
  const serviceBlocks = blocks.filter(({ section }) => serviceSections.has(section) && !/プロダクト|商品/i.test(section));
  const priorityTexts = unique([title, description, ...h1, summary, ...serviceBlocks.map(({ text }) => text)], 80);
  const fullContext = unique([title, description, ...blocks.map(({ text }) => text)], 250).join(" ").slice(0, 30_000);

  if (fullContext.length < 40) {
    return {
      method: "local", confidence: "low", summary: "", pageType: "判定不能",
      services: [], targets: [], problems: [], explicitKeywords: [], latentKeywords: [], intents: [], evidence: [], caveats: [],
      note: "公開HTMLの情報が少ないため、推定できませんでした。",
    };
  }

  const pageType = detectPageType(title, h1, h2, fullContext);
  const theme = inferTheme(h1, summary, services);
  const targetResult = inferTargets(priorityTexts, theme, services);
  const problemResult = inferProblems(priorityTexts);
  const weightedParts = [
    { text: title, weight: 6 }, ...(summary === description ? [{ text: description, weight: 5 }] : []), ...h1.map((text) => ({ text, weight: 6 })),
    ...serviceBlocks.filter(({ tag }) => /^h/.test(tag)).map(({ text }) => ({ text, weight: 4 })), { text: summary, weight: 4 },
  ];
  const explicitKeywords = unique([...services, theme, ...weightedKeywords(weightedParts)], 10);
  const evidence = unique([
    ...(summary ? [{ claim: "ページ概要", source: summary }] : []),
    ...services.slice(0, 3).map((service) => ({ claim: `提供内容: ${service}`, source: service })),
    ...targetResult.evidence, ...problemResult.evidence,
  ].map((item) => JSON.stringify(item)), 8).map((item) => JSON.parse(item));
  const evidenceSignals = [summary, services.length >= 2, targetResult.targets.length, problemResult.problems.length].filter(Boolean).length;

  return {
    method: "local",
    confidence: evidenceSignals >= 4 ? "high" : evidenceSignals >= 2 ? "medium" : "low",
    summary, pageType, services, targets: targetResult.targets, problems: problemResult.problems,
    explicitKeywords, latentKeywords: buildLatentKeywords(services, problemResult.problems, theme),
    intents: inferSearchIntent(pageType, fullContext), evidence,
    caveats: services.length ? [] : ["提供サービスを表す明確な見出しを確認できませんでした。"],
    note: "外部AIへ送信せず、公開HTMLの見出し階層・主要本文・CTAの関係から無料で推定しています。検索ボリュームや実際の顧客調査ではありません。",
  };
}
