import { Icon } from "./Icons";

const statusMeta = {
  critical: { label: "重要", icon: "alert" },
  warning: { label: "改善", icon: "warning" },
  info: { label: "提案", icon: "info" },
  pass: { label: "合格", icon: "check" },
};

export const categories = [
  ["all", "すべて"],
  ["search", "検索表示"],
  ["crawl", "クロール"],
  ["content", "コンテンツ"],
  ["structured", "構造化データ"],
  ["links", "リンク"],
  ["mobile", "モバイル"],
];

function categoryCount(issues, category) {
  return category === "all" ? issues.length : issues.filter((issue) => issue.category === category).length;
}

function primarySource(issue, sourceMap) {
  return sourceMap[issue.sourceIds?.[0]];
}

export function IssueTable({ report, selectedId, onSelect, category, onCategoryChange, hidePasses, onHidePasses }) {
  const sourceMap = Object.fromEntries(report.sources.map((source) => [source.id, source]));
  const filtered = report.issues.filter(
    (issue) => (category === "all" || issue.category === category) && (!hidePasses || issue.status !== "pass")
  );

  return (
    <section className="issues-panel" aria-label="診断項目">
      <div className="category-bar">
        <div className="category-scroll" aria-label="診断カテゴリ">
          {categories.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={category === id}
              className={category === id ? "active" : ""}
              onClick={() => onCategoryChange(id)}
            >
              {label}
              <span>{categoryCount(report.issues, id)}</span>
            </button>
          ))}
        </div>
        <label className="pass-toggle">
          <input type="checkbox" checked={hidePasses} onChange={(event) => onHidePasses(event.target.checked)} />
          <span aria-hidden="true" />
          合格を隠す
        </label>
      </div>

      <div className="issue-head" aria-hidden="true">
        <span>重要度</span>
        <span>課題</span>
        <span>検出内容</span>
        <span>根拠ソース</span>
      </div>

      <div className="issue-list">
        {filtered.length ? (
          filtered.map((issue) => {
            const meta = statusMeta[issue.status];
            const source = primarySource(issue, sourceMap);
            return (
              <button
                className={`issue-row ${issue.status} ${selectedId === issue.id ? "selected" : ""}`}
                key={issue.id}
                type="button"
                onClick={() => onSelect(issue.id)}
                aria-pressed={selectedId === issue.id}
              >
                <span className="severity-cell">
                  <i aria-hidden="true" />
                  <span className="severity-icon">
                    <Icon name={meta.icon} size={21} />
                  </span>
                  <span>{meta.label}</span>
                </span>
                <strong className="issue-title">{issue.title}</strong>
                <span className="issue-summary">{issue.summary}</span>
                <span className="source-cell">
                  <b className={source?.publisher === "Google Search Central" ? "google" : "vendor"}>
                    {source?.publisher === "Google Search Central" ? "G" : source?.publisher?.slice(0, 1) || "—"}
                  </b>
                  <span>{source?.publisher || "要確認"}</span>
                </span>
                <Icon name="chevron" size={18} className="row-chevron" />
              </button>
            );
          })
        ) : (
          <div className="empty-filter">
            <Icon name="check" size={24} />
            この条件に該当する項目はありません
          </div>
        )}
      </div>
    </section>
  );
}
