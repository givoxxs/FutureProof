import React from "react";
import type { AnalysisSummary } from "./api";

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function shortModel(model?: string): string {
  if (!model) return "—";
  return model.split("/").at(-1) ?? model;
}

function risk(summary: AnalysisSummary, candidate: "A" | "B"): string {
  const value = summary.candidateRisk?.[candidate];
  return typeof value === "number" ? String(Math.round(value)) : "—";
}

export function RecentRunsPanel({
  analyses,
  selectedAnalysisId,
  loading,
  onSelect,
}: {
  analyses: AnalysisSummary[];
  selectedAnalysisId: string | null;
  loading: boolean;
  onSelect: (analysis: AnalysisSummary) => void;
  onStart?: () => void;
}) {
  return <section className="recent-runs-panel" aria-label="Recent Runs">
    <div className="recent-runs-heading">
      <div><p className="eyebrow">History</p><h2>Recent Runs</h2><p>Completed evidence stays available when you start a new analysis.</p></div>
    </div>

    {loading ? <p className="recent-runs-loading" role="status">Loading recent analyses…</p> : analyses.length === 0 ? <div className="recent-runs-empty"><strong>No saved runs yet.</strong><span>Complete an analysis and it will appear here.</span></div> : <div className="recent-runs-list">
      {analyses.map((analysis) => {
        const selectable = analysis.status === "completed";
        const selected = analysis.analysisId === selectedAnalysisId;
        const content = <>
          <span className={`history-status history-status-${analysis.status}`}>{analysis.status}</span>
          <span className="history-id"><code>{analysis.analysisId.slice(0, 12)}</code><small>{formatTime(analysis.createdAt)}</small></span>
          <span className="history-runtime"><strong>{shortModel(analysis.model)}</strong><small>{analysis.provider ?? "—"} · concurrency {analysis.concurrency ?? "—"}</small></span>
          <span className="history-risk history-risk-a"><small>A risk</small><strong>{risk(analysis, "A")}</strong></span>
          <span className="history-risk history-risk-b"><small>B risk</small><strong>{risk(analysis, "B")}</strong></span>
          {analysis.error ? <span className="history-error">{analysis.error}</span> : null}
        </>;

        if (!selectable) return <div key={analysis.analysisId} className={`recent-run-row recent-run-${analysis.status}`}>{content}</div>;
        return <button
          key={analysis.analysisId}
          type="button"
          className={`recent-run-row recent-run-selectable${selected ? " selected" : ""}`}
          aria-label={`Open analysis ${analysis.analysisId}`}
          aria-current={selected ? "true" : undefined}
          onClick={() => onSelect(analysis)}
        >{content}</button>;
      })}
    </div>}
  </section>;
}
