import test from "node:test";
import assert from "node:assert/strict";
import type { FutureScenario } from "@futureproof/core";
import type { RepoSummary } from "../../packages/engine/src/repo-analyzer.ts";
import type { LlmClient } from "../../packages/engine/src/llm-client.ts";
import { generateBlindScenarioSet } from "../../packages/engine/src/scenario-generator.ts";

function makeScenario(
  id: string,
  difficulty: "easy" | "medium" | "hard",
  requirement: string,
  dimension: FutureScenario["dimension"],
  overrides: Partial<FutureScenario> = {},
): FutureScenario {
  return {
    id,
    title: requirement,
    dimension,
    requirement,
    rationale: "plausible product evolution",
    affectedCapability: "shipment notifications",
    difficulty,
    externalDependencies: false,
    provenance: ["current requirement: shipment notification"],
    acceptance: [{ name: "works", given: "a shipped order", when: "the feature is used", then: "the requested behavior occurs" }],
    ...overrides,
  };
}

class RecordingClient implements LlmClient {
  calls: Array<{ system: string; user: string; schemaName: string }> = [];
  private readonly responder: (callIndex: number) => unknown;
  constructor(responder: (callIndex: number) => unknown) {
    this.responder = responder;
  }
  async completeJson<T>(args: { system: string; user: string; schemaName: string }) {
    this.calls.push(args);
    return { value: this.responder(this.calls.length - 1) as T, inputTokens: 10, outputTokens: 5 };
  }
}

const baseSummary: RepoSummary = {
  root: "/tmp/base-repo",
  language: "typescript",
  packageManager: "npm",
  scripts: { test: "node --test", build: "tsc --noEmit" },
  sourceFiles: ["src/index.ts"],
  testFiles: ["test/current.test.ts"],
  publicExports: ["notifyShipment"],
  importEdges: [],
  readmeExcerpt: "Customers receive shipment notifications.",
};

const proposals = [
  makeScenario("FR-01", "medium", "Support SMS shipment notifications", "breadth"),
  makeScenario("FR-02", "medium", "Respect per-user notification preferences", "policy"),
  makeScenario("FR-03", "medium", "Retry failed shipment notification deliveries", "reliability"),
  makeScenario("FR-04", "hard", "Fall back to a secondary email provider", "composition"),
  makeScenario("FR-05", "easy", "Support push shipment notifications", "extension"),
  makeScenario("BAD-IMPL", "medium", "Create an interface for notification channels", "breadth"),
  makeScenario("BAD-EXT", "medium", "Send shipment notices through a real carrier webhook", "extension", { externalDependencies: true }),
  makeScenario("EXTRA", "easy", "Add shipment notification digests", "policy"),
];

test("blind generation never includes candidate implementation context", async () => {
  const generator = new RecordingClient(() => ({ scenarios: proposals }));
  const critic = new RecordingClient((index) => ({
    relevance: 0.95,
    plausibility: 0.95,
    neutrality: 0.95,
    testability: 0.95,
    scopeFit: 0.95,
    accept: index < 5,
  }));

  const result = await generateBlindScenarioSet({
    baseSummary,
    currentRequirement: "Send shipment email and record delivery outcome.",
    generator,
    critic,
  });

  assert.equal(result.length, 5);
  assert.deepEqual(result.map((scenario) => scenario.id), ["FR-01", "FR-02", "FR-03", "FR-04", "FR-05"]);
  const allPromptText = [...generator.calls, ...critic.calls].map((call) => `${call.system}\n${call.user}`).join("\n");
  for (const forbidden of ["candidate-a", "candidate-b", "DeliveryTracker", "candidate diff"]) {
    assert.equal(allPromptText.includes(forbidden), false, `prompt leaked ${forbidden}`);
  }
});

test("critic thresholds reject a semantically weak scenario", async () => {
  const generator = new RecordingClient(() => ({ scenarios: proposals.slice(0, 5) }));
  const critic = new RecordingClient((index) => ({
    relevance: index === 0 ? 0.7 : 0.95,
    plausibility: 0.95,
    neutrality: 0.95,
    testability: 0.95,
    scopeFit: 0.95,
    accept: true,
  }));
  await assert.rejects(
    () => generateBlindScenarioSet({
      baseSummary,
      currentRequirement: "Send shipment email and record delivery outcome.",
      generator,
      critic,
    }),
    /exactly five accepted scenarios/i,
  );
});
