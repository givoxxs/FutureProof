import type { FutureScenario } from "@futureproof/core";
import type { RepoSummary } from "./repo-analyzer.ts";
import type { LlmClient } from "./llm-client.ts";
import { normalizeRequirement, validateScenarioCandidate, validateScenarioSet } from "./scenario-validator.ts";

interface CriticResult {
  relevance: number;
  plausibility: number;
  neutrality: number;
  testability: number;
  scopeFit: number;
  accept: boolean;
}

function isCriticPass(value: CriticResult): boolean {
  const scores = [value.relevance, value.plausibility, value.neutrality, value.testability, value.scopeFit];
  return value.accept === true && scores.every((score) => typeof score === "number" && score >= 0.75 && score <= 1);
}

function sanitizedBaseContext(baseSummary: RepoSummary, currentRequirement: string): Record<string, unknown> {
  return {
    currentRequirement,
    language: baseSummary.language,
    packageManager: baseSummary.packageManager,
    scripts: baseSummary.scripts,
    sourceFiles: baseSummary.sourceFiles,
    testFiles: baseSummary.testFiles,
    publicExports: baseSummary.publicExports,
    importEdges: baseSummary.importEdges,
    readmeExcerpt: baseSummary.readmeExcerpt,
  };
}

function pickBalancedScenarios(accepted: FutureScenario[]): FutureScenario[] {
  const selected = [
    ...accepted.filter((scenario) => scenario.difficulty === "medium").slice(0, 3),
    ...accepted.filter((scenario) => scenario.difficulty === "hard").slice(0, 1),
    ...accepted.filter((scenario) => scenario.difficulty === "easy").slice(0, 1),
  ];
  if (selected.length !== 5) {
    throw new Error(`expected exactly five accepted scenarios with 1 easy / 3 medium / 1 hard; got ${selected.length}`);
  }
  const order = new Map(accepted.map((scenario, index) => [scenario.id, index]));
  selected.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return validateScenarioSet(selected);
}

export async function generateBlindScenarioSet(args: {
  baseSummary: RepoSummary;
  currentRequirement: string;
  generator: LlmClient;
  critic: LlmClient;
}): Promise<FutureScenario[]> {
  const context = sanitizedBaseContext(args.baseSummary, args.currentRequirement);
  const generated = await args.generator.completeJson<{ scenarios: unknown[] }>({
    system: [
      "Generate plausible future product requirements from the base repository only.",
      "Propose exactly eight incremental scenarios spanning breadth, policy, reliability, composition, and extension.",
      "Requirements must describe observable behavior, remain locally testable, include provenance and acceptance cases, and must not prescribe classes, interfaces, factories, refactors, or other implementation structure.",
      "Do not assume any candidate implementation or diff exists.",
    ].join(" "),
    user: JSON.stringify(context),
    schemaName: "FutureScenarioCandidates",
  });
  if (!generated.value || !Array.isArray(generated.value.scenarios)) {
    throw new Error("scenario generator did not return a scenarios array");
  }

  const deterministic: FutureScenario[] = [];
  const seen = new Set<string>();
  for (const raw of generated.value.scenarios) {
    try {
      const scenario = validateScenarioCandidate(raw);
      const normalized = normalizeRequirement(scenario.requirement);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      deterministic.push(scenario);
    } catch {
      // Deliberately discard structurally unsafe or implementation-prescriptive proposals before critic review.
    }
  }

  const accepted: FutureScenario[] = [];
  for (const scenario of deterministic) {
    const judged = await args.critic.completeJson<CriticResult>({
      system: "Judge whether this proposed future requirement is relevant, plausible, implementation-neutral, locally testable, and appropriately scoped using scores from 0 to 1. You do not know or evaluate any candidate implementation.",
      user: JSON.stringify({ base: context, scenario }),
      schemaName: "ScenarioCriticDecision",
    });
    if (isCriticPass(judged.value)) accepted.push(scenario);
  }

  return pickBalancedScenarios(accepted);
}
