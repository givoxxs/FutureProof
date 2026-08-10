import type { RegressionSnapshot } from "@futureproof/core";
import type { Sandbox } from "./sandbox-manager.ts";
import { runAllowedCommand } from "./command-runner.ts";

const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export function parseNodeTestCounts(output: string): { passed: number; failed: number } | null {
  const normalized = output.replace(ANSI_ESCAPE, "");
  const pass = /^(?:#|ℹ)\s*pass\s+(\d+)\s*$/m.exec(normalized);
  const fail = /^(?:#|ℹ)\s*fail\s+(\d+)\s*$/m.exec(normalized);
  if (!pass || !fail) return null;
  return { passed: Number(pass[1]), failed: Number(fail[1]) };
}

export async function probeRegression(sandbox: Sandbox, cycle: number, timeoutMs = 30_000): Promise<RegressionSnapshot> {
  if (!Number.isInteger(cycle) || cycle < 1) throw new Error("cycle must be a positive integer");
  const result = await runAllowedCommand(sandbox.root, "pnpm test", timeoutMs);
  const counts = parseNodeTestCounts(`${result.stdout}\n${result.stderr}`);
  if (!counts) {
    throw new Error(`test totals unavailable while probing regression (exit ${result.exitCode})`);
  }
  return {
    cycle,
    passed: counts.passed,
    failed: counts.failed,
    timestampMs: Date.now(),
  };
}
