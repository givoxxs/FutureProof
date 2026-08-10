import React from "react";

export interface ReportPageProps {
  report: any;
  onOpenScenario: (scenarioId: string, trigger: HTMLButtonElement) => void;
}

type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

function riskLevel(score: number): RiskLevel {
  if (score <= 33) return "LOW";
  if (score <= 66) return "MEDIUM";
  return "HIGH";
}

function formatTokens(value: number): string {
  if (value < 1000) return String(Math.round(value));
  return `${(value / 1000).toFixed(1)}k`;
}

function successCount(candidate: any): number {
  return candidate.aggregatedScenarios.filter((scenario: any) => scenario.status === "SUCCESS").length;
}

function averageStructural(candidate: any): number | null {
  const values = candidate.aggregatedScenarios
    .map((scenario: any) => scenario.metrics.structuralDelta?.cyclomaticComplexity)
    .filter((value: unknown): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum: number, value: number) => sum + value, 0) / values.length;
}

function statusLabel(status: string): string {
  if (status === "SUCCESS") return "Pass";
  if (status === "PARTIAL") return "Partial";
  if (status === "BUDGET_EXHAUSTED") return "Budget";
  if (status === "BUILD_BROKEN") return "Build";
  return "Fail";
}

function statusTone(status: string): string {
  if (status === "SUCCESS") return "status-pass";
  if (status === "PARTIAL") return "status-warn";
  return "status-fail";
}

function CandidatePill({ label, subtitle, tone }: { label: string; subtitle: string; tone: "a" | "b" }) {
  return <div className={`candidate-pill candidate-${tone}`}>
    <span className="candidate-dot" aria-hidden="true" />
    <div><strong>{label}</strong><span>{subtitle}</span></div>
  </div>;
}

function RiskCard({ score, candidate }: { score: number; candidate: "A" | "B" }) {
  const level = riskLevel(score);
  return <section className={`risk-card risk-${level.toLowerCase()}`} aria-label={`Candidate ${candidate} Future Change Risk`}>
    <div className="risk-card-label">Candidate {candidate}</div>
    <div className="risk-score-row"><strong className="risk-score">{Math.round(score)}</strong><span>/100</span></div>
    <span className={`risk-badge ${level.toLowerCase()}`}>{level} RISK</span>
  </section>;
}

function Radar({ a, b }: { a: any; b: any }) {
  const axes = ["Resilience", "Efficiency", "Regression", "Structure"];
  const dimensions = ["resilienceRisk", "efficiencyRisk", "regressionRisk", "structuralRisk"];
  const center = 82;
  const radius = 56;
  const points = (candidate: any) => dimensions.map((key, index) => {
    const risk = candidate.dimensions[key] ?? 50;
    const health = Math.max(0, 100 - risk) / 100;
    const angle = -Math.PI / 2 + index * Math.PI / 2;
    return `${center + Math.cos(angle) * radius * health},${center + Math.sin(angle) * radius * health}`;
  }).join(" ");
  return <section className="radar-panel" aria-label="Four-axis comparison">
    <div className="section-kicker">Future resilience profile</div>
    <svg className="risk-radar" viewBox="0 0 164 164" role="img" aria-label="Candidate comparison radar">
      {[1, .66, .33].map((scale) => <polygon key={scale} className="radar-grid" points={axes.map((_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI / 2;
        return `${center + Math.cos(angle) * radius * scale},${center + Math.sin(angle) * radius * scale}`;
      }).join(" ")} />)}
      <line x1="82" y1="26" x2="82" y2="138" className="radar-axis" />
      <line x1="26" y1="82" x2="138" y2="82" className="radar-axis" />
      <polygon points={points(a)} className="radar-a" />
      <polygon points={points(b)} className="radar-b" />
    </svg>
    <div className="radar-labels" aria-hidden="true"><span>Resilience</span><span>Efficiency</span><span>Regression</span><span>Structure</span></div>
    <div className="legend"><span className="legend-a">Candidate A</span><span className="legend-b">Candidate B</span></div>
  </section>;
}

function MetricCell({ label, a, b }: { label: string; a: string | number; b: string | number }) {
  return <div className="metric-cell">
    <span className="metric-label">{label}</span>
    <div className="metric-values"><strong>{a}</strong><span className="metric-divider" /><strong>{b}</strong></div>
    <div className="metric-ab"><span>A</span><span>B</span></div>
  </div>;
}

