import { useEffect, useMemo, useState } from "react";
import { AuditForm } from "./components/AuditForm";
import { CmsSummary } from "./components/CmsSummary";
import { Header } from "./components/Header";
import { Icon } from "./components/Icons";
import { IssueDetail } from "./components/IssueDetail";
import { IssueTable } from "./components/IssueTable";
import { ScoreSummary } from "./components/ScoreSummary";
import { SearchInsights } from "./components/SearchInsights";
import { SourceLibrary } from "./components/SourceLibrary";
import { demoReport } from "./data/demoReport";

const loadingMessages = [
  "ページへ安全に接続しています",
  "クロールとインデックス設定を確認しています",
  "検索結果の表示要素を確認しています",
  "根拠と改善優先度を整理しています",
];

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function downloadReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const hostname = new URL(report.finalUrl).hostname.replace(/[^a-z0-9.-]/gi, "-");
  anchor.href = url;
  anchor.download = `seo-pulse-${hostname}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function LoadingState({ step }) {
  return (
    <section className="loading-state" role="status" aria-live="polite">
      <div className="loading-pulse" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div>
        <strong>{loadingMessages[step]}</strong>
        <span>通常は数秒で完了します</span>
      </div>
      <div className="loading-track" aria-hidden="true">
        <span style={{ width: `${(step + 1) * 25}%` }} />
      </div>
    </section>
  );
}

export default function App() {
  const [page, setPage] = useState("audit");
  const [url, setUrl] = useState("https://example.com/");
  const [report, setReport] = useState(demoReport);
  const [allSources, setAllSources] = useState(demoReport.sources);
  const [selectedId, setSelectedId] = useState(demoReport.issues[0].id);
  const [category, setCategory] = useState("all");
  const [hidePasses, setHidePasses] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/sources")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => setAllSources(data.sources))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading) {
      setLoadingStep(0);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setLoadingStep((current) => Math.min(current + 1, loadingMessages.length - 1));
    }, 900);
    return () => window.clearInterval(timer);
  }, [loading]);

  const selectedIssue = useMemo(
    () => report.issues.find((issue) => issue.id === selectedId) || null,
    [report, selectedId]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "診断できませんでした。");

      setReport(data.report);
      setSelectedId(
        data.report.issues.find((issue) => issue.status === "critical")?.id ||
          data.report.issues.find((issue) => issue.status === "warning")?.id ||
          data.report.issues[0]?.id ||
          null
      );
      setCategory("all");
      setHidePasses(false);
    } catch (requestError) {
      setError(requestError.message || "ページを診断できませんでした。");
    } finally {
      setLoading(false);
    }
  }

  function handleCategoryChange(nextCategory) {
    setCategory(nextCategory);
    if (nextCategory !== "all" && selectedIssue?.category !== nextCategory) {
      const next = report.issues.find(
        (issue) => issue.category === nextCategory && (!hidePasses || issue.status !== "pass")
      );
      setSelectedId(next?.id || null);
    }
  }

  return (
    <div className="app-shell">
      <Header page={page} onNavigate={setPage} />

      {page === "sources" ? (
        <SourceLibrary sources={allSources} />
      ) : (
        <main className="audit-page">
          <AuditForm value={url} onChange={setUrl} onSubmit={handleSubmit} loading={loading} />

          {error ? (
            <div className="error-banner" role="alert">
              <Icon name="alert" size={21} />
              <span>
                <strong>診断を完了できませんでした</strong>
                {error}
              </span>
              <button type="button" onClick={() => setError("")} aria-label="エラーを閉じる">
                <Icon name="close" size={18} />
              </button>
            </div>
          ) : null}

          {loading ? (
            <LoadingState step={loadingStep} />
          ) : (
            <>
              <section className="report-heading">
                <div>
                  <div className="heading-title-line">
                    <h1>改善すべきSEO課題</h1>
                    {report.isDemo ? <span className="demo-label">デモデータ</span> : null}
                  </div>
                  <p>
                    <Icon name="link" size={17} />
                    <a href={report.finalUrl} target="_blank" rel="noreferrer">
                      {report.finalUrl}
                    </a>
                    <i />
                    診断日時: {formatDate(report.auditedAt)}
                  </p>
                </div>
                <button className="download-button" type="button" onClick={() => downloadReport(report)}>
                  <Icon name="download" size={18} />
                  JSONレポートを保存
                </button>
              </section>

              <ScoreSummary report={report} />
              <CmsSummary cms={report.facts?.cms} />
              <SearchInsights insights={report.searchInsights} />

              <div className="report-workspace">
                <IssueTable
                  report={report}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  category={category}
                  onCategoryChange={handleCategoryChange}
                  hidePasses={hidePasses}
                  onHidePasses={setHidePasses}
                />
                <IssueDetail
                  issue={selectedIssue}
                  sources={report.sources}
                  onClose={() => setSelectedId(null)}
                />
              </div>

              <footer className="report-footer">
                <Icon name="shield" size={17} />
                <span>取得できる公開情報のみを診断しています</span>
                <button type="button" onClick={() => setPage("sources")}>
                  判定根拠を見る
                  <Icon name="chevron" size={16} />
                </button>
              </footer>
            </>
          )}
        </main>
      )}
    </div>
  );
}
