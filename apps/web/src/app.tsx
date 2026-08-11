import React, { useCallback, useEffect, useRef, useState } from "react";
import { getAnalysis, getArtifact, getScenarioDetail, startDemoAnalysis, subscribeToProgress, type ProgressEvent } from "./api";
import { ReportPage } from "./report-page";
import { RunProgress } from "./run-progress";
import { ScenarioDrawer } from "./scenario-drawer";
import "./workspace.css";

export type AppView = "overview" | "scenarios" | "experiments" | "comparisons" | "reports" | "settings";
type AnalysisState = "idle" | "running" | "completed" | "failed";

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>;
}

const navigation: ReadonlyArray<{ view: AppView; label: string; icon: string }> = [
  { view: "overview", label: "Overview", icon: "⌂" },
  { view: "scenarios", label: "Future Scenarios", icon: "◈" },
  { view: "experiments", label: "Experiments", icon: "▣" },
  { view: "comparisons", label: "Comparisons", icon: "⌁" },
  { view: "reports", label: "Reports", icon: "▤" },
  { view: "settings", label: "Settings", icon: "⚙" },
];

const frozenScenarioFallback = [
  { id: "FR-01", title: "Add SMS Notifications", difficulty: "medium", dimension: "Breadth" },
  { id: "FR-02", title: "Per-user Preferences", difficulty: "medium", dimension: "Policy" },
  { id: "FR-03", title: "Exponential Retry", difficulty: "easy", dimension: "Reliability" },
  { id: "FR-04", title: "Provider Fallback", difficulty: "hard", dimension: "Resilience" },
  { id: "FR-05", title: "Push Notifications", difficulty: "medium", dimension: "Breadth" },
] as const;

function Sidebar({
  view,
  analysisState,
  onNavigate,
  onNewAnalysis,
}: {
  view: AppView;
  analysisState: AnalysisState;
  onNavigate: (next: AppView) => void;
  onNewAnalysis: () => void;
}) {
  return <aside className="app-sidebar">
    <div className="brand"><BrandMark /><div><strong>FutureProof</strong></div></div>
    <button className="new-analysis-button" type="button" disabled={analysisState === "running"} onClick={onNewAnalysis}>＋ New Analysis</button>
    <nav aria-label="Primary navigation">
      {navigation.map((item) => <button
        key={item.view}
        type="button"
        className={item.view === view ? "nav-item active" : "nav-item"}
        aria-current={item.view === view ? "page" : undefined}
        onClick={() => onNavigate(item.view)}
      ><span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}</button>)}
    </nav>
    <div className="sidebar-analysis">
      <span className="sidebar-method-label">Active analysis</span>
      <strong>Notification System PR</strong>
      <p>PR #42 vs PR #84</p>
      <span className="analysis-live"><span aria-hidden="true" />{analysisState === "running" ? "experiment running" : analysisState === "completed" ? "analysis complete" : "same base requirement"}</span>
    </div>
    <div className="sidebar-footer"><span className="shield-icon" aria-hidden="true">✓</span><span>Frozen scenarios<br />Evidence-backed results</span></div>
  </aside>;
}

function SetupPage({ onStart, busy, error }: { onStart: () => void; busy: boolean; error: string | null }) {
  return <div className="setup-page">
    <header className="setup-header"><p className="eyebrow">Reverie Hacks 2026 · Software Engineering</p><h1>Which implementation will age better?</h1><p>Both candidate PRs pass today's tests. FutureProof applies plausible future requirements and measures which architecture makes tomorrow's work harder.</p></header>
    <section className="setup-grid">
      <div className="setup-panel">
        <div className="panel-number">01</div><div><span className="panel-label">Base requirement</span><h2>Shipment notification delivery tracking</h2><p>Send shipment email and record whether delivery succeeded or failed.</p></div>
      </div>
      <div className="candidate-setup candidate-a">
        <div className="candidate-setup-head"><span>Candidate A</span><strong>PR #42</strong></div><h3>Decoupled delivery tracking</h3><p>Sending and tracking responsibilities remain separate while preserving current behavior.</p><div className="setup-proof"><span>Current tests</span><strong>22 / 22 ✓</strong></div>
      </div>
      <div className="candidate-setup candidate-b">
        <div className="candidate-setup-head"><span>Candidate B</span><strong>PR #84</strong></div><h3>Inline coupled tracking</h3><p>A plausible small-feature implementation couples delivery, provider identity, tracking and failure flow.</p><div className="setup-proof"><span>Current tests</span><strong>22 / 22 ✓</strong></div>
      </div>
    </section>
    <section className="experiment-contract">
      <div><span>Future scenarios</span><strong>5 frozen tasks</strong></div>
      <div><span>Fairness</span><strong>Same model + budget</strong></div>
      <div><span>Evidence</span><strong>Tests + edits + regression</strong></div>
      <div><span>Hard scenario</span><strong>3 repeated trials</strong></div>
    </section>
    <div className="start-row"><div><strong>Ready to run the controlled experiment</strong><span>Live execution requires configured LLM credentials on the API server.</span>{error ? <span role="alert" className="setup-error">{error}</span> : null}</div><button className="primary-button start-button" type="button" disabled={busy} onClick={onStart}>{busy ? "Starting…" : "Start Analysis →"}</button></div>
  </div>;
}

