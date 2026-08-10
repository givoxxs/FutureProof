import path from "node:path";
import type { AgentBudget, AgentToolName, FutureScenario } from "@futureproof/core";
import { appendJsonl } from "@futureproof/core/artifacts";
import type { ToolCallingLlmClient } from "./llm-client.ts";
import type { Sandbox } from "./sandbox-manager.ts";
import { createAgentTools } from "./agent-tools.ts";
import { probeRegression } from "./regression-probe.ts";

export interface AgentEvent {
  seq: number;
  type: "tool_call" | "tool_result" | "model_turn" | "budget";
  tool?: AgentToolName;
  timestampMs: number;
  payload: Record<string, unknown>;
}

export type AgentStopReason = "completed" | "tool_budget" | "token_budget" | "timeout";

const SYSTEM_PROMPT = `Implement the requested future behavior and preserve all existing behavior.
Make the smallest coherent change necessary.
Use only the provided repository tools.
Run the test suite before declaring completion.
Do not optimize for file count, line count, token count, or any hidden score.
Stop when the requested behavior and existing tests pass, or when the execution budget is exhausted.`;

class DeadlineExceededError extends Error {}

async function withinDeadline<T>(promise: Promise<T>, remainingMs: number): Promise<T> {
  if (remainingMs <= 0) throw new DeadlineExceededError("deadline exceeded");
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineExceededError("deadline exceeded")), remainingMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function compactToolResult(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized.length <= 20_000) return value;
  return { truncated: true, preview: serialized.slice(0, 20_000) };
}

export async function runCodingAgent(args: {
  sandbox: Sandbox;
  scenario: FutureScenario;
  budget: AgentBudget;
  client: ToolCallingLlmClient;
  onEvent: (event: AgentEvent) => Promise<void>;
}): Promise<{ stopReason: AgentStopReason }> {
  const started = performance.now();
  const deadline = started + args.budget.timeoutMs;
  const eventFile = path.join(args.sandbox.root, ".futureproof", "tool-events.jsonl");
  const regressionFile = path.join(args.sandbox.root, ".futureproof", "regression-snapshots.jsonl");
  let editCycle = 0;
  const tools = createAgentTools({
    sandbox: args.sandbox,
    commandTimeoutMs: Math.min(30_000, args.budget.timeoutMs),
    onAfterEdit: async () => {
      editCycle += 1;
      const remainingMs = Math.max(1, Math.floor(deadline - performance.now()));
      const snapshot = await probeRegression(args.sandbox, editCycle, Math.min(30_000, remainingMs));
      await appendJsonl(regressionFile, snapshot);
    },
  });
  const messages: Array<Record<string, unknown>> = [{
    role: "user",
    content: JSON.stringify({
      requirement: args.scenario.requirement,
      acceptance: args.scenario.acceptance,
    }),
  }];

  let seq = 0;
  let toolCallsExecuted = 0;
  let testCycles = 0;
  let totalTokens = 0;
  let lastTestPassed = false;

  const emit = async (event: Omit<AgentEvent, "seq" | "timestampMs">): Promise<void> => {
    const full: AgentEvent = {
      ...event,
      seq: ++seq,
      timestampMs: Date.now(),
    };
    await appendJsonl(eventFile, full);
    await args.onEvent(full);
  };

  const stopForBudget = async (reason: AgentStopReason, detail: Record<string, unknown> = {}): Promise<{ stopReason: AgentStopReason }> => {
    await emit({
      type: "budget",
      payload: { reason, toolCallsExecuted, testCycles, totalTokens, ...detail },
    });
    return { stopReason: reason };
  };

  while (true) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return await stopForBudget("timeout");
    if (toolCallsExecuted >= args.budget.maxToolCalls) return await stopForBudget("tool_budget");
    if (totalTokens >= args.budget.maxTokens) return await stopForBudget("token_budget");

    let turn;
    try {
      turn = await withinDeadline(args.client.nextToolTurn({ system: SYSTEM_PROMPT, messages, tools: tools.definitions }), remaining);
    } catch (error) {
      if (error instanceof DeadlineExceededError) return await stopForBudget("timeout");
      throw error;
    }

    totalTokens += turn.inputTokens + turn.outputTokens;
    await emit({
      type: "model_turn",
      payload: {
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        totalTokens,
        toolCallCount: turn.toolCalls.length,
      },
    });
    if (totalTokens > args.budget.maxTokens) return await stopForBudget("token_budget");

    messages.push(turn.assistantMessage);
    if (turn.toolCalls.length === 0) {
      if (lastTestPassed) return { stopReason: "completed" };
      messages.push({ role: "user", content: "Run the test suite and make it pass before declaring completion." });
      continue;
    }

    for (const call of turn.toolCalls) {
      if (toolCallsExecuted >= args.budget.maxToolCalls) return await stopForBudget("tool_budget");
      if (call.name === "run_command" && call.arguments.command === "pnpm test" && testCycles >= args.budget.maxTestCycles) {
        return await stopForBudget("tool_budget", { reasonDetail: "test_cycle_budget" });
      }
      const toolRemaining = deadline - performance.now();
      if (toolRemaining <= 0) return await stopForBudget("timeout");

      toolCallsExecuted += 1;
      if (call.name === "run_command" && call.arguments.command === "pnpm test") testCycles += 1;
      await emit({ type: "tool_call", tool: call.name, payload: { id: call.id, arguments: call.arguments } });

      let result: Record<string, unknown>;
      try {
        result = await withinDeadline(tools.execute(call.name, call.arguments), toolRemaining);
      } catch (error) {
        if (error instanceof DeadlineExceededError) return await stopForBudget("timeout");
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (call.name === "run_command" && call.arguments.command === "pnpm test") {
        lastTestPassed = typeof result.exitCode === "number" && result.exitCode === 0;
      }
      await emit({ type: "tool_result", tool: call.name, payload: { id: call.id, result: compactToolResult(result) } });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });

      if (toolCallsExecuted >= args.budget.maxToolCalls) return await stopForBudget("tool_budget");
    }
  }
}
