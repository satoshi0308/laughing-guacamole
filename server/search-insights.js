import * as cheerio from "cheerio";

const SERVICE_TERMS = [
  "SEO対策", "SEO診断", "SEOコンサルティング", "Webマーケティング", "デジタルマーケティング",
  "Webサイト制作", "ホームページ制作", "サイト制作", "ECサイト", "システム開発", "アプリ開発",
  "広告運用", "コンテンツ制作", "採用支援", "人材紹介", "業務効率化", "コンサルティング",
  "オンラインショップ", "通販", "予約", "スクール", "講座",
];

const STOP_WORDS = new Set([
  "こと", "もの", "ため", "よう", "こちら", "サイト", "ページ", "サービス", "株式会社", "合同会社",
  "お客様", "ください", "について", "による", "できる", "します", "いる", "ある", "から", "まで",
  "with", "this", "that", "your", "the", "and", "for", "です", "ます", "する",
]);

const TARGET_PATTERNS = [
  [/法人|企業向け|事業者|経営者|担当者|マーケター|Web担当|広報担当|人事担当|採用担当/i, "企業・事業者の担当者"],
  [/中小企業|中堅企業|スタートアップ|ベンチャー/i, "中小企業・成長企業"],
  [/個人事業主|フリーランス|副業/i, "個人事業主・フリーランス"],
  [/初心者|はじめて|初めて/i, "初めて検討する人"],
  [/EC事業者|ネットショップ|通販事業/i, "EC・ネットショップ運営者"],
  [/求職者|転職|就職/i, "求職者"],
];

const PROBLEM_PATTERNS = [
  [/集客|アクセス|流入|認知/, "集客・認知を増やしたい"],
  [/売上|成約|コンバージョン|CVR|問い合わせ/, "売上・問い合わせを増やしたい"],
  [/順位|検索結果|SEO/, "検索で見つかりやすくしたい"],
  [/効率化|自動化|工数|時間削減|生産性/, "業務の手間や時間を減らしたい"],
  [/採用|人材|求人|応募/, "必要な人材を採用したい"],
  [/コスト|費用|削減/, "コストを抑えたい"],
  [/改善|課題|悩み|困り|解決/, "現状の課題を特定し、改善したい"],
  [/制作|リニューアル|デザイン/, "Webサイトを制作・改善したい"],
];

const LATENT_MAP = [
  [/SEO|検索順位|検索流入/i, ["SEO 改善方法", "SEO コンサルティング", "検索順位 上げる"]],
  [/Webサイト制作|ホームページ制作|サイト制作/i, ["ホームページ制作 会社", "Webサイト リニューアル", "集客できるホームページ"]],
  [/マーケティング|集客|広告運用/i, ["Web集客 支援", "デジタルマーケティング 会社", "広告運用 代行"]],
  [/ECサイト|オンラインショップ|通販/i, ["ECサイト 構築", "ネットショップ 売上改善", "EC 運営支援"]],
  [/システム開発|アプリ開発|業務効率化/i, ["システム開発 会社", "業務効率化 ツール", "DX 支援"]],
  [/採用|求人|人材/i, ["採用 支援", "求人 応募 増やす", "人材紹介 サービス"]],
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values, limit = values.length) {
  return [...new Set(values.map(clean).filter(Boolean))].slice(0, limit);
}

function trimPhrase(value, max = 64) {
  const text = clean(value).replace(/^[｜|:：>≫»\-–—・]+|[｜|:：>≫»\-–—・]+$/g, "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
  return [...scores.entries()]
    .filter(([, score]) => score >= 3)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([word]) => word);
}

