import { Icon } from "./Icons";

const statusMeta = {
  critical: { label: "重要", icon: "alert" },
  warning: { label: "改善", icon: "warning" },
  info: { label: "提案", icon: "info" },
  pass: { label: "合格", icon: "check" },
};

const originLabels = {
  google_requirement: "Google要件",
  google_recommendation: "Google推奨",
  vendor_heuristic: "業界推奨",
  manual: "要確認",
};

export function IssueDetail({ issue, sources, onClose }) {
  if (!issue) {
    return (
      <aside className="issue-detail detail-empty">
        <Icon name="file" size={28} />
        <strong>項目を選択してください</strong>
        <span>検出内容、改善方法、根拠を表示します。</span>
      </aside>
    );
  }

  const meta = statusMeta[issue.status];
  const sourceMap = Object.fromEntries(sources.map((source) => [source.id, source]));
  const linkedSources = (issue.sourceIds || []).map((id) => sourceMap[id]).filter(Boolean);

  return (
    <aside className={`issue-detail ${issue.status}`} aria-label={`${issue.title}の詳細`}>
      <div className="detail-heading">
        <div>
          <span className="detail-status">
            <Icon name={meta.icon} size={22} />
            {meta.label}
          </span>
          <h2>{issue.title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="詳細を閉じる">
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="origin-line">
        <span>{originLabels[issue.origin] || "参考"}</span>
        <span>判定確度: {issue.confidence === "low" ? "低" : issue.confidence === "medium" ? "中" : "高"}</span>
      </div>

      <section className="detail-section">
        <h3>検出内容</h3>
        <p>{issue.summary}</p>
        <pre>{issue.detected}</pre>
      </section>

      <section className="detail-section">
        <h3>SEOへの影響</h3>
        <p>{issue.impact}</p>
      </section>

      <section className="detail-section">
        <h3>改善方法</h3>
        <p>{issue.fix}</p>
      </section>

      {issue.caveat ? (
        <div className="caveat">
          <Icon name="info" size={18} />
          <span>{issue.caveat}</span>
        </div>
      ) : null}

      <section className="detail-section sources-section">
        <h3>根拠</h3>
        {linkedSources.map((source) => (
          <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
            <span className={`source-logo ${source.publisher === "Google Search Central" ? "google" : "vendor"}`}>
              {source.publisher === "Google Search Central" ? "G" : source.publisher.slice(0, 1)}
            </span>
            <span>
              <strong>{source.publisher}</strong>
              <small>{source.title}</small>
            </span>
            <Icon name="external" size={17} />
          </a>
        ))}
      </section>
    </aside>
  );
}
