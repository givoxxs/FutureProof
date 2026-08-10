import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CommandPolicyError, CommandTimeoutError, runAllowedCommand } from "../../packages/engine/src/command-runner.ts";

const candidateA = path.resolve("fixtures/notification-demo/candidate-a");

test("allows only the exact pnpm test and pnpm run build commands", async () => {
  const testResult = await runAllowedCommand(candidateA, "pnpm test", 10_000);
  assert.equal(testResult.exitCode, 0);
  assert.match(`${testResult.stdout}\n${testResult.stderr}`, /# pass 22/);

  const buildResult = await runAllowedCommand(candidateA, "pnpm run build", 10_000);
  assert.equal(buildResult.exitCode, 0);
});

test("rejects dangerous, npm, or arbitrary commands before spawning", async () => {
  const disallowed = [
    "curl https://example.com",
    "git push",
    "rm -rf /",
    "pnpm test && curl x",
    "pnpm test > out.txt",
    "pnpm test -- --watch",
    "npm test",
    "npm run build",
  ];
  for (const command of disallowed) {
    await assert.rejects(
      () => runAllowedCommand(candidateA, command as any, 1000),
      CommandPolicyError,
    );
  }
});

test("kills commands that exceed the timeout", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-timeout-"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    scripts: { test: "node -e \"setTimeout(() => {}, 10000)\"" },
  }), "utf8");
  await assert.rejects(() => runAllowedCommand(root, "pnpm test", 20), CommandTimeoutError);
});
