import { Icon } from "./Icons";

export function SourceLibrary({ sources }) {
  const google = sources.filter((source) => source.kind === "Google公式");
  const vendors = sources.filter((source) => source.kind !== "Google公式");

  return (
    <main className="library-page">
      <div className="library-intro">
        <div>
          <h1>根拠ライブラリ</h1>
          <p>診断ルールはGoogle公式を優先し、海外大手SEO企業の情報は業界推奨として区別しています。</p>
        </div>
        <div className="evidence-policy">
          <Icon name="shield" size={23} />
          <span>
            <strong>判定方針</strong>
            固定文字数やH1の数だけで、Google要件違反とは判定しません。
          </span>
        </div>
      </div>

      <SourceSection title="Google公式" description="要件・推奨の一次根拠" sources={google} />
      <SourceSection title="海外大手SEO企業" description="実務上の補助根拠・ヒューリスティック" sources={vendors} />

      <section className="scope-note">
        <h2>自動診断で確定しない項目</h2>
        <div>
          <span>検索順位・実際のインデックス登録</span>
          <span>被リンク・競合・ドメイン指標</span>
          <span>独自性・専門性・事実性</span>
          <span>JavaScript実行後だけ現れる内容</span>
        </div>
      </section>
    </main>
  );
}

function SourceSection({ title, description, sources }) {
  return (
    <section className="source-group">
      <div className="source-group-heading">
        <h2>{title}</h2>
        <span>{description}</span>
      </div>
      <div className="source-list">
        {sources.map((source) => (
          <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
            <span className={`source-logo ${source.kind === "Google公式" ? "google" : "vendor"}`}>
              {source.kind === "Google公式" ? "G" : source.publisher.slice(0, 1)}
            </span>
            <span className="source-content">
              <small>{source.publisher}</small>
              <strong>{source.title}</strong>
              <p>{source.summary}</p>
            </span>
            <Icon name="external" size={19} />
          </a>
        ))}
      </div>
    </section>
  );
}
