import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderReportMarkdown, writeReportBundle } from "../../packages/engine/src/report-export.ts";

const scenario = {
  id: "FR-04",
  title: "Provider Fallback (Email → SMS)",
  dimension: "composition",
  requirement: "Fall back to a secondary provider when the primary provider fails.",
  rationale: "Provider failures are plausible from the current requirement.",
  affectedCapability: "notification delivery",
  difficulty: "hard",
  externalDependencies: false,
  provenance: ["current-requirement.md"],
  acceptance: [{ name: "fallback", given: "primary fails", when: "notification runs", then: "secondary sends" }],
};

const baseAggregate = {
  scenarioId: "FR-04",
  trialCount: 3,
  metrics: {
    toolCalls: 12,
    filesTouched: 3,
    editOps: 2,
    testRuns: 3,
    tokenUsage: 11_500,
    regressionArea: 1,
    failedRegressionSnapshots: 1,
    structuralDelta: { cyclomaticComplexity: 3, duplicateLineWindows: 0, dependencyFanOut: 0, fileSizeLines: 2 },
    structuralMagnitude: 3.1,
  },
};

const report = {
  analysisId: "golden-export",
  candidates: {
    A: {
      candidateId: "A",
      baseline: { candidateId: "A", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
      dimensions: { resilienceRisk: 0, efficiencyRisk: 0, regressionRisk: 0, structuralRisk: 0, overallRisk: 18 },
      scenarioRuns: [],
      aggregatedScenarios: [{ ...baseAggregate, status: "SUCCESS" }],
      averages: { toolCalls: 12, filesTouched: 3, regressionCycles: 1, tokenUsage: 11_500 },
    },
    B: {
      candidateId: "B",
      baseline: { candidateId: "B", testsPassed: 22, testsFailed: 0, buildPassed: true, valid: true },
      dimensions: { resilienceRisk: 60, efficiencyRisk: 82, regressionRisk: 77, structuralRisk: 76, overallRisk: 74 },
      scenarioRuns: [],
      aggregatedScenarios: [{ ...baseAggregate, status: "FAIL", metrics: { ...baseAggregate.metrics, toolCalls: 35, filesTouched: 12, tokenUsage: 31_000 } }],
      averages: { toolCalls: 35, filesTouched: 12, regressionCycles: 7, tokenUsage: 31_000 },
    },
  },
  ratios: { toolCalls: 2.92, filesTouched: 4, regressionArea: 7, tokenUsage: 2.7 },
  ratioLabels: { toolCalls: "2.92x", filesTouched: "4.00x", regressionArea: "7.00x", tokenUsage: "2.70x" },
  scenarios: [scenario],
} as any;

test("renderReportMarkdown is deterministic and evidence-only", () => {
  const first = renderReportMarkdown(report);
  const second = renderReportMarkdown(report);

  assert.equal(first, second);
  assert.match(first, /^# FutureProof Analysis Report/m);
  assert.match(first, /Analysis ID: `golden-export`/);
  assert.match(first, /Candidate A \| 18\/100/);
  assert.match(first, /Candidate B \| 74\/100/);
  assert.match(first, /Provider Fallback \(Email → SMS\)/);
  assert.match(first, /3 trials/);
  assert.match(first, /2\.92x/);
  assert.doesNotMatch(first, /patchPath|artifactDir/);
});

test("writeReportBundle persists canonical JSON, Markdown, and a checksum manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "futureproof-export-"));
  const result = await writeReportBundle(root, report);

  assert.deepEqual(Object.keys(result.files).sort(), ["manifest", "markdown", "report"]);
  const json = JSON.parse(await fs.readFile(result.files.report, "utf8"));
  const markdown = await fs.readFile(result.files.markdown, "utf8");
  const manifest = JSON.parse(await fs.readFile(result.files.manifest, "utf8"));

  assert.equal(json.analysisId, "golden-export");
  assert.equal(markdown, renderReportMarkdown(report));
  assert.equal(manifest.analysisId, "golden-export");
  assert.match(manifest.reportSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.markdownSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.files.report, "report.json");
  assert.equal(manifest.files.markdown, "report.md");
});
