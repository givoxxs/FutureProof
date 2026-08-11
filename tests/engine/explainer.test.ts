import test from "node:test";
import assert from "node:assert/strict";
import type { LlmClient } from "../../packages/engine/src/llm-client.ts";
import { explainScenario, validateExplanationNumbers } from "../../packages/engine/src/explainer.ts";

const evidence = {
  scenarioTitle: "Provider fallback",
  candidateA: { filesTouched: 3, toolCalls: 12, regressionArea: 1 },
  candidateB: { filesTouched: 8, toolCalls: 24, regressionArea: 4 },
  toolCallRatio: 2,
  structuralDeltaB: { cyclomaticComplexity: 5 },
  remainingFailuresB: ["fallback test"],
};

class FakeClient implements LlmClient {
  private readonly text: string;
  constructor(text: string) { this.text = text; }
  async completeJson<T>() { return { value: { text: this.text } as T, inputTokens: 10, outputTokens: 5 }; }
}

test("numeric grounding accepts supplied evidence values and rejects unsupported claims", () => {
  assert.equal(validateExplanationNumbers("Candidate B touched 8 files and used 24 tool calls, or 2 times A.", evidence), true);
  assert.equal(validateExplanationNumbers("Candidate B touched 17 files.", evidence), false);
});

test("unsupported LLM number falls back to deterministic evidence-only prose", async () => {
  const text = await explainScenario(evidence, new FakeClient("Candidate B touched 17 files and is 9 times worse."));
  assert.equal(text.includes("17"), false);
  assert.equal(text.includes("9"), false);
  assert.ok(validateExplanationNumbers(text, evidence));
});

test("supported LLM explanation is retained", async () => {
  const supported = "Candidate B touched 8 files, used 24 tool calls, and required 2 times Candidate A's tool calls.";
  const text = await explainScenario(evidence, new FakeClient(supported));
  assert.equal(text, supported);
});
