export type CandidateId = "A" | "B";
export type AgentToolName = "list_files" | "read_file" | "search_code" | "apply_patch" | "run_command";
export type ScenarioDifficulty = "easy" | "medium" | "hard";
export type ScenarioStatus =
  | "SUCCESS"
  | "PARTIAL"
  | "FAIL"
  | "BUDGET_EXHAUSTED"
  | "BUILD_BROKEN"
  | "INVALID";

export interface AcceptanceCase {
  name: string;
  given: string;
  when: string;
  then: string;
}

export interface FutureScenario {
  id: string;
  title: string;
  dimension: "breadth" | "policy" | "reliability" | "composition" | "extension";
  requirement: string;
  rationale: string;
  affectedCapability: string;
  difficulty: ScenarioDifficulty;
  externalDependencies: boolean;
  provenance: string[];
  acceptance: AcceptanceCase[];
}

export interface AgentBudget {
  maxToolCalls: number;
  maxTokens: number;
  maxTestCycles: number;
  timeoutMs: number;
}

export interface RegressionSnapshot {
  cycle: number;
  passed: number;
  failed: number;
  timestampMs: number;
}

export interface StructuralDelta {
  cyclomaticComplexity: number;
  duplicateLineWindows: number;
  dependencyFanOut: number;
  fileSizeLines: number;
}

export interface RunMetrics {
  toolCalls: number;
  readOps: number;
  searchOps: number;
  editOps: number;
  testRuns: number;
  tokenUsage: number;
  wallTimeMs: number;
  filesTouched: number;
  modulesTouched: number;
  locAdded: number;
  locDeleted: number;
  publicApiFilesTouched: number;
  regressionSnapshots: RegressionSnapshot[];
  structuralDelta: StructuralDelta | null;
}

export interface ScenarioRunSummary {
  analysisId: string;
  candidateId: CandidateId;
  scenarioId: string;
  trial: number;
  status: ScenarioStatus;
  acceptancePassed: number;
  acceptanceFailed: number;
  existingPassed: number;
  existingFailed: number;
  buildPassed: boolean;
  metrics: RunMetrics;
  remainingFailures: string[];
  patchPath: string;
  artifactDir: string;
}

export interface CandidateBaseline {
  candidateId: CandidateId;
  testsPassed: number;
  testsFailed: number;
  buildPassed: boolean;
  valid: boolean;
}

export interface AnalysisExecution {
  baselines: Record<CandidateId, CandidateBaseline>;
  runs: ScenarioRunSummary[];
}

export interface RiskDimensions {
  resilienceRisk: number;
  efficiencyRisk: number;
  regressionRisk: number | null;
  structuralRisk: number | null;
  overallRisk: number;
}

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = { success: false; error: string };
export interface RuntimeSchema<T> {
  safeParse(input: unknown): ParseSuccess<T> | ParseFailure;
}

function ok<T>(data: T): ParseSuccess<T> {
  return { success: true, data };
}

