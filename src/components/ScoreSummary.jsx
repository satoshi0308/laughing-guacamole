import { Icon } from "./Icons";

function SummaryItem({ status, label, value }) {
  const icon = status === "critical" ? "alert" : status === "warning" ? "warning" : "check";
  return (
    <div className={`summary-item ${status}`}>
      <Icon name={icon} size={23} />
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

export function ScoreSummary({ report }) {
  const score = report.score ?? 0;
  const issueCount = report.counts.warning + report.counts.info;
  return (
    <>
      <section className="score-summary" aria-label="診断サマリー">
        <div className="score-block">
          <div className="score-ring" style={{ "--score": `${score * 3.6}deg` }} aria-hidden="true">
            <span />
          </div>
          <div className="score-copy">
            <div>
              <strong>{report.score ?? "—"}</strong>
              <span>/ 100</span>
            </div>
            <small>{report.scoreLabel}</small>
          </div>
        </div>
        <SummaryItem status="critical" label="重要" value={report.counts.critical} />
        <SummaryItem status="warning" label="改善・提案" value={issueCount} />
        <SummaryItem status="pass" label="合格" value={report.counts.pass} />
      </section>
      <p className="score-disclaimer">
        <Icon name="info" size={16} />
        生HTML 1ページの独自診断です。Google公式評価・検索順位・実際のインデックス状態ではありません。
        {report.coverage < 100 ? ` 判定率: ${report.coverage}%` : ""}
      </p>
    </>
  );
}
