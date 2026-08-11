import { spawn } from "node:child_process";

export type AllowedCommand = "pnpm test" | "pnpm run build";

export class CommandPolicyError extends Error {
  constructor(command: string) {
    super(`command is not allowed: ${command}`);
    this.name = "CommandPolicyError";
  }
}

export class CommandTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`command timed out after ${timeoutMs}ms: ${command}`);
    this.name = "CommandTimeoutError";
  }
}

const COMMANDS: Record<AllowedCommand, readonly [string, readonly string[]]> = {
  "pnpm test": ["pnpm", ["test"]],
  "pnpm run build": ["pnpm", ["run", "build"]],
};

export async function runAllowedCommand(
  cwd: string,
  command: AllowedCommand,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
  const spec = COMMANDS[command];
  if (!spec) throw new CommandPolicyError(String(command));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be positive");

  const started = performance.now();
  return await new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(spec[0], [...spec[1]], {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new CommandTimeoutError(command, timeoutMs));
        return;
      }
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        durationMs: performance.now() - started,
      });
    });
  });
}
