import type { RiskDimensions, ScenarioStatus } from "@futureproof/core";

const STATUS_WEIGHTS: Record<Exclude<ScenarioStatus, "INVALID">, number> = {
  SUCCESS: 1,
  PARTIAL: 0.5,
  FAIL: 0,
  BUDGET_EXHAUSTED: 0,
  BUILD_BROKEN: 0,
};

export function statusWeight(status: ScenarioStatus): number {
  if (status === "INVALID") throw new Error("INVALID runs do not have a scoring weight");
  return STATUS_WEIGHTS[status];
}

export function ratioPenalty(value: number, best: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(best) || value < 0 || best < 0) {
    throw new Error("ratioPenalty expects finite non-negative values");
  }
  const ratio = value / Math.max(best, 1e-9);
  return Math.min(100, Math.max(0, ((ratio - 1) / 2) * 100));
}

export function overallRisk(dimensions: Omit<RiskDimensions, "overallRisk">): number {
  const weighted: Array<[number | null, number]> = [
    [dimensions.resilienceRisk, 0.40],
    [dimensions.efficiencyRisk, 0.25],
    [dimensions.regressionRisk, 0.20],
    [dimensions.structuralRisk, 0.15],
  ];
  const available = weighted.filter((entry): entry is [number, number] => entry[0] !== null);
  const denominator = available.reduce((sum, [, weight]) => sum + weight, 0);
  if (denominator <= 0) throw new Error("no evidence dimensions available for risk scoring");
  return available.reduce((sum, [value, weight]) => sum + value * weight, 0) / denominator;
}
