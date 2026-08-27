const confidenceLabels = { high: "高", medium: "中", low: "低" };

function InsightList({ title, items, empty = "推定材料が不足しています" }) {
  return (
    <div className="insight-group">
      <h3>{title}</h3>
      {items?.length ? (
        <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : <p>{empty}</p>}
    </div>
  );
}

export function SearchInsights({ insights }) {
  if (!insights) return null;
  return (
    <section className="search-insights" aria-labelledby="search-insights-title">
      <header>
        <div>
          <span>顧客・検索ニーズ分析</span>
          <h2 id="search-insights-title">このページが応えるニーズ</h2>
        </div>
        <strong className={`insight-confidence ${insights.confidence || "low"}`}>
          推定確度: {confidenceLabels[insights.confidence] || "低"}
        </strong>
      </header>
      <div className="insight-grid">
        <InsightList title="取り扱うサービス" items={insights.services} />
        <InsightList title="想定ターゲット" items={insights.targets} />
        <InsightList title="解決する悩み・課題" items={insights.problems} />
        <InsightList title="顕在キーワード" items={insights.explicitKeywords} />
        <InsightList title="潜在キーワード候補" items={insights.latentKeywords} />
        <div className="insight-group">
          <h3>検索意図</h3>
          {insights.intents?.length ? (
            <dl>{insights.intents.map((intent) => (
              <div key={intent.type}><dt>{intent.type}</dt><dd>{intent.reason}</dd></div>
            ))}</dl>
          ) : <p>推定材料が不足しています</p>}
        </div>
      </div>
      <p className="insight-note">{insights.note}</p>
    </section>
  );
}
