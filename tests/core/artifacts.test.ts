import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analysisArtifactDir } from "../../packages/core/src/paths.ts";
import { appendJsonl, readJson, writeJson } from "../../packages/core/src/artifacts.ts";

test("analysisArtifactDir creates the canonical run path", () => {
  assert.equal(
    analysisArtifactDir("/repo", "analysis-1"),
    path.join("/repo", ".futureproof", "runs", "analysis-1"),
  );
});

test("writeJson and readJson round trip values and create parents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-core-"));
  const file = path.join(root, "nested", "metadata.json");
  const value = { analysisId: "analysis-1", candidates: ["A", "B"] };
  await writeJson(file, value);
  assert.deepEqual(await readJson(file), value);
});

test("appendJsonl appends one json object per line", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-core-"));
  const file = path.join(root, "events", "tool-events.jsonl");
  await appendJsonl(file, { tool: "read_file", seq: 1 });
  await appendJsonl(file, { tool: "run_command", seq: 2 });
  const lines = (await fs.readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines, [
    { tool: "read_file", seq: 1 },
    { tool: "run_command", seq: 2 },
  ]);
});
