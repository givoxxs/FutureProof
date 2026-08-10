import type { LlmClient } from "./llm-client.ts";

export interface ScenarioExplanationEvidence {
  scenarioTitle: string;
  candidateA: { filesTouched: number; toolCalls: number; regressionArea: number };
  candidateB: { filesTouched: number; toolCalls: number; regressionArea: number };
  toolCallRatio: number | null;
  structuralDeltaB: Record<string, number> | null;
  remainingFailuresB: string[];
}

function collectNumbers(value: unknown, numbers = new Set<number>()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) numbers.add(value);
  else if (Array.isArray(value)) for (const item of value) collectNumbers(item, numbers);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value as Record<string, unknown>)) collectNumbers(item, numbers);
  return numbers;
}

export function validateExplanationNumbers(text: string, evidence: unknown): boolean {
  const supported = [...collectNumbers(evidence)];
  const claims = [...text.matchAll(/(?<![A-Za-z])\d+(?:\.\d+)?(?![A-Za-z])/g)].map((match) => Number(match[0]));
  return claims.every((claim) => supported.some((value) => Math.abs(value - claim) < 1e-9));
}

function deterministicExplanation(evidence: ScenarioExplanationEvidence): string {
  const ratio = evidence.toolCallRatio === null ? "not comparable" : `${evidence.toolCallRatio}`;
  const failure = evidence.remainingFailuresB.length > 0 ? ` Remaining failure: ${evidence.remainingFailuresB[0]}.` : "";
  return `For ${evidence.scenarioTitle}, Candidate B touched ${evidence.candidateB.filesTouched} files versus ${evidence.candidateA.filesTouched} and used ${evidence.candidateB.toolCalls} tool calls versus ${evidence.candidateA.toolCalls}. The tool-call ratio is ${ratio}. Regression area was ${evidence.candidateB.regressionArea} versus ${evidence.candidateA.regressionArea}.${failure}`;
}

export async function explainScenario(evidence: ScenarioExplanationEvidence, client?: LlmClient): Promise<string> {
  const fallback = deterministicExplanation(evidence);
  if (!client) return fallback;
  try {
    const result = await client.completeJson<{ text: string }>({
      system: "Explain the scenario comparison using only the supplied structured evidence. Do not introduce any number or factual claim not present in the evidence. Return JSON with a text field. Do not provide hidden reasoning or chain-of-thought.",
      user: JSON.stringify(evidence),
      schemaName: "GroundedScenarioExplanation",
    });
    if (typeof result.value?.text === "string" && validateExplanationNumbers(result.value.text, evidence)) return result.value.text;
  } catch {
    // Deterministic fallback is the safe rendering path.
  }
  return fallback;
}
