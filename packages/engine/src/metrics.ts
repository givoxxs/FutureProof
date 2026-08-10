import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { RegressionSnapshot, RunMetrics, StructuralDelta } from "@futureproof/core";
import { writeJson } from "@futureproof/core/artifacts";
import type { AgentEvent } from "./coding-agent.ts";
import type { Sandbox } from "./sandbox-manager.ts";

const IGNORED_PARTS = new Set([".git", "node_modules", ".futureproof", "dist"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

async function listFiles(root: string, relativeDir = "."): Promise<string[]> {
  const absolute = path.join(root, relativeDir);
  let entries;
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (IGNORED_PARTS.has(entry.name) || entry.isSymbolicLink()) continue;
    const relative = path.join(relativeDir, entry.name).replace(/^\.\//, "").split(path.sep).join("/");
    if (entry.isDirectory()) files.push(...await listFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

async function readOptional(root: string, relative: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(root, relative), "utf8");
  } catch {
    return null;
  }
}

function lineDelta(before: string, after: string): { added: number; deleted: number } {
  const a = before.length ? before.replace(/\n$/, "").split("\n") : [];
  const b = after.length ? after.replace(/\n$/, "").split("\n") : [];
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = table[i]!;
    const nextRow = table[i + 1]!;
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? 1 + nextRow[j + 1]! : Math.max(nextRow[j]!, row[j + 1]!);
    }
  }
  const lcs = table[0]![0]!;
  return { added: b.length - lcs, deleted: a.length - lcs };
}

function sourceModule(relative: string): string | null {
  const parts = relative.split("/");
  if (parts[0] !== "src" || parts.length < 2) return null;
  return parts.length === 2 ? parts[1]! : parts[1]!;
}

function isPublicApiFile(relative: string): boolean {
  return relative.startsWith("src/") && /^index\.[cm]?[jt]sx?$/.test(path.basename(relative));
}

function parseSource(relative: string, text: string): ts.SourceFile {
  const extension = path.extname(relative);
  const kind = extension === ".tsx" ? ts.ScriptKind.TSX
    : extension === ".jsx" ? ts.ScriptKind.JSX
      : extension === ".js" || extension === ".mjs" || extension === ".cjs" ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, kind);
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) throw new Error(`parse failure in ${relative}`);
  return source;
}

function countBranches(source: ts.SourceFile): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isIfStatement(node)
      || ts.isCaseClause(node)
      || ts.isForStatement(node)
      || ts.isForInStatement(node)
      || ts.isForOfStatement(node)
      || ts.isWhileStatement(node)
      || ts.isDoStatement(node)
      || ts.isCatchClause(node)
      || ts.isConditionalExpression(node)
    ) count += 1;
    if (ts.isBinaryExpression(node) && [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(node.operatorToken.kind)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

async function structuralSnapshot(root: string): Promise<StructuralDelta> {
  const files = (await listFiles(root, "src")).filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)));
  let cyclomaticComplexity = files.length > 0 ? 1 : 0;
  const localImportTargets = new Set<string>();
  const windows = new Map<string, number>();
  let fileSizeLines = 0;

  for (const relative of files) {
    const text = await fs.readFile(path.join(root, relative), "utf8");
    const source = parseSource(relative, text);
    cyclomaticComplexity += countBranches(source);
    const normalizedLines = text.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean);
    fileSizeLines += normalizedLines.length;
    for (let index = 0; index + 6 <= normalizedLines.length; index += 1) {
      const key = normalizedLines.slice(index, index + 6).join("\n");
      windows.set(key, (windows.get(key) ?? 0) + 1);
    }
    for (const statement of source.statements) {
      if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifier = statement.moduleSpecifier.text;
        if (specifier.startsWith(".")) {
          localImportTargets.add(path.normalize(path.join(path.dirname(relative), specifier)).split(path.sep).join("/"));
        }
      }
    }
  }

  let duplicateLineWindows = 0;
  for (const count of windows.values()) duplicateLineWindows += Math.max(0, count - 1);
  return {
    cyclomaticComplexity,
    duplicateLineWindows,
    dependencyFanOut: localImportTargets.size,
    fileSizeLines,
  };
}

function subtractStructural(after: StructuralDelta, before: StructuralDelta): StructuralDelta {
  return {
    cyclomaticComplexity: after.cyclomaticComplexity - before.cyclomaticComplexity,
    duplicateLineWindows: after.duplicateLineWindows - before.duplicateLineWindows,
    dependencyFanOut: after.dependencyFanOut - before.dependencyFanOut,
    fileSizeLines: after.fileSizeLines - before.fileSizeLines,
  };
}

async function persistStructuralWarning(root: string, detail: string): Promise<void> {
  const file = path.join(root, ".futureproof", "metadata.json");
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    // New metadata artifact.
  }
  const warnings = Array.isArray(metadata.warnings) ? metadata.warnings : [];
  warnings.push({ code: "STRUCTURAL_METRICS_UNAVAILABLE", detail });
  await writeJson(file, { ...metadata, warnings });
}

export async function collectRunMetrics(args: {
  sandbox: Sandbox;
  baselineRoot: string;
  events: AgentEvent[];
  regressionSnapshots: RegressionSnapshot[];
  wallTimeMs: number;
  tokenUsage: number;
}): Promise<RunMetrics> {
  const beforeFiles = new Set(await listFiles(args.baselineRoot));
  const afterFiles = new Set(await listFiles(args.sandbox.root));
  const union = [...new Set([...beforeFiles, ...afterFiles])].sort();
  const changed: string[] = [];
  let locAdded = 0;
  let locDeleted = 0;

  for (const relative of union) {
    const before = await readOptional(args.baselineRoot, relative);
    const after = await readOptional(args.sandbox.root, relative);
    if (before === after) continue;
    changed.push(relative);
    const delta = lineDelta(before ?? "", after ?? "");
    locAdded += delta.added;
    locDeleted += delta.deleted;
  }

  const toolCalls = args.events.filter((event) => event.type === "tool_call");
  const countTool = (name: AgentEvent["tool"]) => toolCalls.filter((event) => event.tool === name).length;
  const testRuns = toolCalls.filter((event) => event.tool === "run_command" && (event.payload.arguments as Record<string, unknown> | undefined)?.command === "npm test").length;
  const modules = new Set(changed.map(sourceModule).filter((value): value is string => value !== null));

  let structuralDelta: StructuralDelta | null = null;
  try {
    const [before, after] = await Promise.all([structuralSnapshot(args.baselineRoot), structuralSnapshot(args.sandbox.root)]);
    structuralDelta = subtractStructural(after, before);
  } catch (error) {
    await persistStructuralWarning(args.sandbox.root, error instanceof Error ? error.message : String(error));
  }

  return {
    toolCalls: toolCalls.length,
    readOps: countTool("read_file"),
    searchOps: countTool("search_code"),
    editOps: countTool("apply_patch"),
    testRuns,
    tokenUsage: args.tokenUsage,
    wallTimeMs: args.wallTimeMs,
    filesTouched: changed.length,
    modulesTouched: modules.size,
    locAdded,
    locDeleted,
    publicApiFilesTouched: changed.filter(isPublicApiFile).length,
    regressionSnapshots: args.regressionSnapshots,
    structuralDelta,
  };
}