export function ReportPage({ report, onOpenScenario }: ReportPageProps) {
  const a = report.candidates.A;
  const b = report.candidates.B;
  const structuralA = averageStructural(a);
  const structuralB = averageStructural(b);
  const total = report.scenarios.length;

  return <div className="report-page">
    <header className="report-header">
      <div><p className="eyebrow">Controlled extensibility experiment</p><h1>Analysis Report</h1><p className="header-subtitle">Same future requirements. Same agent. Same budget. Measured outcomes.</p></div>
      <div className="header-actions"><span className="completed-chip"><span aria-hidden="true">✓</span> Completed</span><button className="secondary-button" type="button">Export</button><button className="primary-button" type="button">Re-run analysis</button></div>
    </header>

    <section className="comparison-strip" aria-label="Candidate pull requests">
      <div><span className="strip-label">Candidate implementation</span><CandidatePill label="PR #42" subtitle="A (Decoupled) · a1b2c3d" tone="a" /></div>
      <div className="versus">VS</div>
      <div><span className="strip-label">Candidate implementation</span><CandidatePill label="PR #84" subtitle="B (Coupled) · d4e5f6g" tone="b" /></div>
      <div className="baseline-proof"><span>Current behavior</span><strong>{a.baseline.testsPassed}/{a.baseline.testsPassed + a.baseline.testsFailed} tests</strong></div>
      <div className="baseline-proof"><span>Current behavior</span><strong>{b.baseline.testsPassed}/{b.baseline.testsPassed + b.baseline.testsFailed} tests</strong></div>
    </section>

    <section className="risk-overview" aria-label="Future Change Risk overview">
      <RiskCard score={a.dimensions.overallRisk} candidate="A" />
      <Radar a={a} b={b} />
      <RiskCard score={b.dimensions.overallRisk} candidate="B" />
    </section>

    <section className="evidence-section">
      <div className="section-heading"><div><p className="eyebrow">Measured evidence</p><h2>Observed future-change cost</h2></div><p>Raw outcomes are aggregated after the agent finishes; the agent never sees these metrics.</p></div>
      <div className="metrics-grid">
        <MetricCell label="Future tasks passed" a={`${successCount(a)} / ${total}`} b={`${successCount(b)} / ${total}`} />
        <MetricCell label="Avg. tool calls" a={a.averages.toolCalls} b={b.averages.toolCalls} />
        <MetricCell label="Avg. files touched" a={a.averages.filesTouched} b={b.averages.filesTouched} />
        <MetricCell label="Regression cycles" a={a.averages.regressionCycles} b={b.averages.regressionCycles} />
        <MetricCell label="Token usage" a={formatTokens(a.averages.tokenUsage)} b={formatTokens(b.averages.tokenUsage)} />
        <MetricCell label="Structural Delta" a={structuralA === null ? "n/a" : `${structuralA >= 0 ? "+" : ""}${structuralA.toFixed(1)}`} b={structuralB === null ? "n/a" : `${structuralB >= 0 ? "+" : ""}${structuralB.toFixed(1)}`} />
      </div>
    </section>

    <section className="scenario-section">
      <div className="section-heading"><div><p className="eyebrow">Frozen scenario set</p><h2>Simulated Future Changes</h2></div><p>Generated from the base requirement before either candidate implementation is inspected.</p></div>
      <div className="scenario-table-wrap">
        <table className="scenario-table">
          <thead><tr><th>Future change</th><th>Difficulty</th><th>Candidate A</th><th>Candidate B</th><th>Evidence</th></tr></thead>
          <tbody>{report.scenarios.map((scenario: any) => {
            const resultA = a.aggregatedScenarios.find((item: any) => item.scenarioId === scenario.id);
            const resultB = b.aggregatedScenarios.find((item: any) => item.scenarioId === scenario.id);
            return <tr key={scenario.id}>
              <td><strong>{scenario.title}</strong><span className="scenario-id">{scenario.id} · {scenario.dimension}</span></td>
              <td><span className={`difficulty difficulty-${scenario.difficulty}`}>{scenario.difficulty}</span></td>
              <td><span className={`scenario-status ${statusTone(resultA?.status ?? "FAIL")}`}>{statusLabel(resultA?.status ?? "FAIL")}</span></td>
              <td><span className={`scenario-status ${statusTone(resultB?.status ?? "FAIL")}`}>{statusLabel(resultB?.status ?? "FAIL")}</span></td>
              <td><button className="detail-button" type="button" aria-label={`View details for ${scenario.title}`} onClick={(event) => onOpenScenario(scenario.id, event.currentTarget)}>View details <span aria-hidden="true">→</span></button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  </div>;
}
