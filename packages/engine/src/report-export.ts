import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { analysisArtifactDir } from "@futureproof/core/paths";
import type { AnalysisReport } from "./compare.ts";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function publicValue(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(publicValue);
  if (typeof value !== "object") return String(value);

  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (key === "patchPath" || key === "artifactDir") continue;
    result[key] = publicValue((value as Record<string, unknown>)[key]);
  }
  return result;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(publicValue(value), null, 2)}\n`;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function renderReportMarkdown(report: AnalysisReport): string {
  const candidateA = report.candidates.A;
  const candidateB = report.candidates.B;
  const lines = [
    "# FutureProof Analysis Report",
    "",
    `Analysis ID: \`${report.analysisId}\``,
    "",
    "## Future risk",
    "",
    "| Candidate | Overall risk | Current baseline | Future scenarios |",
    "| --- | ---: | --- | ---: |",
    `| Candidate A | ${formatNumber(candidateA.dimensions.overallRisk)}/100 | ${candidateA.baseline.testsPassed}/${candidateA.baseline.testsPassed + candidateA.baseline.testsFailed} tests | ${candidateA.aggregatedScenarios.length} |`,
    `| Candidate B | ${formatNumber(candidateB.dimensions.overallRisk)}/100 | ${candidateB.baseline.testsPassed}/${candidateB.baseline.testsPassed + candidateB.baseline.testsFailed} tests | ${candidateB.aggregatedScenarios.length} |`,
    "",
    "## Measured evidence",
    "",
    "| Metric | Candidate A | Candidate B | B / A |",
    "| --- | ---: | ---: | ---: |",
    `| Tool calls (avg) | ${formatNumber(candidateA.averages.toolCalls)} | ${formatNumber(candidateB.averages.toolCalls)} | ${report.ratioLabels.toolCalls} |`,
    `| Files touched (avg) | ${formatNumber(candidateA.averages.filesTouched)} | ${formatNumber(candidateB.averages.filesTouched)} | ${report.ratioLabels.filesTouched} |`,
    `| Regression cycles (avg) | ${formatNumber(candidateA.averages.regressionCycles)} | ${formatNumber(candidateB.averages.regressionCycles)} | ${report.ratioLabels.regressionArea} |`,
    `| Token usage (avg) | ${formatNumber(candidateA.averages.tokenUsage)} | ${formatNumber(candidateB.averages.tokenUsage)} | ${report.ratioLabels.tokenUsage} |`,
    "",
    "## Scenario results",
    "",
    "| Scenario | Difficulty | Candidate A | Candidate B | Trials |",
    "| --- | --- | --- | --- | ---: |",
  ];

  for (const scenario of report.scenarios) {
    const aggregateA = candidateA.aggregatedScenarios.find((item) => item.scenarioId === scenario.id);
    const aggregateB = candidateB.aggregatedScenarios.find((item) => item.scenarioId === scenario.id);
    if (!aggregateA || !aggregateB) continue;
    const trialLabel = aggregateA.trialCount === aggregateB.trialCount
      ? `${aggregateA.trialCount} ${aggregateA.trialCount === 1 ? "trial" : "trials"}`
      : `${aggregateA.trialCount} A / ${aggregateB.trialCount} B`;
    lines.push(`| ${escapeTable(scenario.title)} | ${scenario.difficulty} | ${aggregateA.status} | ${aggregateB.status} | ${trialLabel} |`);
  }

  lines.push(
    "",
    "## Method note",
    "",
    "Future scenarios are frozen before candidate execution. Both candidates use the same agent configuration and budget; scores are computed from observed tests, edits, regressions, structural deltas, and resource usage.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

export interface ReportBundleResult {
  directory: string;
  files: {
    report: string;
    markdown: string;
    manifest: string;
  };
}

export async function writeReportBundle(root: string, report: AnalysisReport): Promise<ReportBundleResult> {
  const directory = path.join(analysisArtifactDir(root, report.analysisId), "exports");
  await fs.mkdir(directory, { recursive: true });

  const reportText = stableJson(report);
  const markdownText = renderReportMarkdown(report);
  const reportFile = path.join(directory, "report.json");
  const markdownFile = path.join(directory, "report.md");
  const manifestFile = path.join(directory, "manifest.json");

  await fs.writeFile(reportFile, reportText, "utf8");
  await fs.writeFile(markdownFile, markdownText, "utf8");

  const manifest = {
    schemaVersion: 1,
    analysisId: report.analysisId,
    files: { report: "report.json", markdown: "report.md" },
    reportSha256: sha256(reportText),
    markdownSha256: sha256(markdownText),
  };
  await fs.writeFile(manifestFile, stableJson(manifest), "utf8");

  return {
    directory,
    files: { report: reportFile, markdown: markdownFile, manifest: manifestFile },
  };
}