function inferSearchIntent(context) {
  const intents = [];
  if (/料金|価格|費用|プラン|比較|選び方|事例|実績|評判/.test(context)) {
    intents.push({ type: "比較・検討", reason: "料金・比較・実績などの検討材料を探す意図" });
  }
  if (/問い合わせ|相談|見積|申込|申し込み|購入|予約|資料請求|無料診断|ダウンロード/.test(context)) {
    intents.push({ type: "行動・取引", reason: "問い合わせ・申込み・購入など次の行動へ進む意図" });
  }
  if (/とは|方法|やり方|解説|知識|コラム|よくある質問|FAQ|課題|悩み/.test(context)) {
    intents.push({ type: "情報収集", reason: "課題の理解や解決方法を調べる意図" });
  }
  if (/店舗|アクセス|営業時間|地域|エリア|駅|来店/.test(context)) {
    intents.push({ type: "地域・来店", reason: "場所や店舗情報を確認し、来店する意図" });
  }
  return intents.length ? intents.slice(0, 3) : [{ type: "情報収集・比較", reason: "サービス内容を理解し、候補として検討する意図" }];
}

export function analyzeSearchInsights(html) {
  const $ = cheerio.load(String(html || ""));
  $("script, style, noscript, template, svg").remove();

  const title = clean($("head title").first().text());
  const description = clean($("head meta[name='description' i]").first().attr("content"));
  const h1 = unique($("h1").toArray().map((node) => $(node).text()), 3);
  const headings = unique($("h2, h3").toArray().map((node) => $(node).text()), 16);
  const body = clean($("body").text()).slice(0, 30_000);
  const context = [title, description, ...h1, ...headings, body].join(" ");

  if (context.length < 40) {
    return {
      confidence: "low",
      services: [], targets: [], problems: [], explicitKeywords: [], latentKeywords: [], intents: [],
      note: "公開HTMLの情報が少ないため、推定できませんでした。",
    };
  }

  const serviceMatches = SERVICE_TERMS.filter((term) => context.toLowerCase().includes(term.toLowerCase()));
  const titlePhrases = title.split(/[｜|:：–—\-]/).map((part) => trimPhrase(part))
    .filter((part) => part.length >= 4 && /支援|制作|開発|対策|運用|診断|コンサル|販売|予約|スクール|サービス|製品/.test(part));
  const headingPhrases = [...h1, ...headings]
    .map((part) => trimPhrase(part))
    .filter((part) => part.length >= 4 && part.length <= 54 && /支援|制作|開発|対策|運用|診断|コンサル|販売|予約|スクール|サービス|製品/.test(part));
  const services = unique([...serviceMatches, ...headingPhrases, ...titlePhrases], 5);

  const detectedTargets = TARGET_PATTERNS.filter(([pattern]) => pattern.test(context)).map(([, label]) => label);
  const targets = unique(
    detectedTargets.length
      ? detectedTargets
      : /企業|法人|業務|導入|担当|BtoB|ビジネス/i.test(context)
        ? ["業務課題を解決したい企業・担当者（推定）"]
        : services.length
          ? ["掲載サービスを検討している人（推定）"]
          : [],
    4
  );
  const problems = unique(PROBLEM_PATTERNS.filter(([pattern]) => pattern.test(context)).map(([, label]) => label), 5);

  const weightedParts = [
    { text: title, weight: 6 }, { text: description, weight: 4 },
    ...h1.map((text) => ({ text, weight: 5 })),
    ...headings.map((text) => ({ text, weight: 3 })),
    { text: body.slice(0, 12_000), weight: 1 },
  ];
  const explicitKeywords = unique([...serviceMatches, ...weightedKeywords(weightedParts)], 10);
  const latentKeywords = unique(
    LATENT_MAP.filter(([pattern]) => pattern.test(context)).flatMap(([, keywords]) => keywords)
      .filter((keyword) => !explicitKeywords.some((explicit) => clean(keyword).toLowerCase() === clean(explicit).toLowerCase())),
    8
  );
  const evidenceCount = [title, description, h1.length ? "h1" : "", headings.length ? "heading" : ""].filter(Boolean).length;

  return {
    confidence: evidenceCount >= 4 && (services.length + targets.length + problems.length) >= 5 ? "high" : evidenceCount >= 2 ? "medium" : "low",
    services,
    targets,
    problems,
    explicitKeywords,
    latentKeywords,
    intents: inferSearchIntent(context),
    note: "公開HTMLのtitle・description・見出し・本文から自動推定しています。実際の顧客調査や検索ボリュームではありません。",
  };
}
