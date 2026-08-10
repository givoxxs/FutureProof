import type { RegressionSnapshot } from "@futureproof/core";
import type { Sandbox } from "./sandbox-manager.ts";
import { runAllowedCommand } from "./command-runner.ts";

export function parseNodeTestCounts(output: string): { passed: number; failed: number } | null {
  const pass = /^# pass (\d+)$/m.exec(output);
  const fail = /^# fail (\d+)$/m.exec(output);
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
