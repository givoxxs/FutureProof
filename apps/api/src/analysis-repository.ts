import fs from "node:fs/promises";
import path from "node:path";
import { analysisArtifactDir } from "@futureproof/core/paths";
import type { AnalysisReport } from "../../../packages/engine/src/compare.ts";

export type PersistedAnalysisStatus = "running" | "completed" | "failed" | "interrupted";

export interface RuntimeMetadata {
  provider?: string;
  model?: string;
  concurrency?: number;
  requestTimeoutMs?: number;
}

export interface PersistedAnalysisSummary extends RuntimeMetadata {
  version: 1;
  analysisId: string;
  status: PersistedAnalysisStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  candidateRisk?: { A: number; B: number };
  error?: string;
}

const STATE_FILE = "analysis-state.json";
const REPORT_FILE = "report.json";
const MAX_HISTORY = 50;

function assertAnalysisId(analysisId: string): void {
  if (!analysisId || analysisId === "." || analysisId === ".." || path.isAbsolute(analysisId) || analysisId.includes("/") || analysisId.includes("\\")) {
    throw new Error(`invalid analysis id: ${analysisId}`);
  }
}

function isSummary(value: unknown): value is PersistedAnalysisSummary {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.version === 1
    && typeof item.analysisId === "string"
    && ["running", "completed", "failed", "interrupted"].includes(String(item.status))
    && typeof item.createdAt === "string"
    && typeof item.updatedAt === "string";
}

function riskFromReport(report: AnalysisReport): { A: number; B: number } {
  return {
    A: report.candidates.A.dimensions.overallRisk,
    B: report.candidates.B.dimensions.overallRisk,
  };
}

export class AnalysisRepository {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  private runDir(analysisId: string): string {
    assertAnalysisId(analysisId);
    return analysisArtifactDir(this.projectRoot, analysisId);
  }

  private stateFile(analysisId: string): string {
    return path.join(this.runDir(analysisId), STATE_FILE);
  }

  private reportFile(analysisId: string): string {
    return path.join(this.runDir(analysisId), REPORT_FILE);
  }

  private async writeSummary(summary: PersistedAnalysisSummary): Promise<void> {
    const file = this.stateFile(summary.analysisId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await fs.rename(temporary, file);
  }

  async createRunning(analysisId: string): Promise<PersistedAnalysisSummary> {
    assertAnalysisId(analysisId);
    const now = new Date().toISOString();
    const summary: PersistedAnalysisSummary = {
      version: 1,
      analysisId,
      status: "running",
      createdAt: now,
      updatedAt: now,
    };
    await this.writeSummary(summary);
    return summary;
  }

  async patchRuntime(analysisId: string, runtime: RuntimeMetadata): Promise<void> {
    const current = await this.requireSummary(analysisId);
    const next: PersistedAnalysisSummary = {
      ...current,
      provider: runtime.provider ?? current.provider,
      model: runtime.model ?? current.model,
      concurrency: runtime.concurrency ?? current.concurrency,
      requestTimeoutMs: runtime.requestTimeoutMs ?? current.requestTimeoutMs,
      updatedAt: new Date().toISOString(),
    };
    await this.writeSummary(next);
  }

  async complete(analysisId: string, report: AnalysisReport): Promise<void> {
    const current = await this.requireSummary(analysisId);
    const now = new Date().toISOString();
    await this.writeSummary({
      ...current,
      status: "completed",
      updatedAt: now,
      completedAt: now,
      candidateRisk: riskFromReport(report),
      error: undefined,
    });
  }

  async fail(analysisId: string, error: string): Promise<void> {
    await this.setTerminal(analysisId, "failed", error);
  }

  async interrupt(analysisId: string, error: string): Promise<void> {
    await this.setTerminal(analysisId, "interrupted", error);
  }

  private async setTerminal(analysisId: string, status: "failed" | "interrupted", error: string): Promise<void> {
    const current = await this.requireSummary(analysisId);
    const now = new Date().toISOString();
    await this.writeSummary({
      ...current,
      status,
      updatedAt: now,
      completedAt: now,
      error,
    });
  }

  async getSummary(analysisId: string): Promise<PersistedAnalysisSummary | null> {
    const file = this.stateFile(analysisId);
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
      if (!isSummary(parsed) || parsed.analysisId !== analysisId) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async getReport(analysisId: string): Promise<AnalysisReport | null> {
    const file = this.reportFile(analysisId);
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as AnalysisReport;
    } catch {
      return null;
    }
  }

  async list(limit = MAX_HISTORY): Promise<PersistedAnalysisSummary[]> {
    const capped = Math.min(MAX_HISTORY, Math.max(0, Math.trunc(limit)));
    if (capped === 0) return [];
    const runsRoot = path.join(this.projectRoot, ".futureproof", "runs");
    let entries;
    try {
      entries = await fs.readdir(runsRoot, { withFileTypes: true });
    } catch {
      return [];
    }

    const summaries = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map(async (entry) => {
        try {
          return await this.getSummary(entry.name);
        } catch {
          return null;
        }
      }));

    return summaries
      .filter((summary): summary is PersistedAnalysisSummary => summary !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, capped);
  }

  private async requireSummary(analysisId: string): Promise<PersistedAnalysisSummary> {
    const current = await this.getSummary(analysisId);
    if (!current) throw new Error(`analysis state not found: ${analysisId}`);
    return current;
  }
}
