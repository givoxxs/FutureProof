import type {
  AnalysisExecution,
  CandidateBaseline,
  CandidateId,
  FutureScenario,
  RiskDimensions,
  ScenarioRunSummary,
  ScenarioStatus,
  StructuralDelta,
} from "@futureproof/core";
import { overallRisk, ratioPenalty, statusWeight } from "./score.ts";

export interface AggregatedScenario {
  scenarioId: string;
  status: Exclude<ScenarioStatus, "INVALID">;
  trialCount: number;
  metrics: {
    toolCalls: number;
    filesTouched: number;
    editOps: number;
    testRuns: number;
    tokenUsage: number;
    regressionArea: number | null;
    failedRegressionSnapshots: number | null;
    structuralDelta: StructuralDelta | null;
    structuralMagnitude: number | null;
  };
}

export interface CandidateReport {
  candidateId: CandidateId;
  baseline: CandidateBaseline;
  dimensions: RiskDimensions;
  scenarioRuns: ScenarioRunSummary[];
  aggregatedScenarios: AggregatedScenario[];
  averages: {
    toolCalls: number;
    filesTouched: number;
    regressionCycles: number;
    tokenUsage: number;
  };
}

export interface AnalysisReport {
  analysisId: string;
  candidates: Record<CandidateId, CandidateReport>;
  ratios: Record<"toolCalls" | "filesTouched" | "regressionArea" | "tokenUsage", number | null>;
  ratioLabels: Record<"toolCalls" | "filesTouched" | "regressionArea" | "tokenUsage", string>;
  scenarios: FutureScenario[];
}

interface CandidateEvidence {
  resilienceRisk: number;
  efficiencyValues: [number, number, number, number, number];
  regressionArea: number | null;
  failedRegressionSnapshots: number | null;
  structuralMagnitude: number | null;
}

const SEVERITY: Record<Exclude<ScenarioStatus, "INVALID">, number> = {
  SUCCESS: 0,
  PARTIAL: 1,
  FAIL: 2,
  BUDGET_EXHAUSTED: 3,
  BUILD_BROKEN: 4,
};

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function majorityStatus(runs: ScenarioRunSummary[]): Exclude<ScenarioStatus, "INVALID"> {
  const valid = runs.map((run) => run.status).filter((status): status is Exclude<ScenarioStatus, "INVALID"> => status !== "INVALID");
  if (valid.length === 0) throw new Error("scenario has no valid trials to aggregate");
  const counts = new Map<Exclude<ScenarioStatus, "INVALID">, number>();
  for (const status of valid) counts.set(status, (counts.get(status) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return SEVERITY[b[0]] - SEVERITY[a[0]];
  })[0]![0];
}

function medianStructural(runs: ScenarioRunSummary[]): StructuralDelta | null {
  if (runs.some((run) => run.metrics.structuralDelta === null)) return null;
  const values = runs.map((run) => run.metrics.structuralDelta!);
  return {
    cyclomaticComplexity: median(values.map((value) => value.cyclomaticComplexity)),
    duplicateLineWindows: median(values.map((value) => value.duplicateLineWindows)),
    dependencyFanOut: median(values.map((value) => value.dependencyFanOut)),
    fileSizeLines: median(values.map((value) => value.fileSizeLines)),
  };
}

function structuralMagnitude(delta: StructuralDelta): number {
  return Math.max(0, delta.cyclomaticComplexity)
    + Math.max(0, delta.duplicateLineWindows)
    + Math.max(0, delta.dependencyFanOut)
    + Math.max(0, delta.fileSizeLines) / 20;
}

function aggregateScenario(scenarioId: string, runs: ScenarioRunSummary[]): AggregatedScenario {
  const valid = runs.filter((run) => run.status !== "INVALID");
  if (valid.length === 0) throw new Error(`scenario ${scenarioId} has no valid trials`);
  const regressionAvailable = valid.every((run) => run.metrics.editOps === 0 || run.metrics.regressionSnapshots.length > 0);
  const regressionAreas = valid.map((run) => run.metrics.regressionSnapshots.reduce((sum, snapshot) => sum + snapshot.failed, 0));
  const failedSnapshotCounts = valid.map((run) => run.metrics.regressionSnapshots.filter((snapshot) => snapshot.failed > 0).length);
  const structuralDelta = medianStructural(valid);
  return {
    scenarioId,
    status: majorityStatus(valid),
    trialCount: valid.length,
    metrics: {
      toolCalls: median(valid.map((run) => run.metrics.toolCalls)),
      filesTouched: median(valid.map((run) => run.metrics.filesTouched)),
      editOps: median(valid.map((run) => run.metrics.editOps)),
      testRuns: median(valid.map((run) => run.metrics.testRuns)),
      tokenUsage: median(valid.map((run) => run.metrics.tokenUsage)),
      regressionArea: regressionAvailable ? median(regressionAreas) : null,
      failedRegressionSnapshots: regressionAvailable ? median(failedSnapshotCounts) : null,
      structuralDelta,
      structuralMagnitude: structuralDelta === null ? null : structuralMagnitude(structuralDelta),
    },
  };
}

function candidateAggregates(candidateId: CandidateId, scenarios: FutureScenario[], execution: AnalysisExecution): AggregatedScenario[] {
  return scenarios.map((scenario) => {
    const runs = execution.runs.filter((run) => run.candidateId === candidateId && run.scenarioId === scenario.id);
    return aggregateScenario(scenario.id, runs);
  });
}

