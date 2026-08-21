import { Icon } from "./Icons";

const confidenceLabels = {
  high: "高",
  medium: "中",
  low: "低",
};

export function CmsSummary({ cms }) {
  const result = cms || {
    name: "判定できません",
    version: "",
    confidence: "low",
    evidence: ["判定情報なし"],
  };
  const displayName = result.version ? `${result.name} ${result.version}` : result.name;

  return (
    <section className="cms-summary" aria-label="CMS判定">
      <span className="cms-icon" aria-hidden="true">
        <Icon name="file" size={22} />
      </span>
      <div className="cms-result">
        <span>CMS判定</span>
        <strong>{displayName}</strong>
      </div>
      <div className="cms-evidence">
        <span>検出根拠</span>
        <strong>{result.evidence?.join("、") || "公開シグネチャなし"}</strong>
      </div>
      <span className={`cms-confidence ${result.confidence || "low"}`}>
        判定確度: {confidenceLabels[result.confidence] || "低"}
      </span>
      <small>公開HTML・レスポンスヘッダーから推定。CMS側で情報を隠している場合は判定できません。</small>
    </section>
  );
}