function WorkspaceStatusPage({ state, onNavigate, onStart }: { state: AnalysisState; onNavigate: (view: AppView) => void; onStart: () => void }) {
  if (state === "completed") return <section className="workspace-page"><p className="eyebrow">Overview</p><h1>Analysis complete</h1><p>The controlled experiment finished and the evidence report is ready. You can inspect the run history or jump directly to the comparison report without losing this analysis.</p><div className="workspace-actions"><button className="primary-button" type="button" onClick={() => onNavigate("reports")}>Open report</button><button className="secondary-button" type="button" onClick={() => onNavigate("experiments")}>View experiment</button></div></section>;
  if (state === "running") return <section className="workspace-page"><p className="eyebrow">Overview</p><h1>Analysis in progress</h1><p>The experiment is running in isolated sandboxes. Navigate freely while the run continues.</p><div className="workspace-actions"><button className="primary-button" type="button" onClick={() => onNavigate("experiments")}>View live experiment</button></div></section>;
  if (state === "failed") return <section className="workspace-page"><p className="eyebrow">Overview</p><h1>Analysis stopped</h1><p>The last experiment did not finish. Open Experiments for the failure detail, then start a new run when ready.</p><div className="workspace-actions"><button className="primary-button" type="button" onClick={() => onNavigate("experiments")}>Open failure detail</button><button className="secondary-button" type="button" onClick={onStart}>Retry analysis</button></div></section>;
  return null;
}

function FutureScenariosPage({ report }: { report: any }) {
  const scenarios = Array.isArray(report?.scenarios) && report.scenarios.length > 0 ? report.scenarios : frozenScenarioFallback;
  return <section className="workspace-page"><p className="eyebrow">Frozen benchmark</p><h1>Future Scenarios</h1><p>These scenarios are fixed before Candidate A or B is executed, so both implementations face the same future-change pressure.</p><div className="workspace-scenario-list">{scenarios.map((scenario: any) => <article key={scenario.id} className="workspace-scenario-card"><div><span>{scenario.id}</span><strong>{scenario.title}</strong></div><dl><div><dt>Difficulty</dt><dd>{scenario.difficulty}</dd></div><div><dt>Dimension</dt><dd>{scenario.dimension}</dd></div></dl></article>)}</div></section>;
}

function ExperimentPage({ state, analysisId, events, error, onStart, onNavigate }: { state: AnalysisState; analysisId: string | null; events: ProgressEvent[]; error: string | null; onStart: () => void; onNavigate: (view: AppView) => void }) {
  if (state === "running" && analysisId) return <RunProgress analysisId={analysisId} events={events} />;
  if (state === "failed") return <div className="failure-page"><p className="eyebrow">Analysis stopped</p><h1>The experiment could not complete.</h1><p>{error}</p><button className="primary-button" type="button" onClick={onStart}>Retry analysis</button></div>;
  if (state === "completed") return <section className="workspace-page"><p className="eyebrow">Experiment</p><h1>Experiment completed</h1><p>All configured candidate/scenario trials have reached a terminal state. The deterministic comparison report is ready.</p><div className="workspace-actions"><button className="primary-button" type="button" onClick={() => onNavigate("reports")}>Open report</button></div></section>;
  return <section className="workspace-page"><p className="eyebrow">Experiment</p><h1>Experiments</h1><p>No analysis is running yet. Start the controlled A/B experiment from here or from Overview.</p><div className="workspace-actions"><button className="primary-button" type="button" onClick={onStart}>Start Analysis →</button></div></section>;
}

function ComparisonPage({ report, onNavigate }: { report: any; onNavigate: (view: AppView) => void }) {
  if (!report) return <section className="workspace-page"><p className="eyebrow">Comparison</p><h1>Candidate Comparison</h1><p>Run an analysis first. FutureProof will compare the two working implementations using observed future-change evidence.</p></section>;
  const a = report.candidates?.A;
  const b = report.candidates?.B;
  return <section className="workspace-page"><p className="eyebrow">Comparison</p><h1>Candidate Comparison</h1><p>Both candidates started from the same requirement and current-test baseline. Lower observed future risk is better.</p><div className="workspace-comparison"><article><span>Candidate A · PR #42</span><strong>{Math.round(a?.dimensions?.overallRisk ?? 0)} / 100</strong><small>Future Risk</small></article><article><span>Candidate B · PR #84</span><strong>{Math.round(b?.dimensions?.overallRisk ?? 0)} / 100</strong><small>Future Risk</small></article></div><div className="workspace-actions"><button className="primary-button" type="button" onClick={() => onNavigate("reports")}>Inspect full report</button></div></section>;
}

function EmptyReportsPage({ onStart }: { onStart: () => void }) {
  return <section className="workspace-page"><p className="eyebrow">Reports</p><h1>Reports</h1><p>A report appears after the controlled experiment completes. Start the analysis to generate evidence-backed results.</p><div className="workspace-actions"><button className="primary-button" type="button" onClick={onStart}>Start Analysis →</button></div></section>;
}

