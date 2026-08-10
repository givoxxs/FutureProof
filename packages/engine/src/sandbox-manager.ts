import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { CandidateBaseline, CandidateId } from "@futureproof/core";
import { runAllowedCommand } from "./command-runner.ts";
import { parseNodeTestCounts } from "./regression-probe.ts";

export interface Sandbox {
  root: string;
  candidateId: CandidateId;
  scenarioId: string;
  trial: number;
}

const EXCLUDED = new Set([".git", "node_modules", ".futureproof", "dist"]);

async function runPnpmInstall(cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["install", "--no-lockfile", "--ignore-scripts"], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pnpm install failed with exit ${code ?? 1}: ${stderr.trim()}`));
    });
  });
}

function shouldCopy(sourceRoot: string, sourcePath: string): boolean {
  const relative = path.relative(sourceRoot, sourcePath);
  if (!relative || relative === ".") return true;
  return !relative.split(path.sep).some((part) => EXCLUDED.has(part));
}

export async function createSandbox(args: {
  sourceRoot: string;
  runRoot: string;
  analysisId: string;
  candidateId: CandidateId;
  scenarioId: string;
  trial: number;
}): Promise<Sandbox> {
  if (!Number.isInteger(args.trial) || args.trial < 1) throw new Error("trial must be a positive integer");
  const sourceRoot = path.resolve(args.sourceRoot);
  const destination = path.resolve(
    args.runRoot,
    args.analysisId,
    "sandboxes",
    args.candidateId,
    args.scenarioId,
    `trial-${args.trial}`,
  );
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(sourceRoot, destination, {
    recursive: true,
    filter: (sourcePath) => shouldCopy(sourceRoot, sourcePath),
  });
  await runPnpmInstall(destination);
  return { root: destination, candidateId: args.candidateId, scenarioId: args.scenarioId, trial: args.trial };
}

export async function validateBaseline(sandbox: Sandbox): Promise<CandidateBaseline> {
  const test = await runAllowedCommand(sandbox.root, "pnpm test", 30_000);
  const counts = parseNodeTestCounts(`${test.stdout}\n${test.stderr}`);
  if (!counts) {
    throw new Error(`test totals unavailable while validating baseline (exit ${test.exitCode})`);
  }
  const build = await runAllowedCommand(sandbox.root, "pnpm run build", 30_000);
  const valid = test.exitCode === 0 && counts.failed === 0 && build.exitCode === 0;
  return {
    candidateId: sandbox.candidateId,
    testsPassed: counts.passed,
    testsFailed: counts.failed,
    buildPassed: build.exitCode === 0,
    valid,
  };
}
