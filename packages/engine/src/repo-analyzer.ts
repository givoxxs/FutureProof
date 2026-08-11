import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export interface RepoSummary {
  root: string;
  language: "typescript" | "javascript" | "mixed";
  packageManager: "npm" | "pnpm";
  scripts: { test?: string; build?: string };
  sourceFiles: string[];
  testFiles: string[];
  publicExports: string[];
  importEdges: Array<{ from: string; to: string }>;
  readmeExcerpt: string;
}

export class UnsupportedRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedRepositoryError";
  }
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", ".futureproof"]);

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function walk(root: string, relativeDir: string): Promise<string[]> {
  const absoluteDir = path.join(root, relativeDir);
  if (!(await exists(absoluteDir))) return [];

  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      files.push(...await walk(root, path.join(relativeDir, entry.name)));
      continue;
    }
    if (!entry.isFile()) continue;
    const relativeFile = path.join(relativeDir, entry.name).split(path.sep).join("/");
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(relativeFile);
  }
  return files.sort();
}

function determineLanguage(files: string[]): RepoSummary["language"] {
  const hasTypeScript = files.some((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const hasJavaScript = files.some((file) => file.endsWith(".js") || file.endsWith(".jsx"));
  if (hasTypeScript && hasJavaScript) return "mixed";
  return hasJavaScript ? "javascript" : "typescript";
}

function collectExports(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (exported && "name" in statement && statement.name && ts.isIdentifier(statement.name)) {
      names.push(statement.name.text);
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.push(element.name.text);
    }
  }
  return names;
}

function collectImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return imports;
}

async function findAncestorMarker(start: string, marker: string): Promise<boolean> {
  let current = path.resolve(start);
  while (true) {
    if (await exists(path.join(current, marker))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

async function detectPackageManager(root: string, packageJson: Record<string, unknown>): Promise<"npm" | "pnpm"> {
  const declared = typeof packageJson.packageManager === "string" ? packageJson.packageManager : "";
  if (declared) {
    if (declared.startsWith("pnpm@")) return "pnpm";
    if (declared.startsWith("npm@")) return "npm";
    throw new UnsupportedRepositoryError(`unsupported package manager: ${declared}`);
  }

  if (await findAncestorMarker(root, "pnpm-lock.yaml")) return "pnpm";
  if (await findAncestorMarker(root, "yarn.lock")) {
    throw new UnsupportedRepositoryError("yarn repositories are not supported");
  }
  return "npm";
}

export async function analyzeRepo(root: string): Promise<RepoSummary> {
  const absoluteRoot = path.resolve(root);
  const packageFile = path.join(absoluteRoot, "package.json");
  if (!(await exists(packageFile))) {
    throw new UnsupportedRepositoryError("package.json is required");
  }

  const packageJson = JSON.parse(await fs.readFile(packageFile, "utf8")) as Record<string, unknown>;
  const packageManager = await detectPackageManager(absoluteRoot, packageJson);
  const sourceFiles = await walk(absoluteRoot, "src");
  const testFiles = [...await walk(absoluteRoot, "test"), ...await walk(absoluteRoot, "tests")].sort();
  const allFiles = [...sourceFiles, ...testFiles];
  const publicExports = new Set<string>();
  const importEdges: Array<{ from: string; to: string }> = [];

  for (const relativeFile of sourceFiles) {
    const source = await fs.readFile(path.join(absoluteRoot, relativeFile), "utf8");
    const sourceFile = ts.createSourceFile(
      relativeFile,
      source,
      ts.ScriptTarget.Latest,
      true,
      relativeFile.endsWith(".tsx") ? ts.ScriptKind.TSX : relativeFile.endsWith(".jsx") ? ts.ScriptKind.JSX : relativeFile.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS,
    );
    for (const name of collectExports(sourceFile)) publicExports.add(name);
    for (const target of collectImports(sourceFile)) importEdges.push({ from: relativeFile, to: target });
  }

  const scriptsValue = packageJson.scripts;
  const scriptsRecord = typeof scriptsValue === "object" && scriptsValue !== null ? scriptsValue as Record<string, unknown> : {};
  const readmeFile = (await exists(path.join(absoluteRoot, "README.md"))) ? path.join(absoluteRoot, "README.md") : null;
  const readmeExcerpt = readmeFile ? (await fs.readFile(readmeFile, "utf8")).slice(0, 4000) : "";

  return {
    root: absoluteRoot,
    language: determineLanguage(allFiles),
    packageManager,
    scripts: {
      test: typeof scriptsRecord.test === "string" ? scriptsRecord.test : undefined,
      build: typeof scriptsRecord.build === "string" ? scriptsRecord.build : undefined,
    },
    sourceFiles,
    testFiles,
    publicExports: [...publicExports].sort(),
    importEdges,
    readmeExcerpt,
  };
}
