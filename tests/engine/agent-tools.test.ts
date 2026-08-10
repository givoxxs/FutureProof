import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Sandbox } from "../../packages/engine/src/sandbox-manager.ts";
import { createAgentTools, AgentToolPathError, AgentPatchError, AgentFileTooLargeError } from "../../packages/engine/src/agent-tools.ts";

async function makeSandbox(): Promise<{ sandbox: Sandbox; outside: string }> {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-tools-"));
  const root = path.join(parent, "sandbox");
  const outside = path.join(parent, "outside.txt");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "test"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "value.ts"), "export const value = 'old';\n", "utf8");
  await fs.writeFile(path.join(root, "test", "value.test.ts"), "// old behavior\n", "utf8");
  await fs.writeFile(path.join(root, "README.md"), "sandbox readme\n", "utf8");
  await fs.writeFile(outside, "outside secret\n", "utf8");
  await fs.symlink(outside, path.join(root, "src", "escape.ts"));
  return {
    sandbox: { root, candidateId: "A", scenarioId: "FR-01", trial: 1 },
    outside,
  };
}

test("file tools operate on normal relative paths inside the sandbox", async () => {
  const { sandbox } = await makeSandbox();
  const tools = createAgentTools({ sandbox });

  const listed = await tools.execute("list_files", { path: "." });
  assert.deepEqual((listed as { files: string[] }).files, ["README.md", "src/value.ts", "test/value.test.ts"]);

  const read = await tools.execute("read_file", { path: "src/value.ts" });
  assert.match((read as { content: string }).content, /value = 'old'/);

  const searched = await tools.execute("search_code", { query: "old" });
  const matches = (searched as { matches: Array<{ path: string; line: number }> }).matches;
  assert.deepEqual(matches.map((match) => [match.path, match.line]), [["src/value.ts", 1], ["test/value.test.ts", 1]]);

  const patched = await tools.execute("apply_patch", {
    path: "src/value.ts",
    expected: "value = 'old'",
    replacement: "value = 'new'",
  });
  assert.equal((patched as { changed: boolean }).changed, true);
  assert.match(await fs.readFile(path.join(sandbox.root, "src", "value.ts"), "utf8"), /value = 'new'/);
});

test("all path-bearing tools reject traversal, absolute paths, and symlink escapes", async () => {
  const { sandbox, outside } = await makeSandbox();
  const tools = createAgentTools({ sandbox });
  const badPaths = ["../outside.txt", outside, "src/escape.ts"];

  for (const badPath of badPaths) {
    await assert.rejects(() => tools.execute("read_file", { path: badPath }), AgentToolPathError);
    await assert.rejects(() => tools.execute("apply_patch", { path: badPath, expected: "x", replacement: "y" }), AgentToolPathError);
  }

  await assert.rejects(() => tools.execute("list_files", { path: ".." }), AgentToolPathError);
  await assert.rejects(() => tools.execute("search_code", { query: "secret", path: ".." }), AgentToolPathError);
});

test("apply_patch requires expected text to match exactly once", async () => {
  const { sandbox } = await makeSandbox();
  await fs.writeFile(path.join(sandbox.root, "src", "value.ts"), "same\nsame\n", "utf8");
  const tools = createAgentTools({ sandbox });

  await assert.rejects(
    () => tools.execute("apply_patch", { path: "src/value.ts", expected: "same", replacement: "new" }),
    /exactly once/i,
  );
  await assert.rejects(
    () => tools.execute("apply_patch", { path: "src/value.ts", expected: "missing", replacement: "new" }),
    AgentPatchError,
  );
});

test("read_file rejects files larger than 200 KB", async () => {
  const { sandbox } = await makeSandbox();
  const tools = createAgentTools({ sandbox });
  await fs.writeFile(path.join(sandbox.root, "src", "large.ts"), "x".repeat(200 * 1024 + 1), "utf8");
  await assert.rejects(() => tools.execute("read_file", { path: "src/large.ts" }), AgentFileTooLargeError);
});

test("run_command delegates only exact pnpm commands", async () => {
  const { sandbox } = await makeSandbox();
  await fs.writeFile(path.join(sandbox.root, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"", build: "node -e \"process.exit(0)\"" } }), "utf8");
  const tools = createAgentTools({ sandbox, commandTimeoutMs: 2_000 });
  const definition = tools.definitions.find((tool) => tool.name === "run_command");
  assert.deepEqual((definition?.inputSchema.properties as any).command.enum, ["pnpm test", "pnpm run build"]);
  const result = await tools.execute("run_command", { command: "pnpm test" });
  assert.equal((result as { exitCode: number }).exitCode, 0);
  await assert.rejects(() => tools.execute("run_command", { command: "npm test" }));
  await assert.rejects(() => tools.execute("run_command", { command: "curl https://example.com" }));
});
