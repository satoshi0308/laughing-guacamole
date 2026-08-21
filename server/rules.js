import * as cheerio from "cheerio";
import { getSources } from "./sources.js";
import { calculateCoreScore, CORE_WEIGHTS } from "../shared/scoring.js";

const CATEGORY_LABELS = {
  search: "検索表示",
  crawl: "クロール",
  content: "コンテンツ",
  structured: "構造化データ",
  links: "リンク",
  mobile: "モバイル",
};

const STATUS_ORDER = { critical: 0, warning: 1, info: 2, pass: 3 };
const MAX_ROBOTS_RULES = 10_000;
const MAX_ROBOTS_MATCH_WORK = 2_000_000;
const GENERIC_ANCHORS = new Set([
  "こちら",
  "こちらへ",
  "ここ",
  "詳細",
  "詳しくはこちら",
  "もっと見る",
  "続きを読む",
  "click here",
  "read more",
  "learn more",
  "more",
  "link",
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function listMetaByName($, names, includeBody = false) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return $(includeBody ? "meta" : "head meta")
    .toArray()
    .filter((node) => wanted.has(cleanText($(node).attr("name")).toLowerCase()))
    .map((node) => cleanText($(node).attr("content")));
}

function listLinkByRel($, relName) {
  return $("head link")
    .toArray()
    .filter((node) =>
      cleanText($(node).attr("rel"))
        .toLowerCase()
        .split(/\s+/)
        .includes(relName)
    );
}

function makeIssue({
  id,
  category,
  status,
  title,
  summary,
  detected,
  impact,
  fix,
  sourceIds,
  origin = "google_recommendation",
  confidence = "high",
  caveat = "",
}) {
  return {
    id,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    status,
    title,
    summary,
    detected,
    impact,
    fix,
    sourceIds,
    weight: CORE_WEIGHTS[id] || 0,
    origin,
    confidence,
    caveat,
  };
}

const ROBOTS_DIRECTIVE_NAMES = new Set([
  "all",
  "follow",
  "index",
  "max-image-preview",
  "max-snippet",
  "max-video-preview",
  "noarchive",
  "noimageindex",
  "noindex",
  "nofollow",
  "none",
  "nositelinkssearchbox",
  "nosnippet",
  "notranslate",
  "unavailable_after",
]);

function directiveTokens(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[;,\s]+/)
    .filter(Boolean);
}

export function parseApplicableXRobotsTags(headers) {
  const values = (Array.isArray(headers) ? headers : [headers]).filter(Boolean);
  const tokens = [];

  for (const value of values) {
    let appliesToGoogle = true;
    for (const segment of String(value).split(",")) {
      let directive = segment.trim().toLowerCase();
      const prefixed = directive.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i);
      if (prefixed && !ROBOTS_DIRECTIVE_NAMES.has(prefixed[1])) {
        appliesToGoogle = prefixed[1] === "googlebot";
        directive = prefixed[2];
      }
      if (appliesToGoogle) tokens.push(...directiveTokens(directive));
    }
  }

  return tokens;
}

function finalizeReport(page, issues, facts, extraLimitations = []) {
  const usedSourceIds = [...new Set(issues.flatMap((issue) => issue.sourceIds))];
  issues.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const counts = issues.reduce(
    (result, issue) => {
      result[issue.status] += 1;
      return result;
    },
    { critical: 0, warning: 0, info: 0, pass: 0 }
  );
  const scoring = calculateCoreScore(issues);

  return {
    id: `audit-${Date.now()}`,
    requestedUrl: page.requestedUrl,
    finalUrl: page.finalUrl,
    auditedAt: new Date().toISOString(),
    ...scoring,
    counts,
    issues,
    sources: getSources(usedSourceIds),
    facts,
    limitations: [
      ...extraLimitations,
      "公開中の生HTMLを1ページだけ診断しています。JavaScript実行後のDOMは対象外です。",
      "検索順位、実際のインデックス登録、被リンク、サイト全体の重複は判定していません。",
      "スコアはSEO PULSE独自の優先度指標で、Googleの公式評価ではありません。",
    ],
  };
}

function buildPrefixTable(value) {
  const table = new Array(value.length).fill(0);
  for (let index = 1, prefix = 0; index < value.length; ) {
    if (value[index] === value[prefix]) {
      prefix += 1;
      table[index] = prefix;
      index += 1;
    } else if (prefix) {
      prefix = table[prefix - 1];
    } else {
      index += 1;
    }
  }
  return table;
}

function findLiteral(value, needle, start, end) {
  if (!needle) return start;
  const table = buildPrefixTable(needle);
  for (let index = start, matched = 0; index < end; ) {
    if (value[index] === needle[matched]) {
      index += 1;
      matched += 1;
      if (matched === needle.length) return index - matched;
    } else if (matched) {
      matched = table[matched - 1];
    } else {
      index += 1;
    }
  }
  return -1;
}

function normalizeRobotsPath(value) {
  let result = "";
  for (let index = 0; index < value.length; ) {
    if (value[index] === "%" && /^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) {
      const hex = value.slice(index + 1, index + 3).toUpperCase();
      const decoded = String.fromCharCode(Number.parseInt(hex, 16));
      result += /^[a-z0-9._~-]$/i.test(decoded) ? decoded : `%${hex}`;
      index += 3;
      continue;
    }

    const codePoint = value.codePointAt(index);
    const symbol = String.fromCodePoint(codePoint);
    result +=
      codePoint > 0x7f
        ? encodeURIComponent(symbol).replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase())
        : symbol;
    index += symbol.length;
  }
  return result;
}