function fail(error: string): ParseFailure {
  return { success: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isStringArray(value: unknown, requireNonEmpty = false): value is string[] {
  return Array.isArray(value) && (!requireNonEmpty || value.length > 0) && value.every(isString);
}

function inSet<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function parseAcceptanceCase(value: unknown): value is AcceptanceCase {
  return isRecord(value)
    && isString(value.name)
    && isString(value.given)
    && isString(value.when)
    && isString(value.then);
}

function parseRegressionSnapshot(value: unknown): value is RegressionSnapshot {
  return isRecord(value)
    && isNonNegativeInt(value.cycle)
    && isNonNegativeInt(value.passed)
    && isNonNegativeInt(value.failed)
    && isNonNegativeNumber(value.timestampMs);
}

function parseStructuralDelta(value: unknown): value is StructuralDelta {
  return isRecord(value)
    && isInteger(value.cyclomaticComplexity)
    && isInteger(value.duplicateLineWindows)
    && isInteger(value.dependencyFanOut)
    && isInteger(value.fileSizeLines);
}

function parseRunMetrics(value: unknown): value is RunMetrics {
  if (!isRecord(value)) return false;
  const integerFields = [
    "toolCalls",
    "readOps",
    "searchOps",
    "editOps",
    "testRuns",
    "tokenUsage",
    "filesTouched",
    "modulesTouched",
    "locAdded",
    "locDeleted",
    "publicApiFilesTouched",
  ] as const;
  if (!integerFields.every((field) => isNonNegativeInt(value[field]))) return false;
  if (!isNonNegativeNumber(value.wallTimeMs)) return false;
  if (!Array.isArray(value.regressionSnapshots) || !value.regressionSnapshots.every(parseRegressionSnapshot)) return false;
  if (value.structuralDelta !== null && !parseStructuralDelta(value.structuralDelta)) return false;
  return true;
}

export const FutureScenarioSchema: RuntimeSchema<FutureScenario> = {
  safeParse(input) {
    if (!isRecord(input)) return fail("scenario must be an object");
    if (!isString(input.id) || !isString(input.title) || !isString(input.requirement)) return fail("scenario identity is invalid");
    if (!inSet(input.dimension, ["breadth", "policy", "reliability", "composition", "extension"] as const)) return fail("invalid dimension");
    if (!isString(input.rationale) || !isString(input.affectedCapability)) return fail("scenario explanation is invalid");
    if (!inSet(input.difficulty, ["easy", "medium", "hard"] as const)) return fail("invalid difficulty");
    if (typeof input.externalDependencies !== "boolean") return fail("externalDependencies must be boolean");
    if (!isStringArray(input.provenance, true)) return fail("scenario provenance is required");
    if (!Array.isArray(input.acceptance) || !input.acceptance.every(parseAcceptanceCase)) return fail("invalid acceptance cases");
    return ok(input as unknown as FutureScenario);
  },
};

export const ScenarioRunSummarySchema: RuntimeSchema<ScenarioRunSummary> = {
  safeParse(input) {
    if (!isRecord(input)) return fail("run summary must be an object");
    if (!isString(input.analysisId) || !isString(input.scenarioId)) return fail("run identity is invalid");
    if (!inSet(input.candidateId, ["A", "B"] as const)) return fail("invalid candidate");
    if (!isNonNegativeInt(input.trial) || input.trial < 1) return fail("trial must be positive");
    if (!inSet(input.status, ["SUCCESS", "PARTIAL", "FAIL", "BUDGET_EXHAUSTED", "BUILD_BROKEN", "INVALID"] as const)) return fail("invalid status");
    for (const field of ["acceptancePassed", "acceptanceFailed", "existingPassed", "existingFailed"] as const) {
      if (!isNonNegativeInt(input[field])) return fail(`${field} must be a non-negative integer`);
    }
    if (typeof input.buildPassed !== "boolean") return fail("buildPassed must be boolean");
    if (!parseRunMetrics(input.metrics)) return fail("invalid run metrics");
    if (!isStringArray(input.remainingFailures) || !isString(input.patchPath) || !isString(input.artifactDir)) return fail("invalid artifact fields");
    return ok(input as unknown as ScenarioRunSummary);
  },
};

export const RiskDimensionsSchema: RuntimeSchema<RiskDimensions> = {
  safeParse(input) {
    if (!isRecord(input)) return fail("risk dimensions must be an object");
    if (!isScore(input.resilienceRisk) || !isScore(input.efficiencyRisk) || !isScore(input.overallRisk)) return fail("risk score out of range");
    if (input.regressionRisk !== null && !isScore(input.regressionRisk)) return fail("regression risk out of range");
    if (input.structuralRisk !== null && !isScore(input.structuralRisk)) return fail("structural risk out of range");
    return ok(input as unknown as RiskDimensions);
  },
};