function evidence(aggregates: AggregatedScenario[]): CandidateEvidence {
  const resilienceRisk = 100 - average(aggregates.map((aggregate) => statusWeight(aggregate.status))) * 100;
  const regressionAvailable = aggregates.every((aggregate) => aggregate.metrics.regressionArea !== null && aggregate.metrics.failedRegressionSnapshots !== null);
  const structuralAvailable = aggregates.every((aggregate) => aggregate.metrics.structuralMagnitude !== null);
  return {
    resilienceRisk,
    efficiencyValues: [
      average(aggregates.map((aggregate) => aggregate.metrics.toolCalls)),
      average(aggregates.map((aggregate) => aggregate.metrics.filesTouched)),
      average(aggregates.map((aggregate) => aggregate.metrics.editOps)),
      average(aggregates.map((aggregate) => aggregate.metrics.testRuns)),
      average(aggregates.map((aggregate) => aggregate.metrics.tokenUsage)),
    ],
    regressionArea: regressionAvailable ? aggregates.reduce((sum, aggregate) => sum + aggregate.metrics.regressionArea!, 0) : null,
    failedRegressionSnapshots: regressionAvailable ? aggregates.reduce((sum, aggregate) => sum + aggregate.metrics.failedRegressionSnapshots!, 0) : null,
    structuralMagnitude: structuralAvailable ? aggregates.reduce((sum, aggregate) => sum + aggregate.metrics.structuralMagnitude!, 0) : null,
  };
}

function scoreDimensions(current: CandidateEvidence, peer: CandidateEvidence): RiskDimensions {
  const efficiencyRisk = average(current.efficiencyValues.map((value, index) => ratioPenalty(value, Math.min(value, peer.efficiencyValues[index]!))));
  let regressionRisk: number | null = null;
  if (current.regressionArea !== null && current.failedRegressionSnapshots !== null && peer.regressionArea !== null && peer.failedRegressionSnapshots !== null) {
    regressionRisk = average([
      ratioPenalty(current.regressionArea, Math.min(current.regressionArea, peer.regressionArea)),
      ratioPenalty(current.failedRegressionSnapshots, Math.min(current.failedRegressionSnapshots, peer.failedRegressionSnapshots)),
    ]);
  }
  let structuralRisk: number | null = null;
  if (current.structuralMagnitude !== null && peer.structuralMagnitude !== null) {
    structuralRisk = ratioPenalty(current.structuralMagnitude, Math.min(current.structuralMagnitude, peer.structuralMagnitude));
  }
  const partial = { resilienceRisk: current.resilienceRisk, efficiencyRisk, regressionRisk, structuralRisk };
  return { ...partial, overallRisk: overallRisk(partial) };
}

function ratio(valueB: number, valueA: number): number | null {
  if (valueA === 0) return null;
  return valueB / valueA;
}

function ratioLabel(value: number | null): string {
  return value === null ? "not comparable" : `${value.toFixed(2)}x`;
}

export function buildAnalysisReport(analysisId: string, scenarios: FutureScenario[], execution: AnalysisExecution): AnalysisReport {
  for (const candidateId of ["A", "B"] as const) {
    if (!execution.baselines[candidateId].valid) throw new Error(`invalid candidate ${candidateId} cannot be scored`);
    if (execution.runs.filter((run) => run.candidateId === candidateId && run.status !== "INVALID").length === 0) {
      throw new Error(`invalid candidate ${candidateId} has no scoreable runs`);
    }
  }

  const aggregatedA = candidateAggregates("A", scenarios, execution);
  const aggregatedB = candidateAggregates("B", scenarios, execution);
  const evidenceA = evidence(aggregatedA);
  const evidenceB = evidence(aggregatedB);
  const dimensionsA = scoreDimensions(evidenceA, evidenceB);
  const dimensionsB = scoreDimensions(evidenceB, evidenceA);

  const buildCandidate = (candidateId: CandidateId, aggregates: AggregatedScenario[], dimensions: RiskDimensions): CandidateReport => ({
    candidateId,
    baseline: execution.baselines[candidateId],
    dimensions,
    scenarioRuns: execution.runs.filter((run) => run.candidateId === candidateId),
    aggregatedScenarios: aggregates,
    averages: {
      toolCalls: average(aggregates.map((aggregate) => aggregate.metrics.toolCalls)),
      filesTouched: average(aggregates.map((aggregate) => aggregate.metrics.filesTouched)),
      regressionCycles: average(aggregates.map((aggregate) => aggregate.metrics.failedRegressionSnapshots ?? 0)),
      tokenUsage: average(aggregates.map((aggregate) => aggregate.metrics.tokenUsage)),
    },
  });

  const ratios = {
    toolCalls: ratio(evidenceB.efficiencyValues[0], evidenceA.efficiencyValues[0]),
    filesTouched: ratio(evidenceB.efficiencyValues[1], evidenceA.efficiencyValues[1]),
    regressionArea: evidenceA.regressionArea === null || evidenceB.regressionArea === null ? null : ratio(evidenceB.regressionArea, evidenceA.regressionArea),
    tokenUsage: ratio(evidenceB.efficiencyValues[4], evidenceA.efficiencyValues[4]),
  };

  return {
    analysisId,
    candidates: {
      A: buildCandidate("A", aggregatedA, dimensionsA),
      B: buildCandidate("B", aggregatedB, dimensionsB),
    },
    ratios,
    ratioLabels: {
      toolCalls: ratioLabel(ratios.toolCalls),
      filesTouched: ratioLabel(ratios.filesTouched),
      regressionArea: ratioLabel(ratios.regressionArea),
      tokenUsage: ratioLabel(ratios.tokenUsage),
    },
    scenarios,
  };
}