function robotsPatternMatchesNormalized(pattern, normalizedPath) {
  const anchored = pattern.endsWith("$");
  const rawGlob = anchored ? pattern.slice(0, -1) : pattern;
  const glob = normalizeRobotsPath(rawGlob);
  if (!glob.includes("*")) {
    return anchored ? normalizedPath === glob : normalizedPath.startsWith(glob);
  }

  const leadingWildcard = glob.startsWith("*");
  const trailingWildcard = glob.endsWith("*");
  const segments = glob.split("*").filter(Boolean);
  if (!segments.length) return true;

  let cursor = 0;
  let segmentIndex = 0;
  if (!leadingWildcard) {
    if (!normalizedPath.startsWith(segments[0])) return false;
    cursor = segments[0].length;
    segmentIndex = 1;
  }

  let searchEnd = normalizedPath.length;
  let searchableSegments = segments.length;
  if (anchored && !trailingWildcard) {
    const last = segments.at(-1);
    if (!normalizedPath.endsWith(last)) return false;
    searchEnd = normalizedPath.length - last.length;
    searchableSegments -= 1;
  }

  for (; segmentIndex < searchableSegments; segmentIndex += 1) {
    const foundAt = findLiteral(normalizedPath, segments[segmentIndex], cursor, searchEnd);
    if (foundAt < 0) return false;
    cursor = foundAt + segments[segmentIndex].length;
  }

  return cursor <= searchEnd;
}

export function robotsPatternMatches(pattern, path) {
  return robotsPatternMatchesNormalized(pattern, normalizeRobotsPath(path));
}

function robotsRuleSpecificity(pattern) {
  const normalized = normalizeRobotsPath(pattern);
  let length = 0;
  for (let index = 0; index < normalized.length; ) {
    if (normalized[index] === "%" && /^[0-9A-F]{2}$/.test(normalized.slice(index + 1, index + 3))) {
      length += 1;
      index += 3;
    } else {
      length += 1;
      index += 1;
    }
  }
  return length;
}

export function evaluateRobotsTxt(text, targetUrl) {
  const groups = [];
  let current = null;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line || !line.includes(":")) continue;
    const separator = line.indexOf(":");
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ type: key, pattern: value });
    }
  }

  const targetAgent = "googlebot";
  const candidates = groups.map((group) => ({
    group,
    specificity: Math.max(
      ...group.agents.map((agent) =>
        agent === "*"
          ? 0
          : agent === targetAgent || agent === `${targetAgent}*` || agent.startsWith(`${targetAgent}/`)
            ? targetAgent.length
            : -1
      )
    ),
  }));
  const highestSpecificity = Math.max(-1, ...candidates.map(({ specificity }) => specificity));
  const applicable = candidates
    .filter(({ specificity }) => specificity >= 0 && specificity === highestSpecificity)
    .map(({ group }) => group);
  const path = `${targetUrl.pathname}${targetUrl.search}` || "/";
  const normalizedPath = normalizeRobotsPath(path);
  const applicableRules = applicable.flatMap((group) => group.rules);
  const estimatedWork = applicableRules.reduce(
    (sum, rule) => sum + normalizedPath.length + rule.pattern.length,
    0
  );
  if (applicableRules.length > MAX_ROBOTS_RULES || estimatedWork > MAX_ROBOTS_MATCH_WORK) {
    return { allowed: null, matchedRule: null, indeterminate: true };
  }

  const matching = applicableRules
    .filter((rule) => robotsPatternMatchesNormalized(rule.pattern, normalizedPath))
    .map((rule) => ({ rule, specificity: robotsRuleSpecificity(rule.pattern) }))
    .sort((a, b) => b.specificity - a.specificity);

  if (!matching.length) return { allowed: true, matchedRule: null };
  const longest = matching[0].specificity;
  const ties = matching.filter(({ specificity }) => specificity === longest);
  const winner = ties.find(({ rule }) => rule.type === "allow") || ties[0];
  return { allowed: winner.rule.type === "allow", matchedRule: winner.rule };
}

function safeAbsoluteUrl(value, base) {
  try {
    const result = new URL(value, base);
    if (!['http:', 'https:'].includes(result.protocol)) return null;
    result.hash = "";
    return result;
  } catch {
    return null;
  }
}

function equivalentUrl(a, b) {
  const normalize = (value) => {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  };
  try {
    return normalize(a) === normalize(b);
  } catch {
    return false;
  }
}

function jsonLdTypes(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(jsonLdTypes);
  const types = [];
  if (value["@type"]) {
    types.push(...(Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]]));
  }
  if (value["@graph"]) types.push(...jsonLdTypes(value["@graph"]));
  return types.map(String);
}