function SettingsPage() {
  return <section className="workspace-page"><p className="eyebrow">Local runtime</p><h1>Runtime Settings</h1><p>Live model configuration is read by the Fastify server from your local <code>.env</code>. The browser never receives your OpenRouter API key.</p><div className="workspace-settings"><div><span>Provider</span><strong>OpenRouter</strong></div><div><span>Model</span><strong><code>OPENROUTER_MODEL</code></strong></div><div><span>Base URL</span><strong><code>OPENROUTER_BASE_URL</code></strong></div><div><span>API key</span><strong>Server-side only</strong></div></div></section>;
}

export function App() {
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [state, setState] = useState<AnalysisState>("idle");
  const [view, setView] = useState<AppView>("overview");
  const [report, setReport] = useState<any>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [drawerDetail, setDrawerDetail] = useState<any>(null);
  const [drawerScenarioId, setDrawerScenarioId] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const refreshTerminalState = useCallback(async (id: string) => {
    const next = await getAnalysis(id);
    if (next.status === "completed") {
      setReport(next.report);
      setState("completed");
      setView("reports");
    } else if (next.status === "failed") {
      setError(next.error);
      setState("failed");
      setView("experiments");
    }
  }, []);

  useEffect(() => {
    if (!analysisId || state !== "running") return;
    const unsubscribe = subscribeToProgress(analysisId, (event) => {
      setEvents((current) => [...current, event]);
      if (event.type === "analysis_completed" || event.type === "analysis_failed") {
        void refreshTerminalState(analysisId);
      }
    }, () => {
      window.setTimeout(() => void refreshTerminalState(analysisId), 500);
    });
    return unsubscribe;
  }, [analysisId, refreshTerminalState, state]);

  const reset = () => {
    setAnalysisId(null);
    setState("idle");
    setView("overview");
    setReport(null);
    setEvents([]);
    setError(null);
    setDrawerDetail(null);
    setDrawerScenarioId(null);
  };

  const start = async () => {
    setStarting(true);
    setView("experiments");
    setError(null);
    setEvents([]);
    setReport(null);
    setDrawerDetail(null);
    setDrawerScenarioId(null);
    try {
      const created = await startDemoAnalysis();
      setAnalysisId(created.analysisId);
      setState("running");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
      setState("failed");
    } finally {
      setStarting(false);
    }
  };

  const navigate = (next: AppView) => {
    setView(next);
    if (next !== "reports") {
      setDrawerScenarioId(null);
      setDrawerDetail(null);
    }
  };

  const openScenario = async (scenarioId: string, trigger: HTMLButtonElement) => {
    if (!analysisId) return;
    triggerRef.current = trigger;
    setDrawerScenarioId(scenarioId);
    setDrawerLoading(true);
    setDrawerDetail(null);
    try {
      setDrawerDetail(await getScenarioDetail(analysisId, scenarioId));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : String(detailError));
      setDrawerScenarioId(null);
    } finally {
      setDrawerLoading(false);
    }
  };

  const closeDrawer = () => {
    setDrawerScenarioId(null);
    setDrawerDetail(null);
  };

  let content: React.ReactNode = null;
  if (view === "overview") {
    content = state === "idle" ? <SetupPage onStart={() => void start()} busy={starting} error={error} /> : <WorkspaceStatusPage state={state} onNavigate={navigate} onStart={() => void start()} />;
  } else if (view === "scenarios") {
    content = <FutureScenariosPage report={report} />;
  } else if (view === "experiments") {
    content = <ExperimentPage state={state} analysisId={analysisId} events={events} error={error} onStart={() => void start()} onNavigate={navigate} />;
  } else if (view === "comparisons") {
    content = <ComparisonPage report={report} onNavigate={navigate} />;
  } else if (view === "reports") {
    content = state === "completed" && report ? <ReportPage report={report} onRerun={() => void start()} onOpenScenario={(scenarioId, trigger) => void openScenario(scenarioId, trigger)} /> : <EmptyReportsPage onStart={() => void start()} />;
  } else {
    content = <SettingsPage />;
  }

  return <div className="app-shell">
    <Sidebar view={view} analysisState={state} onNavigate={navigate} onNewAnalysis={reset} />
    <main className="app-main">{content}</main>
    {drawerLoading && drawerScenarioId ? <div className="drawer-loading" role="status">Loading scenario evidence…</div> : null}
    {analysisId && view === "reports" && drawerScenarioId && drawerDetail ? <ScenarioDrawer
      analysisId={analysisId}
      detail={drawerDetail}
      triggerRef={triggerRef}
      onClose={closeDrawer}
      loadArtifact={async (candidateId, kind) => {
        const trial = drawerDetail.rawRuns?.[candidateId]?.[0]?.trial ?? 1;
        return await getArtifact({ analysisId, scenarioId: drawerScenarioId, candidateId, trial, kind });
      }}
    /> : null}
  </div>;
}
