import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentEvent } from "../../packages/engine/src/coding-agent.ts";
import type { Sandbox } from "../../packages/engine/src/sandbox-manager.ts";
import { collectRunMetrics } from "../../packages/engine/src/metrics.ts";

async function makeBaselineAndSandbox() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-metrics-"));
  const baselineRoot = path.join(parent, "baseline");
  const modifiedRoot = path.join(parent, "modified");
  await fs.mkdir(path.join(baselineRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(baselineRoot, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await fs.cp(baselineRoot, modifiedRoot, { recursive: true });
  await fs.writeFile(path.join(modifiedRoot, "src", "index.ts"), "export const value = 2;\nexport const extra = true;\n", "utf8");
  return {
    baselineRoot,
    sandbox: { root: modifiedRoot, candidateId: "A", scenarioId: "FR-01", trial: 1 } satisfies Sandbox,
  };
}

function event(seq: number, type: AgentEvent["type"], tool?: AgentEvent["tool"]): AgentEvent {
  return { seq, type, tool, timestampMs: seq, payload: {} };
}

test("collectRunMetrics measures exact change surface and tool effort", async () => {
  const { baselineRoot, sandbox } = await makeBaselineAndSandbox();
  const events: AgentEvent[] = [
    event(1, "tool_call", "read_file"),
    event(2, "tool_call", "search_code"),
    event(3, "tool_call", "apply_patch"),
    event(4, "tool_call", "run_command"),
  ];
  events[3]!.payload = { arguments: { command: "npm test" } };

  const metrics = await collectRunMetrics({
    sandbox,
    baselineRoot,
    events,
    regressionSnapshots: [{ cycle: 1, passed: 3, failed: 1, timestampMs: 10 }],
    wallTimeMs: 125,
    tokenUsage: 321,
  });

  assert.equal(metrics.toolCalls, 4);
  assert.equal(metrics.readOps, 1);
  assert.equal(metrics.searchOps, 1);
  assert.equal(metrics.editOps, 1);
  assert.equal(metrics.testRuns, 1);
  assert.equal(metrics.tokenUsage, 321);
  assert.equal(metrics.wallTimeMs, 125);
  assert.equal(metrics.filesTouched, 1);
  assert.equal(metrics.modulesTouched, 1);
  assert.equal(metrics.locAdded, 2);
  assert.equal(metrics.locDeleted, 1);
  assert.equal(metrics.publicApiFilesTouched, 1);
  assert.deepEqual(metrics.regressionSnapshots.map(({ cycle, passed, failed }) => ({ cycle, passed, failed })), [{ cycle: 1, passed: 3, failed: 1 }]);
  assert.notEqual(metrics.structuralDelta, null);
  assert.equal(metrics.structuralDelta?.fileSizeLines, 1);
});

test("modulesTouched counts top-level source modules rather than files", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-modules-"));
  const baselineRoot = path.join(parent, "baseline");
  const modifiedRoot = path.join(parent, "modified");
  for (const root of [baselineRoot, modifiedRoot]) {
    await fs.mkdir(path.join(root, "src", "notifications"), { recursive: true });
    await fs.mkdir(path.join(root, "src", "orders"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "notifications", "a.ts"), "export const a = 1;\n", "utf8");
    await fs.writeFile(path.join(root, "src", "notifications", "b.ts"), "export const b = 1;\n", "utf8");
    await fs.writeFile(path.join(root, "src", "orders", "c.ts"), "export const c = 1;\n", "utf8");
  }
  await fs.writeFile(path.join(modifiedRoot, "src", "notifications", "a.ts"), "export const a = 2;\n", "utf8");
  await fs.writeFile(path.join(modifiedRoot, "src", "notifications", "b.ts"), "export const b = 2;\n", "utf8");
  await fs.writeFile(path.join(modifiedRoot, "src", "orders", "c.ts"), "export const c = 2;\n", "utf8");

  const metrics = await collectRunMetrics({
    sandbox: { root: modifiedRoot, candidateId: "A", scenarioId: "FR-01", trial: 1 },
    baselineRoot,
    events: [],
    regressionSnapshots: [],
    wallTimeMs: 1,
    tokenUsage: 0,
  });
  assert.equal(metrics.filesTouched, 3);
  assert.equal(metrics.modulesTouched, 2);
});

test("structural parser failure is represented as null and a typed warning, never zero", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-structural-fail-"));
  const baselineRoot = path.join(parent, "baseline");
  const modifiedRoot = path.join(parent, "modified");
  await fs.mkdir(path.join(baselineRoot, "src"), { recursive: true });
  await fs.mkdir(path.join(modifiedRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(baselineRoot, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await fs.writeFile(path.join(modifiedRoot, "src", "index.ts"), "export const = ;\n", "utf8");
  const sandbox: Sandbox = { root: modifiedRoot, candidateId: "A", scenarioId: "FR-01", trial: 1 };

  const metrics = await collectRunMetrics({ sandbox, baselineRoot, events: [], regressionSnapshots: [], wallTimeMs: 1, tokenUsage: 0 });
  assert.equal(metrics.structuralDelta, null);
  const metadata = JSON.parse(await fs.readFile(path.join(modifiedRoot, ".futureproof", "metadata.json"), "utf8"));
  assert.ok(metadata.warnings.some((warning: { code: string }) => warning.code === "STRUCTURAL_METRICS_UNAVAILABLE"));
});
