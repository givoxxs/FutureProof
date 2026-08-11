import fs from "node:fs/promises";
import path from "node:path";
import type { AgentToolName } from "@futureproof/core";
import type { ToolDefinition } from "./llm-client.ts";
import type { Sandbox } from "./sandbox-manager.ts";
import { runAllowedCommand, type AllowedCommand } from "./command-runner.ts";

const MAX_FILE_BYTES = 200 * 1024;
const IGNORED_PARTS = new Set([".git", "node_modules", ".futureproof", "dist"]);
const SEARCH_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export class AgentToolPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentToolPathError";
  }
}

export class AgentPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentPatchError";
  }
}

export class AgentFileTooLargeError extends Error {
  constructor(relativePath: string) {
    super(`file exceeds 200 KB read limit: ${relativePath}`);
    this.name = "AgentFileTooLargeError";
  }
}

export interface AgentToolEnvironment {
  definitions: ToolDefinition[];
  execute(name: AgentToolName, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface AgentToolsOptions {
  sandbox: Sandbox;
  commandTimeoutMs?: number;
  onAfterEdit?: () => Promise<void>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveSafeExistingPath(root: string, requested: string): Promise<{ absolute: string; relative: string }> {
  if (!requested || path.isAbsolute(requested)) throw new AgentToolPathError(`unsafe path: ${requested}`);
  const segments = requested.split(/[\\/]+/);
  if (segments.includes("..")) throw new AgentToolPathError(`path traversal is not allowed: ${requested}`);

  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, requested);
  if (!inside(absoluteRoot, absolute)) throw new AgentToolPathError(`path escaped sandbox: ${requested}`);

  let stat;
  try {
    stat = await fs.lstat(absolute);
  } catch {
    throw new AgentToolPathError(`path does not exist in sandbox: ${requested}`);
  }
  if (stat.isSymbolicLink()) throw new AgentToolPathError(`symlinks are not allowed: ${requested}`);

  const realRoot = await fs.realpath(absoluteRoot);
  const realTarget = await fs.realpath(absolute);
  if (!inside(realRoot, realTarget)) throw new AgentToolPathError(`resolved path escaped sandbox: ${requested}`);
  return { absolute: realTarget, relative: path.relative(realRoot, realTarget).split(path.sep).join("/") || "." };
}

async function readCapped(file: string, relativePath: string): Promise<string> {
  const stat = await fs.stat(file);
  if (stat.size > MAX_FILE_BYTES) throw new AgentFileTooLargeError(relativePath);
  return await fs.readFile(file, "utf8");
}

async function walkFiles(root: string, relativeDir = "."): Promise<string[]> {
  const start = await resolveSafeExistingPath(root, relativeDir);
  const canonicalRoot = await fs.realpath(path.resolve(root));
  const stat = await fs.stat(start.absolute);
  if (!stat.isDirectory()) return [start.relative];
  const files: string[] = [];

  async function walk(absoluteDir: string): Promise<void> {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (IGNORED_PARTS.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(absoluteDir, entry.name);
      const relative = path.relative(canonicalRoot, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push(relative);
    }
  }

  await walk(start.absolute);
  return files.sort();
}

export function createAgentTools(options: AgentToolsOptions): AgentToolEnvironment {
  const commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
  const definitions: ToolDefinition[] = [
    {
      name: "list_files",
      description: "List files recursively inside the repository sandbox.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
    },
    {
      name: "read_file",
      description: "Read one UTF-8 file inside the sandbox, up to 200 KB.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
    },
    {
      name: "search_code",
      description: "Search source and test files for a literal string or regular expression.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, regex: { type: "boolean" }, path: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "apply_patch",
      description: "Replace text in one sandbox file. The expected text must occur exactly once.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, expected: { type: "string" }, replacement: { type: "string" } },
        required: ["path", "expected", "replacement"],
        additionalProperties: false,
      },
    },
    {
      name: "run_command",
      description: "Run the repository test suite or build using the exact command policy.",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string", enum: ["pnpm test", "pnpm run build"] } },
        required: ["command"],
        additionalProperties: false,
      },
    },
  ];

  return {
    definitions,
    async execute(name, args) {
      if (name === "list_files") {
        const requested = args.path === undefined ? "." : asString(args.path, "path");
        return { files: await walkFiles(options.sandbox.root, requested) };
      }

      if (name === "read_file") {
        const requested = asString(args.path, "path");
        const safe = await resolveSafeExistingPath(options.sandbox.root, requested);
        const stat = await fs.stat(safe.absolute);
        if (!stat.isFile()) throw new AgentToolPathError(`not a file: ${requested}`);
        return { path: safe.relative, content: await readCapped(safe.absolute, safe.relative) };
      }

      if (name === "search_code") {
        const query = asString(args.query, "query");
        if (!query) throw new Error("query must not be empty");
        const requested = args.path === undefined ? "." : asString(args.path, "path");
        const candidateFiles = (await walkFiles(options.sandbox.root, requested))
          .filter((file) => SEARCH_EXTENSIONS.has(path.extname(file)))
          .filter((file) => file.startsWith("src/") || file.startsWith("test/") || file.startsWith("tests/"));
        const matcher = args.regex === true ? new RegExp(query) : null;
        const matches: Array<{ path: string; line: number; text: string }> = [];
        for (const relative of candidateFiles) {
          const safe = await resolveSafeExistingPath(options.sandbox.root, relative);
          const content = await readCapped(safe.absolute, relative);
          const lines = content.split(/\r?\n/);
          for (let index = 0; index < lines.length; index += 1) {
            const text = lines[index] ?? "";
            const hit = matcher ? matcher.test(text) : text.includes(query);
            if (matcher) matcher.lastIndex = 0;
            if (hit) matches.push({ path: relative, line: index + 1, text });
            if (matches.length >= 100) return { matches, truncated: true };
          }
        }
        return { matches, truncated: false };
      }

      if (name === "apply_patch") {
        const requested = asString(args.path, "path");
        const expected = asString(args.expected, "expected");
        const replacement = asString(args.replacement, "replacement");
        if (!expected) throw new AgentPatchError("expected text must not be empty");
        const safe = await resolveSafeExistingPath(options.sandbox.root, requested);
        const content = await readCapped(safe.absolute, safe.relative);
        const first = content.indexOf(expected);
        const second = first < 0 ? -1 : content.indexOf(expected, first + expected.length);
        if (first < 0 || second >= 0) {
          throw new AgentPatchError(`expected text must match exactly once in ${safe.relative}`);
        }
        const updated = content.slice(0, first) + replacement + content.slice(first + expected.length);
        await fs.writeFile(safe.absolute, updated, "utf8");
        await options.onAfterEdit?.();
        return { path: safe.relative, changed: true, bytes: Buffer.byteLength(updated) };
      }

      if (name === "run_command") {
        const command = asString(args.command, "command") as AllowedCommand;
        return await runAllowedCommand(options.sandbox.root, command, commandTimeoutMs);
      }

      throw new Error(`unsupported agent tool: ${name satisfies never}`);
    },
  };
}
