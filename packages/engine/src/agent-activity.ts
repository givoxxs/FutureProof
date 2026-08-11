import type { AgentBudget } from "@futureproof/core";
import type { AgentEvent } from "./coding-agent.ts";

export type AgentActivityAction =
  | "thinking"
  | "searching"
  | "reading"
  | "editing"
  | "testing"
  | "repairing"
  | "done"
  | "failed";

export interface AgentActivityState {
  toolCallsExecuted: number;
  testCycles: number;
  totalTokens: number;
  failedTestSeen: boolean;
}

export interface AgentActivityDetail {
  agentEventType: AgentEvent["type"] | "terminal";
  action: AgentActivityAction;
  tool?: string;
  label?: string;
  toolCallsExecuted: number;
  maxToolCalls: number;
  testCycles: number;
  maxTestCycles: number;
  totalTokens: number;
  maxTokens: number;
}

export function createAgentActivityState(): AgentActivityState {
  return { toolCallsExecuted: 0, testCycles: 0, totalTokens: 0, failedTestSeen: false };
}

function stringArg(event: AgentEvent, key: string): string | undefined {
  const args = event.payload.arguments;
  if (!args || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function commandResultExitCode(event: AgentEvent): number | undefined {
  const result = event.payload.result;
  if (!result || typeof result !== "object") return undefined;
  const exitCode = (result as Record<string, unknown>).exitCode;
  return typeof exitCode === "number" ? exitCode : undefined;
}

function counters(state: AgentActivityState, budget: AgentBudget) {
  return {
    toolCallsExecuted: state.toolCallsExecuted,
    maxToolCalls: budget.maxToolCalls,
    testCycles: state.testCycles,
    maxTestCycles: budget.maxTestCycles,
    totalTokens: state.totalTokens,
    maxTokens: budget.maxTokens,
  };
}

export function activityFromAgentEvent(
  event: AgentEvent,
  state: AgentActivityState,
  budget: AgentBudget,
): AgentActivityDetail | null {
  if (event.type === "model_turn") {
    const totalTokens = event.payload.totalTokens;
    if (typeof totalTokens === "number" && Number.isFinite(totalTokens)) state.totalTokens = totalTokens;
    return { agentEventType: event.type, action: "thinking", ...counters(state, budget) };
  }

  if (event.type === "tool_result") {
    if (event.tool === "run_command") {
      const exitCode = commandResultExitCode(event);
      if (typeof exitCode === "number") state.failedTestSeen = exitCode !== 0;
    }
    return null;
  }

  if (event.type === "budget") {
    const toolCalls = event.payload.toolCallsExecuted;
    const testCycles = event.payload.testCycles;
    const totalTokens = event.payload.totalTokens;
    if (typeof toolCalls === "number") state.toolCallsExecuted = toolCalls;
    if (typeof testCycles === "number") state.testCycles = testCycles;
    if (typeof totalTokens === "number") state.totalTokens = totalTokens;
    const reason = typeof event.payload.reason === "string" ? event.payload.reason : "budget exhausted";
    return { agentEventType: event.type, action: "failed", label: reason, ...counters(state, budget) };
  }

  if (event.type !== "tool_call" || !event.tool) return null;
  state.toolCallsExecuted += 1;

  if (event.tool === "search_code") {
    return {
      agentEventType: event.type,
      action: "searching",
      tool: event.tool,
      label: stringArg(event, "query") ?? stringArg(event, "pattern") ?? "repository",
      ...counters(state, budget),
    };
  }

  if (event.tool === "read_file" || event.tool === "list_files") {
    return {
      agentEventType: event.type,
      action: "reading",
      tool: event.tool,
      label: stringArg(event, "path") ?? ".",
      ...counters(state, budget),
    };
  }

  if (event.tool === "apply_patch") {
    return {
      agentEventType: event.type,
      action: state.failedTestSeen ? "repairing" : "editing",
      tool: event.tool,
      label: stringArg(event, "path") ?? "source",
      ...counters(state, budget),
    };
  }

  if (event.tool === "run_command") {
    const command = stringArg(event, "command") ?? "command";
    if (command === "pnpm test") state.testCycles += 1;
    return {
      agentEventType: event.type,
      action: command === "pnpm test" ? "testing" : "reading",
      tool: event.tool,
      label: command,
      ...counters(state, budget),
    };
  }

  return null;
}

export function terminalActivity(
  state: AgentActivityState,
  budget: AgentBudget,
  action: "done" | "failed",
  label?: string,
): AgentActivityDetail {
  return { agentEventType: "terminal", action, label, ...counters(state, budget) };
}
