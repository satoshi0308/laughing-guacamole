import { Icon, PulseMark } from "./Icons";

export function Header({ page, onNavigate }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="brand" type="button" onClick={() => onNavigate("audit")} aria-label="SEO PULSE 診断画面へ">
          <PulseMark />
          <span>SEO PULSE</span>
        </button>

        <nav className="main-nav" aria-label="メインナビゲーション">
          <button
            className={page === "audit" ? "active" : ""}
            type="button"
            onClick={() => onNavigate("audit")}
          >
            <Icon name="search" size={17} />
            診断
          </button>
          <button
            className={page === "sources" ? "active" : ""}
            type="button"
            onClick={() => onNavigate("sources")}
          >
            <Icon name="book" size={17} />
            根拠ライブラリ
          </button>
        </nav>

        <div className="header-note">
          <Icon name="shield" size={17} />
          公開HTML・1ページ診断
        </div>
      </div>
    </header>
  );
}
