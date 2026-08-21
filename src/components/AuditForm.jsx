import { Icon } from "./Icons";

export function AuditForm({ value, onChange, onSubmit, loading }) {
  return (
    <form className="audit-form" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="audit-url">
        診断する公開ページURL
      </label>
      <div className="url-field">
        <Icon name="link" size={21} />
        <input
          id="audit-url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck="false"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://example.com/"
          disabled={loading}
        />
      </div>
      <button className="audit-submit" type="submit" disabled={loading}>
        {loading ? <span className="button-spinner" aria-hidden="true" /> : <Icon name="search" size={19} />}
        {loading ? "診断中" : "診断する"}
      </button>
    </form>
  );
}