const CMS_SIGNATURES = [
  {
    name: "WordPress",
    signals: [
      [6, "generator meta", ({ generator }) => /\bwordpress\b/i.test(generator)],
      [3, "wp-content URL", ({ assets }) => /(?:^|\/)wp-content(?:\/|$)/im.test(assets)],
      [3, "wp-includes URL", ({ assets }) => /(?:^|\/)wp-includes(?:\/|$)/im.test(assets)],
      [4, "WordPress REST API", ({ apiLinks }) => apiLinks.includes("https://api.w.org/")],
    ],
  },
  {
    name: "Shopify",
    signals: [
      [6, "generator meta", ({ generator }) => /\bshopify\b/i.test(generator)],
      [4, "Shopify CDN", ({ assets }) => /cdn\.shopify\.com|shopifycloud\/storefront/i.test(assets)],
      [3, "Shopify JavaScript", ({ html }) => /(?:window\.)?Shopify\.(?:theme|shop|routes)/.test(html)],
    ],
  },
  {
    name: "Wix",
    signals: [
      [6, "generator meta", ({ generator }) => /\bwix(?:\.com)?\b/i.test(generator)],
      [4, "Wix Static CDN", ({ assets }) => /wixstatic\.com|static\.parastorage\.com/i.test(assets)],
      [3, "Wix Thunderbolt", ({ html }) => /thunderbolt-app|wix-viewer-model/i.test(html)],
    ],
  },
  {
    name: "Squarespace",
    signals: [
      [6, "generator meta", ({ generator }) => /\bsquarespace\b/i.test(generator)],
      [4, "Squarespace CDN", ({ assets }) => /static(?:1)?\.squarespace\.com/i.test(assets)],
      [3, "Squarespace属性", ({ html }) => /data-squarespace-|squarespace-cdn/i.test(html)],
    ],
  },
  {
    name: "Webflow",
    signals: [
      [6, "generator meta", ({ generator }) => /\bwebflow\b/i.test(generator)],
      [4, "Webflow属性", ({ html }) => /data-wf-(?:page|site)/i.test(html)],
      [3, "Webflowアセット", ({ assets }) => /(?:^|[/.])webflow\.(?:css|js)(?:$|\?)/im.test(assets)],
    ],
  },
  {
    name: "Drupal",
    signals: [
      [6, "generator情報", ({ generator, headers }) => /\bdrupal\b/i.test(`${generator} ${headers}`)],
      [4, "Drupal属性", ({ html }) => /data-drupal-selector|drupalSettings/i.test(html)],
      [3, "Drupal公開ファイル", ({ assets }) => /\/sites\/(?:default|all)\/files\//i.test(assets)],
    ],
  },
  {
    name: "Joomla!",
    signals: [
      [6, "generator meta", ({ generator }) => /\bjoomla!?\b/i.test(generator)],
      [4, "Joomlaシステムアセット", ({ assets }) => /\/media\/system\/(?:js|css)\//i.test(assets)],
      [3, "JoomlaコンポーネントURL", ({ assets }) => /[?&]option=com_[a-z0-9_-]+/i.test(assets)],
    ],
  },
  {
    name: "Ghost",
    signals: [
      [6, "generator meta", ({ generator }) => /\bghost\b/i.test(generator)],
      [4, "Ghost Content API", ({ html }) => /ghost-(?:content-api|sdk)|\/ghost\/api\//i.test(html)],
    ],
  },
  {
    name: "HubSpot CMS",
    signals: [
      [6, "generator meta", ({ generator }) => /\bhubspot\b/i.test(generator)],
      [4, "HubSpotアセット", ({ assets }) => /js\.hs-scripts\.com|static\.hsappstatic\.net/i.test(assets)],
      [3, "HubSpot CMS属性", ({ html }) => /data-hs-cos-general-type|hs_cos_wrapper/i.test(html)],
    ],
  },
];

function detectCmsFromDocument($, headers = {}, rawHtml = "") {
  const generator = $("meta[name]")
    .toArray()
    .filter((node) => cleanText($(node).attr("name")).toLowerCase() === "generator")
    .map((node) => cleanText($(node).attr("content")))
    .filter(Boolean)
    .join(" / ");
  const assets = $("script[src], link[href], img[src], source[src], a[href]")
    .toArray()
    .map((node) => cleanText($(node).attr("src") || $(node).attr("href")))
    .filter(Boolean)
    .join("\n");
  const apiLinks = $("link[rel]")
    .toArray()
    .flatMap((node) => cleanText($(node).attr("rel")).toLowerCase().split(/\s+/));
  const headerText = [headers["x-generator"], headers["x-powered-by"]].flat().filter(Boolean).join(" / ");
  const context = { generator, assets, apiLinks, headers: headerText, html: rawHtml };
  const best = CMS_SIGNATURES.map((cms) => {
    const matched = cms.signals.filter(([, , test]) => test(context));
    return {
      name: cms.name,
      score: matched.reduce((sum, [weight]) => sum + weight, 0),
      evidence: matched.map(([, label]) => label),
    };
  }).sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < 3) {
    return {
      name: "判定できません",
      version: "",
      confidence: "low",
      evidence: ["既知CMSの公開シグネチャなし"],
    };
  }

  const versionMatch = generator.match(/\b(?:wordpress|shopify|wix(?:\.com)?|squarespace|webflow|drupal|joomla!?|ghost|hubspot)\s*([0-9][0-9.]*)/i);
  return {
    name: best.name,
    version: versionMatch?.[1] || "",
    confidence: best.score >= 6 ? "high" : "medium",
    evidence: best.evidence,
  };
}

export function detectCms(html, headers = {}) {
  const source = String(html || "");
  return detectCmsFromDocument(cheerio.load(source), headers, source);
}

function analyzeDocument(page, robotsResult) {
  const $ = cheerio.load(page.text);
  const finalUrl = new URL(page.finalUrl);
  const issues = [];

  const titles = $("head title")
    .toArray()
    .map((node) => cleanText($(node).text()))
    .filter(Boolean);
  const descriptions = listMetaByName($, ["description"]);
  const metaRobotDirectives = listMetaByName($, ["robots", "googlebot"], true);
  const xRobotHeaders = Array.isArray(page.headers["x-robots-tag"])
    ? page.headers["x-robots-tag"]
    : [page.headers["x-robots-tag"] || ""];
  const robotDirectives = [...metaRobotDirectives, ...xRobotHeaders].filter(Boolean);
  const applicableDirectiveTokens = [
    ...metaRobotDirectives.flatMap(directiveTokens),
    ...parseApplicableXRobotsTags(xRobotHeaders),
  ];
  const canonicalNodes = listLinkByRel($, "canonical");
  const canonicalValues = canonicalNodes.map((node) => cleanText($(node).attr("href"))).filter(Boolean);
  const h1s = $("h1")
    .toArray()
    .map((node) => cleanText($(node).text()))
    .filter(Boolean);
  const viewport = listMetaByName($, ["viewport"])[0] || "";
  const images = $("img").toArray();
  const imagesMissingAlt = images.filter((node) => $(node).attr("alt") === undefined);
  const anchors = $("a").toArray();
  const brokenLinkElements = anchors.filter((node) => {
    const href = cleanText($(node).attr("href"));
    return !href || href === "#" || /^javascript:/i.test(href);
  });
  const genericAnchors = anchors.filter((node) => {
    const href = cleanText($(node).attr("href"));
    if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) return false;
    const label = cleanText($(node).text() || $(node).attr("aria-label") || $(node).attr("title")).toLowerCase();
    const imageAlt = cleanText($(node).find("img").first().attr("alt")).toLowerCase();
    return GENERIC_ANCHORS.has(label || imageAlt);
  });

  const bodyClone = $("body").clone();
  bodyClone.find("script,style,noscript,template,svg").remove();
  const visibleText = cleanText(bodyClone.text());
  const htmlLang = cleanText($("html").attr("lang"));
  const cms = detectCmsFromDocument($, page.headers, page.text);

  issues.push(
    makeIssue({
      id: "http-status",
      category: "crawl",
      status: page.status === 200 ? "pass" : "critical",
      title: page.status === 200 ? "ページはHTTP 200で応答しています" : `HTTP ${page.status}で応答しています`,
      summary:
        page.status === 200
          ? "Googleが取得できる成功ステータスです。"
          : "インデックス対象ページは原則としてHTTP 200で応答する必要があります。",
      detected: `最終ステータス: HTTP ${page.status}`,
      impact: "Googleはエラーステータスで返るページを通常インデックスしません。",
      fix: "公開対象URLがHTTP 200を返すよう、転送設定、公開状態、サーバーエラーを確認してください。",
      sourceIds: ["googleTechnical"],
      origin: "google_requirement",
    })
  );

  if (page.status !== 200) {
    return finalizeReport(
      page,
      issues,
      {
        status: page.status,
        redirects: page.redirects.length,
        bytes: page.byteLength,
        title: "",
        description: "",
        h1Count: 0,
        imageCount: 0,
        linkCount: 0,
        textLength: 0,
        language: "未判定",
        schemaTypes: [],
        cms: {
          name: "未判定",
          version: "",
          confidence: "low",
          evidence: ["HTTP 200でないため判定対象外"],
        },
      },
      ["HTTP 200でないため、取得したエラーページのtitle・見出し・本文などは評価していません。"]
    );
  }

  if (robotsResult?.status >= 200 && robotsResult?.status < 300) {
    const decision = evaluateRobotsTxt(robotsResult.text, finalUrl);
    issues.push(
      decision.indeterminate
        ? makeIssue({
            id: "robots-access",
            category: "crawl",
            status: "info",
            title: "robots.txtのルール量が多いため要確認です",
            summary: "安全な処理上限を超えたため、この診断ではGooglebotのクロール可否を確定していません。",
            detected: "自動判定上限を超過",
            impact: "この診断結果だけでは入力URLのクロール可否を判断できません。",
            fix: "Search ConsoleのURL検査で確認し、不要なrobots.txtルールを整理してください。",
            sourceIds: ["googleRobots", "googleRobotsSpec"],
            origin: "manual",
            confidence: "low",
          })
        : makeIssue({
            id: "robots-access",
            category: "crawl",
            status: decision.allowed ? "pass" : "critical",
            title: decision.allowed
              ? "robots.txtでクロールを妨げていません"
              : "robots.txtでクロールがブロックされています",
            summary: decision.allowed
              ? "Googlebot向けの該当Disallowは見つかりませんでした。"
              : `入力URLに ${decision.matchedRule?.type}: ${decision.matchedRule?.pattern} が一致しました。`,
            detected: decision.matchedRule
              ? `${decision.matchedRule.type}: ${decision.matchedRule.pattern}`
              : "該当ルールなし",
            impact: "Googlebotがページを取得できない場合、内容の理解や更新が妨げられます。",
            fix: "公開対象ページならrobots.txtのDisallow対象から外し、Search ConsoleのURL検査で確認してください。",
            sourceIds: ["googleRobots", "googleRobotsSpec", "googleTechnical"],
            origin: "google_requirement",
          })
    );
  } else if (
    robotsResult?.status >= 400 &&
    robotsResult?.status < 500 &&
    robotsResult?.status !== 429
  ) {
    issues.push(
      makeIssue({
        id: "robots-access",
        category: "crawl",
        status: "pass",
        title: "robots.txtによるクロール制限はありません",
        summary: `robots.txtがHTTP ${robotsResult.status}の場合、Googleは有効なrobots.txtがないものとして扱います。`,
        detected: `robots.txt: HTTP ${robotsResult.status}`,
        impact: "入力URLへのクロール制限は検出されませんでした。",
        fix: "変更は不要です。robots.txtは必要な場合だけ設置してください。",
        sourceIds: ["googleRobots", "googleRobotsSpec"],
        origin: "google_requirement",
      })
    );
  } else {
    issues.push(
      makeIssue({
        id: "robots-access",
        category: "crawl",
        status: "info",
        title: "robots.txtを確認できませんでした",
        summary: "ページ本体の診断は続行しましたが、robots.txtは低確度の要確認として扱っています。",
        detected: robotsResult?.error || `HTTP ${robotsResult?.status || "不明"}`,
        impact: "この診断ではGooglebotのクロール可否を確定できません。",
        fix: "Search ConsoleのURL検査でGooglebotのアクセス可否を確認してください。",
        sourceIds: ["googleRobots", "googleRobotsSpec"],
        origin: "manual",
        confidence: "low",
      })
    );
  }

  const hasNoindex = applicableDirectiveTokens.includes("noindex") || applicableDirectiveTokens.includes("none");
  issues.push(
    makeIssue({
      id: "index-directive",
      category: "crawl",
      status: hasNoindex ? "critical" : "pass",
      title: hasNoindex ? "noindexが設定されています" : "noindexは検出されませんでした",
      summary: hasNoindex
        ? "meta robotsまたはX-Robots-Tagが検索結果への掲載を止める設定です。"
        : "取得したHTMLとレスポンスヘッダーにはnoindexがありません。",
      detected: robotDirectives.length ? robotDirectives.join(" / ") : "index制御なし",
      impact: "noindexが処理されると、このページはGoogle検索結果に表示されません。",
      fix: "公開対象ページならnoindexを削除し、Googleが再クロールできる状態でSearch Consoleから確認してください。",
      sourceIds: ["googleRobotsMeta", "googleTechnical"],
      origin: "google_requirement",
      caveat: "非公開・完了・重複ページなど、意図したnoindexであれば修正は不要です。",
    })
  );

  issues.push(
    makeIssue({
      id: "https",
      category: "mobile",
      status: finalUrl.protocol === "https:" ? "pass" : "warning",
      title: finalUrl.protocol === "https:" ? "HTTPSで配信されています" : "HTTPSではありません",
      summary:
        finalUrl.protocol === "https:"
          ? "通信が暗号化されたURLでページを取得しました。"
          : "入力URLの最終到達先がHTTPです。",
      detected: finalUrl.protocol.replace(":", "").toUpperCase(),
      impact: "HTTPSは利用者の通信を保護し、ページ体験の安全性に関係します。",
      fix: "有効なTLS証明書を設定し、HTTPからHTTPSへ恒久的にリダイレクトしてください。",
      sourceIds: ["googleTechnical", "semrushTechnical"],
      origin: "google_recommendation",
    })
  );

  if (!titles.length) {
    issues.push(
      makeIssue({
        id: "title",
        category: "search",
        status: "critical",
        title: "title要素がありません",
        summary: "検索結果のタイトルリンク候補になるtitle要素を取得できませんでした。",
        detected: "<title> なし",
        impact: "Googleがページ内容を端的に表すタイトルを生成しにくくなります。",
        fix: "ページ固有の内容を簡潔に表すtitle要素をhead内に追加してください。",
        sourceIds: ["googleTitle", "ahrefsTitle"],
        origin: "google_recommendation",
      })
    );
  } else {
    issues.push(
      makeIssue({
        id: "title",
        category: "search",
        status: titles.length > 1 ? "warning" : "pass",
        title: titles.length > 1 ? "title要素が複数あります" : "title要素を確認できました",
        summary:
          titles.length > 1
            ? `${titles.length}個のtitle要素があります。主題を示す1つのtitleに整理してください。`
            : titles[0],
        detected: titles.join(" / "),
        impact: "titleはGoogleが検索結果のタイトルリンクを生成する主要な情報源です。",
        fix: "ページごとに内容を正確に表すtitleを1つ設定してください。",
        sourceIds: ["googleTitle", "ahrefsTitle"],
        origin: "google_recommendation",
      })
    );

    if (titles[0].length > 60) {
      issues.push(
        makeIssue({
          id: "title-display-length",
          category: "search",
          status: "info",
          title: "titleが検索結果で省略される可能性があります",
          summary: `現在のtitleは${titles[0].length}文字です。Googleに固定文字数上限はありませんが、端末幅に応じて省略されます。`,
          detected: `${titles[0].length}文字 — ${titles[0]}`,
          impact: "重要な語句が後半にあると、検索結果で見えない場合があります。",
          fix: "検索意図とページ内容を保ったまま、重要な情報を前半へ置けるか確認してください。",
          sourceIds: ["googleTitle", "ahrefsTitle"],
          origin: "vendor_heuristic",
          caveat: "文字数だけでSEO上の合否は決まりません。",
        })
      );
    }
  }

  if (!descriptions.length || !descriptions[0]) {
    issues.push(
      makeIssue({
        id: "meta-description",
        category: "search",
        status: "warning",
        title: "meta descriptionが未設定です",
        summary: "ページ固有の説明文を取得できませんでした。",
        detected: '<meta name="description"> なし',
        impact: "Googleは本文からスニペットを生成できますが、適切な説明文は検索結果で使われる場合があります。",
        fix: "ページ内容を正確に要約し、利用者が訪問判断できる固有の説明文を設定してください。",
        sourceIds: ["googleSnippet", "ahrefsMeta"],
        origin: "google_recommendation",
      })
    );
  } else {
    issues.push(
      makeIssue({
        id: "meta-description",
        category: "search",
        status: descriptions.length > 1 ? "warning" : "pass",
        title: descriptions.length > 1 ? "meta descriptionが複数あります" : "meta descriptionを確認できました",
        summary: descriptions.length > 1 ? `${descriptions.length}個検出しました。` : descriptions[0],
        detected: descriptions.join(" / "),
        impact: "Googleはページ内容に適すると判断した場合、meta descriptionをスニペットに利用します。",
        fix: "ページ固有で内容に一致する説明文を1つ設定してください。",
        sourceIds: ["googleSnippet", "ahrefsMeta"],
        origin: "google_recommendation",
      })
    );

    if (descriptions[0].length > 160) {
      issues.push(
        makeIssue({
          id: "meta-description-display-length",
          category: "search",
          status: "info",
          title: "meta descriptionが省略される可能性があります",
          summary: `現在の説明文は${descriptions[0].length}文字です。Googleに固定上限はなく、端末幅や検索語に応じて表示が変わります。`,
          detected: `${descriptions[0].length}文字`,
          impact: "検索結果では説明文の後半が表示されない場合があります。",
          fix: "結論や利用者にとって重要な情報を前半に置けるか確認してください。",
          sourceIds: ["googleSnippet", "ahrefsMeta"],
          origin: "vendor_heuristic",
          caveat: "文字数だけでSEO上の合否は決まりません。",
        })
      );
    }
  }

  if (!canonicalValues.length) {
    issues.push(
      makeIssue({
        id: "canonical",
        category: "crawl",
        status: "info",
        title: "canonicalは設定されていません",
        summary: "canonicalはすべてのページで必須ではありません。重複URLが生じる構成なら設定を検討してください。",
        detected: 'rel="canonical" なし',
        impact: "重複・類似URLがある場合、Googleが別の代表URLを選ぶことがあります。",
        fix: "重複URLが生じるサイトでは、代表URLに一貫したcanonicalシグナルを集めてください。",
        sourceIds: ["googleCanonical", "semrushTechnical"],
        origin: "manual",
        caveat: "未設定だけではSEOエラーとして減点しません。",
      })
    );
  } else {
    const resolvedCanonicals = canonicalValues.map((value) => safeAbsoluteUrl(value, finalUrl));
    const hasInvalidCanonical = resolvedCanonicals.some((value) => !value);
    const httpsToHttp = resolvedCanonicals.some(
      (value) => value && finalUrl.protocol === "https:" && value.protocol === "http:"
    );
    const status = canonicalValues.length > 1 || hasInvalidCanonical || httpsToHttp ? "warning" : "pass";
    const canonical = resolvedCanonicals[0];
    const selfReference = canonical ? equivalentUrl(canonical, finalUrl) : false;
    issues.push(
      makeIssue({
        id: "canonical",
        category: "crawl",
        status,
        title:
          canonicalValues.length > 1
            ? "canonicalが複数あります"
            : hasInvalidCanonical
              ? "canonical URLを解釈できません"
              : httpsToHttp
                ? "HTTPSページからHTTPをcanonical指定しています"
                : selfReference
                  ? "自己参照canonicalを確認できました"
                  : "別URLがcanonicalに指定されています",
        summary: canonicalValues.join(" / "),
        detected: canonicalValues.join(" / "),
        impact: "canonicalは重複・類似ページの代表URLをGoogleへ伝えるシグナルです。",
        fix: "意図した代表URLを1つだけ、完全なURLで指定し、内部リンクやサイトマップのシグナルも揃えてください。",
        sourceIds: ["googleCanonical", "semrushTechnical"],
        origin: "google_recommendation",
        caveat: selfReference ? "" : "別URLへのcanonicalが意図どおりか、サイト管理者が確認してください。",
      })
    );
  }

  issues.push(
    makeIssue({
      id: "indexable-content",
      category: "content",
      status: visibleText ? "pass" : "info",
      title: visibleText ? "初期HTMLに読み取れる本文があります" : "初期HTMLに本文を確認できません",
      summary: visibleText
        ? `取得HTMLから${visibleText.length.toLocaleString("ja-JP")}文字を抽出しました。`
        : "JavaScript実行後に本文が表示される可能性があるため、自動判定を確定できません。",
      detected: visibleText ? `${visibleText.length.toLocaleString("ja-JP")}文字` : "0文字",
      impact: "主要内容がレンダリング後にも存在しない場合、Googleがページの主題を理解できない可能性があります。",
      fix: "Search ConsoleのURL検査でレンダリング後HTMLを確認し、主要内容が操作なしで表示されることを確認してください。",
      sourceIds: ["googleTechnical", "googleMobile"],
      origin: visibleText ? "google_recommendation" : "manual",
      confidence: visibleText ? "high" : "low",
      caveat: visibleText
        ? "固定の最低文字数やキーワード密度は判定していません。"
        : "この診断はJavaScriptを実行しないため、本文なしとは断定していません。",
    })
  );

  if (!h1s.length) {
    issues.push(
      makeIssue({
        id: "main-heading",
        category: "content",
        status: "warning",
        title: "主見出しを確認できません",
        summary: "内容の中心を明確に示すH1が取得HTMLにありません。",
        detected: "H1なし",
        impact: "ページ上の主見出しは、利用者とGoogleがページの主題を把握する手掛かりになります。",
        fix: "ページの主題を端的に示す、視覚的にも明確な主見出しを設けてください。",
        sourceIds: ["googleTitle"],
        origin: "google_recommendation",
      })
    );
  } else {
    issues.push(
      makeIssue({
        id: "main-heading",
        category: "content",
        status: "pass",
        title: "主見出しを確認できました",
        summary: h1s[0],
        detected: h1s.join(" / "),
        impact: "ページ上の主見出しはtitleリンク生成時の情報源にもなります。",
        fix: "ページ内容と見出しの主題が一致しているか、人の目でも確認してください。",
        sourceIds: ["googleTitle"],
        origin: "google_recommendation",
        caveat: h1s.length > 1 ? `H1を${h1s.length}個検出しました。複数H1だけではGoogle要件違反ではありません。` : "",
      })
    );
  }

  issues.push(
    makeIssue({
      id: "viewport",
      category: "mobile",
      status: /width\s*=\s*device-width/i.test(viewport) ? "pass" : "warning",
      title: /width\s*=\s*device-width/i.test(viewport)
        ? "モバイル向けviewportを確認できました"
        : "モバイル向けviewportを確認できません",
      summary: viewport || "viewport metaなし",
      detected: viewport || '<meta name="viewport"> なし',
      impact: "Googleはモバイル版の内容をインデックスとランキングに使用します。",
      fix: 'レスポンシブページでは `<meta name="viewport" content="width=device-width, initial-scale=1">` を設定してください。',
      sourceIds: ["googleMobile"],
      origin: "google_recommendation",
    })
  );

  issues.push(
    makeIssue({
      id: "image-alt",
      category: "content",
      status: !images.length ? "info" : imagesMissingAlt.length ? "warning" : "pass",
      title: !images.length
        ? "画像のalt判定は対象外です"
        : imagesMissingAlt.length
          ? "alt属性がない画像があります"
          : "すべての画像にalt属性があります",
      summary: images.length
        ? `${images.length}件中${imagesMissingAlt.length}件でalt属性がありません。`
        : "画像要素はありません。",
      detected: `${imagesMissingAlt.length} / ${images.length}件`,
      impact: images.length
        ? "Googleはaltテキストと周辺文脈を画像理解に利用し、altはアクセシビリティにも役立ちます。"
        : "このページには判定対象の画像がありません。",
      fix: images.length
        ? "内容画像には文脈に合う簡潔なaltを、装飾画像には空のalt属性を設定してください。"
        : "変更は不要です。画像を追加する場合にaltの用途を確認してください。",
      sourceIds: ["googleImages"],
      origin: images.length ? "google_recommendation" : "manual",
      caveat: "alt内容の品質や、装飾画像かどうかは自動判定していません。",
    })
  );

  issues.push(
    makeIssue({
      id: "crawlable-links",
      category: "links",
      status: !anchors.length ? "info" : brokenLinkElements.length ? "warning" : "pass",
      title: !anchors.length
        ? "リンク形式の判定は対象外です"
        : brokenLinkElements.length
          ? "クロールしにくいリンク要素があります"
          : "リンクはクロール可能な形式です",
      summary: anchors.length
        ? `${anchors.length}件中${brokenLinkElements.length}件がhrefなし、#のみ、またはjavascript形式です。`
        : "リンク要素はありません。",
      detected: `${brokenLinkElements.length} / ${anchors.length}件`,
      impact: anchors.length
        ? "Googleは通常、hrefを持つa要素からリンク先を発見します。"
        : "このページには判定対象のリンクがありません。",
      fix: anchors.length
        ? "ページ遷移には、実際のURLをhrefに持つa要素を使用してください。操作だけならbuttonを使ってください。"
        : "変更は不要です。リンクを追加する場合はhrefを持つa要素を使用してください。",
      sourceIds: ["googleLinks"],
      origin: anchors.length ? "google_recommendation" : "manual",
    })
  );

  issues.push(
    makeIssue({
      id: "anchor-text",
      category: "links",
      status: !anchors.length ? "info" : genericAnchors.length ? "warning" : "pass",
      title: !anchors.length
        ? "アンカーテキストの判定は対象外です"
        : genericAnchors.length
          ? "曖昧なアンカーテキストがあります"
          : "曖昧なアンカーテキストは見つかりません",
      summary: genericAnchors.length
        ? `「${genericAnchors.slice(0, 3).map((node) => cleanText($(node).text())).join("」「")}」など${genericAnchors.length}件を検出しました。`
        : "リンク先の内容が伝わらない定型語は検出されませんでした。",
      detected: `${genericAnchors.length}件`,
      impact: anchors.length
        ? "説明的なリンクテキストは、利用者とGoogleがリンク先の内容を理解する助けになります。"
        : "このページには判定対象のアンカーテキストがありません。",
      fix: anchors.length
        ? "リンクだけを読んでも移動先が分かる、簡潔で具体的なテキストに変更してください。"
        : "変更は不要です。リンクを追加する場合は移動先が分かるテキストを使用してください。",
      sourceIds: ["googleLinks"],
      origin: anchors.length ? "google_recommendation" : "manual",
    })
  );

  const jsonLdNodes = $('script[type="application/ld+json"]').toArray();
  const jsonLdErrors = [];
  const schemaTypes = [];
  for (const node of jsonLdNodes) {
    const raw = $(node).html() || "";
    try {
      schemaTypes.push(...jsonLdTypes(JSON.parse(raw)));
    } catch (error) {
      jsonLdErrors.push(error.message);
    }
  }

  if (!jsonLdNodes.length) {
    issues.push(
      makeIssue({
        id: "structured-data",
        category: "structured",
        status: "info",
        title: "JSON-LD構造化データはありません",
        summary: "ページ種別によっては、対応する構造化データを追加すると検索機能の対象になる可能性があります。",
        detected: "JSON-LDなし",
        impact: "構造化データはリッチリザルトの対象になるための情報ですが、すべてのページで必須ではありません。",
        fix: "Googleが対応するページ種別なら、内容と一致する完全なプロパティを追加し、リッチリザルトテストで確認してください。",
        sourceIds: ["googleStructuredData"],
        origin: "manual",
        caveat: "未設置だけではSEOエラーとして減点しません。",
      })
    );
  } else {
    issues.push(
      makeIssue({
        id: "structured-data",
        category: "structured",
        status: jsonLdErrors.length ? "warning" : "pass",
        title: jsonLdErrors.length ? "JSON-LDに構文エラーがあります" : "JSON-LDを解析できました",
        summary: jsonLdErrors.length
          ? `${jsonLdNodes.length}件中${jsonLdErrors.length}件を解析できませんでした。`
          : schemaTypes.length
            ? `検出タイプ: ${[...new Set(schemaTypes)].join(", ")}`
            : `${jsonLdNodes.length}件を解析しました。`,
        detected: jsonLdErrors[0] || [...new Set(schemaTypes)].join(", ") || `${jsonLdNodes.length}件`,
        impact: "構文や内容に問題がある構造化データは、リッチリザルトの対象にならない場合があります。",
        fix: "Googleのリッチリザルトテストで、構文・必須プロパティ・可視内容との一致を確認してください。",
        sourceIds: ["googleStructuredData"],
        origin: "google_recommendation",
        caveat: "この診断はJSON構文のみを自動判定し、必須プロパティや可視内容との一致は確定しません。",
      })
    );
  }

  const hreflangNodes = listLinkByRel($, "alternate").filter((node) => $(node).attr("hreflang"));
  if (hreflangNodes.length) {
    const invalidHreflang = hreflangNodes.filter((node) => {
      const code = cleanText($(node).attr("hreflang"));
      const href = cleanText($(node).attr("href"));
      const validCode =
        code.toLowerCase() === "x-default" || /^[a-z]{2,3}(?:-[a-z]{4})?(?:-[a-z]{2})?$/i.test(code);
      const resolved = safeAbsoluteUrl(href, finalUrl);
      const absolute = /^https?:\/\//i.test(href);
      return !validCode || !resolved || !absolute;
    });
    issues.push(
      makeIssue({
        id: "hreflang",
        category: "crawl",
        status: invalidHreflang.length ? "warning" : "pass",
        title: invalidHreflang.length ? "hreflangに確認が必要な指定があります" : "hreflangの基本形式を確認できました",
        summary: `${hreflangNodes.length}件中${invalidHreflang.length}件で言語コードまたは完全URLを確認できません。`,
        detected: `${invalidHreflang.length} / ${hreflangNodes.length}件`,
        impact: "hreflangは多言語・多地域ページの適切なURLをGoogleへ伝えます。",
        fix: "有効な言語・地域コードと完全URLを使い、代替ページ間の相互参照と自己参照を確認してください。",
        sourceIds: ["googleHreflang"],
        origin: "google_recommendation",
        caveat: "相互参照やリンク先応答は、単一ページ診断では確定していません。",
      })
    );
  }

  if (page.redirects.length >= 3) {
    issues.push(
      makeIssue({
        id: "redirect-chain",
        category: "crawl",
        status: "info",
        title: "リダイレクトが複数回続いています",
        summary: `${page.redirects.length}回のリダイレクト後に最終URLへ到達しました。`,
        detected: page.redirects.map(({ status, to }) => `${status} → ${to}`).join("\n"),
        impact: "不要な転送は取得時間とクロール効率に影響する場合があります。",
        fix: "内部リンクを最終URLへ更新し、可能なら転送を1回にまとめてください。",
        sourceIds: ["semrushTechnical", "ahrefsAudit"],
        origin: "vendor_heuristic",
      })
    );
  }

  return finalizeReport(page, issues, {
      status: page.status,
      redirects: page.redirects.length,
      bytes: page.byteLength,
      title: titles[0] || "",
      description: descriptions[0] || "",
      h1Count: h1s.length,
      imageCount: images.length,
      linkCount: anchors.length,
      textLength: visibleText.length,
      language: htmlLang || "未指定",
      schemaTypes: [...new Set(schemaTypes)],
      cms,
    });
}

export function auditPage(page, robotsResult = null) {
  return analyzeDocument(page, robotsResult);
}
