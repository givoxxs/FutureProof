import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentBudget, FutureScenario } from "@futureproof/core";
import type { ToolCallingLlmClient, ToolDefinition } from "../../packages/engine/src/llm-client.ts";
import type { Sandbox } from "../../packages/engine/src/sandbox-manager.ts";
import { runCodingAgent, type AgentEvent } from "../../packages/engine/src/coding-agent.ts";

const scenario: FutureScenario = {
  id: "FR-01",
  title: "Change old to new",
  dimension: "extension",
  requirement: "Update the value so the requested new behavior is available.",
  rationale: "test fixture",
  affectedCapability: "value",
  difficulty: "easy",
  externalDependencies: false,
  provenance: ["test fixture"],
  acceptance: [{ name: "new value", given: "old value", when: "feature is implemented", then: "new value is observable" }],
};

const budget: AgentBudget = { maxToolCalls: 3, maxTokens: 10_000, maxTestCycles: 5, timeoutMs: 5_000 };

async function makeSandbox(): Promise<Sandbox> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-agent-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "value.txt"), "old\n", "utf8");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    scripts: {
      test: "node -e \"const fs=require('fs'); const ok=fs.readFileSync('src/value.txt','utf8').trim()==='new'; console.log('# pass '+(ok?1:0)); console.log('# fail '+(ok?0:1)); process.exit(ok?0:1)\"",
      build: "node -e \"process.exit(0)\"",
    },
  }), "utf8");
  return { root, candidateId: "A", scenarioId: scenario.id, trial: 1 };
}

type Turn = {
  toolCalls: Array<{ id: string; name: "list_files" | "read_file" | "search_code" | "apply_patch" | "run_command"; arguments: Record<string, unknown> }>;
  inputTokens?: number;
  outputTokens?: number;
};

class ScriptedClient implements ToolCallingLlmClient {
  turns: Turn[];
  calls: Array<{ system: string; messages: Array<Record<string, unknown>>; tools: ToolDefinition[] }> = [];
  constructor(turns: Turn[]) { this.turns = [...turns]; }
  async completeJson<T>(): Promise<{ value: T; inputTokens: number; outputTokens: number }> {
    throw new Error("not used by coding agent");
  }
  async nextToolTurn(args: { system: string; messages: Array<Record<string, unknown>>; tools: ToolDefinition[] }) {
    this.calls.push(args);
    const turn = this.turns.shift() ?? { toolCalls: [] };
    return {
      assistantMessage: { role: "assistant", content: turn.toolCalls.length ? null : "done", tool_calls: turn.toolCalls },
      toolCalls: turn.toolCalls,
      inputTokens: turn.inputTokens ?? 10,
      outputTokens: turn.outputTokens ?? 5,
    };
  }
}

async function collectEvents(run: (onEvent: (event: AgentEvent) => Promise<void>) => Promise<unknown>) {
  const events: AgentEvent[] = [];
  const result = await run(async (event) => { events.push(event); });
  return { result, events };
}

test("scripted agent edits, runs tests, finishes, and persists deterministic events", async () => {
  const sandbox = await makeSandbox();
  const client = new ScriptedClient([
    { toolCalls: [{ id: "1", name: "apply_patch", arguments: { path: "src/value.txt", expected: "old", replacement: "new" } }] },
    { toolCalls: [{ id: "2", name: "run_command", arguments: { command: "pnpm test" } }] },
    { toolCalls: [] },
  ]);

  const { result, events } = await collectEvents((onEvent) => runCodingAgent({ sandbox, scenario, budget, client, onEvent }));
  assert.deepEqual(result, { stopReason: "completed" });
  assert.equal((await fs.readFile(path.join(sandbox.root, "src", "value.txt"), "utf8")).trim(), "new");
  assert.deepEqual(events.map((event) => event.type), [
    "model_turn", "tool_call", "tool_result",
    "model_turn", "tool_call", "tool_result",
    "model_turn",
  ]);
  assert.deepEqual(events.map((event) => event.seq), [1, 2, 3, 4, 5, 6, 7]);
  const eventFile = path.join(sandbox.root, ".futureproof", "tool-events.jsonl");
  const persisted = (await fs.readFile(eventFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(persisted.length, events.length);
  assert.equal(persisted[0].type, "model_turn");
  const regressionFile = path.join(sandbox.root, ".futureproof", "regression-snapshots.jsonl");
  const regression = (await fs.readFile(regressionFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(regression.map(({ cycle, passed, failed }) => ({ cycle, passed, failed })), [{ cycle: 1, passed: 1, failed: 0 }]);

  const promptText = client.calls.map((call) => call.system).join("\n");
  assert.equal(promptText.includes("candidateId"), false);
  assert.equal(promptText.includes("Candidate A"), false);
  assert.equal(promptText.includes("Future Change Risk"), false);
  assert.equal(promptText.includes("comparison data"), false);
});

test("executes exactly maxToolCalls and then stops with tool_budget", async () => {
  const sandbox = await makeSandbox();
  const turns: Turn[] = Array.from({ length: 40 }, (_, index) => ({
    toolCalls: [{ id: String(index), name: "read_file", arguments: { path: "src/value.txt" } }],
  }));
  const client = new ScriptedClient(turns);
  const { result, events } = await collectEvents((onEvent) => runCodingAgent({ sandbox, scenario, budget, client, onEvent }));
  assert.deepEqual(result, { stopReason: "tool_budget" });
  assert.equal(events.filter((event) => event.type === "tool_call").length, 3);
  assert.equal(events.filter((event) => event.type === "tool_result").length, 3);
  assert.equal(events.at(-1)?.type, "budget");
  assert.equal(events.at(-1)?.payload.reason, "tool_budget");
});

test("stops before executing a tool when the model turn crosses the token budget", async () => {
  const sandbox = await makeSandbox();
  const client = new ScriptedClient([{ toolCalls: [{ id: "1", name: "read_file", arguments: { path: "src/value.txt" } }], inputTokens: 9_000, outputTokens: 2_000 }]);
  const { result, events } = await collectEvents((onEvent) => runCodingAgent({ sandbox, scenario, budget, client, onEvent }));
  assert.deepEqual(result, { stopReason: "token_budget" });
  assert.equal(events.filter((event) => event.type === "tool_call").length, 0);
  assert.equal(events.at(-1)?.payload.reason, "token_budget");
});

test("returns timeout when a model turn exceeds the wall-clock budget", async () => {
  const sandbox = await makeSandbox();
  const slowClient: ToolCallingLlmClient = {
    async completeJson<T>() { throw new Error("unused"); },
    async nextToolTurn() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { assistantMessage: { role: "assistant", content: "late" }, toolCalls: [], inputTokens: 1, outputTokens: 1 };
    },
  };
  const { result, events } = await collectEvents((onEvent) => runCodingAgent({
    sandbox,
    scenario,
    budget: { ...budget, timeoutMs: 10 },
    client: slowClient,
    onEvent,
  }));
  assert.deepEqual(result, { stopReason: "timeout" });
  assert.equal(events.at(-1)?.type, "budget");
  assert.equal(events.at(-1)?.payload.reason, "timeout");
});
