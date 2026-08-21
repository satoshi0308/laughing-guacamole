export const CORE_WEIGHTS = Object.freeze({
  "http-status": 14,
  "robots-access": 12,
  "index-directive": 14,
  https: 5,
  title: 10,
  "meta-description": 7,
  "indexable-content": 8,
  "main-heading": 5,
  viewport: 5,
});

const STATUS_FACTOR = Object.freeze({ critical: 0, warning: 0.5, pass: 1 });
const INDEX_BLOCKERS = new Set(["http-status", "robots-access", "index-directive"]);

export function calculateCoreScore(issues) {
  const issueMap = new Map(issues.map((issue) => [issue.id, issue]));
  const totalWeight = Object.values(CORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  let assessedWeight = 0;
  let earnedWeight = 0;

  for (const [id, weight] of Object.entries(CORE_WEIGHTS)) {
    const issue = issueMap.get(id);
    if (!issue || !(issue.status in STATUS_FACTOR)) continue;
    assessedWeight += weight;
    earnedWeight += weight * STATUS_FACTOR[issue.status];
  }

  const coverage = Math.round((assessedWeight / totalWeight) * 100);
  let score = coverage < 40 ? null : Math.round((earnedWeight / assessedWeight) * 100);
  const hasIndexBlocker = issues.some((issue) => INDEX_BLOCKERS.has(issue.id) && issue.status === "critical");
  const hasCritical = issues.some((issue) => issue.status === "critical");

  if (hasIndexBlocker && score !== null) score = Math.min(score, 49);

  return {
    score,
    coverage,
    scoreLabel:
      score === null ? "判定不能" : hasCritical || score < 60 ? "要改善" : score < 80 ? "改善余地あり" : "良好",
  };
}
