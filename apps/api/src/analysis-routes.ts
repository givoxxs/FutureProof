import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { analysisArtifactDir } from "@futureproof/core/paths";
import { writeJson } from "@futureproof/core/artifacts";
import type { AnalysisReport } from "../../../packages/engine/src/compare.ts";
import { writeReportBundle } from "../../../packages/engine/src/report-export.ts";
import { AnalysisRepository, type RuntimeMetadata } from "./analysis-repository.ts";
import { ProgressBus, type ProgressEvent } from "./progress-bus.ts";

export type AnalysisState =
  | { status: "running"; analysisId: string }
  | { status: "completed"; analysisId: string; report: AnalysisReport }
  | { status: "failed"; analysisId: string; error: string }
  | { status: "interrupted"; analysisId: string; error: string };

type HydratedAnalysisState = AnalysisState | { status: "unavailable"; analysisId: string; error: string };

export type DemoAnalysisRunner = (args: {
  analysisId: string;
  emit: (event: ProgressEvent) => void;
}) => Promise<AnalysisReport>;

export interface AnalysisRouteOptions {
  projectRoot: string;
  runDemo: DemoAnalysisRunner;
  idFactory: () => string;
  bus?: ProgressBus;
}

const EXPORTS = {
  "report.json": { filename: "report.json", contentType: "application/json; charset=utf-8" },
  "report.md": { filename: "report.md", contentType: "text/markdown; charset=utf-8" },
  "manifest.json": { filename: "manifest.json", contentType: "application/json; charset=utf-8" },
} as const;

const INTERRUPTED_MESSAGE = "Analysis interrupted by API restart; execution was not resumed.";
const REPORT_UNAVAILABLE_MESSAGE = "Completed analysis report is unavailable on disk.";

type ExportName = keyof typeof EXPORTS;

function sendSse(reply: FastifyReply, events: ProgressEvent[]): void {
  reply.header("content-type", "text/event-stream; charset=utf-8");
  reply.header("cache-control", "no-cache");
  reply.header("connection", "keep-alive");
  reply.send(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
}

function publicRun(run: any) {
  const { patchPath: _patchPath, artifactDir: _artifactDir, ...safe } = run;
  return safe;
}

function publicReport(report: AnalysisReport) {
  return {
    ...report,
    candidates: {
      A: { ...report.candidates.A, scenarioRuns: report.candidates.A.scenarioRuns.map(publicRun) },
      B: { ...report.candidates.B, scenarioRuns: report.candidates.B.scenarioRuns.map(publicRun) },
    },
  };
}

function scenarioPayload(report: AnalysisReport, scenarioId: string) {
  const scenario = report.scenarios.find((item) => item.id === scenarioId);
  if (!scenario) return null;
  const findAggregate = (candidateId: "A" | "B") => report.candidates[candidateId].aggregatedScenarios.find((item) => item.scenarioId === scenarioId);
  const aggregateA = findAggregate("A");
  const aggregateB = findAggregate("B");
  if (!aggregateA || !aggregateB) return null;
  return {
    scenario,
    candidates: { A: aggregateA, B: aggregateB },
    rawRuns: {
      A: report.candidates.A.scenarioRuns.filter((run) => run.scenarioId === scenarioId).map(publicRun),
      B: report.candidates.B.scenarioRuns.filter((run) => run.scenarioId === scenarioId).map(publicRun),
    },
  };
}

function safeArtifactPath(projectRoot: string, analysisId: string, candidateId: "A" | "B", scenarioId: string, trial: number, kind: "patch" | "events"): string {
  const analysisRoot = path.resolve(analysisArtifactDir(projectRoot, analysisId));
  const filename = kind === "patch" ? "patch.diff" : "tool-events.jsonl";
  const file = path.resolve(analysisRoot, candidateId, scenarioId, `trial-${trial}`, filename);
  if (!file.startsWith(`${analysisRoot}${path.sep}`)) throw new Error("artifact path escaped analysis root");
  return file;
}

function exportFilePath(projectRoot: string, analysisId: string, name: ExportName): string {
  return path.join(analysisArtifactDir(projectRoot, analysisId), "exports", EXPORTS[name].filename);
}

function runtimeFromEvent(event: ProgressEvent): RuntimeMetadata {
  if (event.type !== "analysis_started" || !event.detail) return {};
  const runtime: RuntimeMetadata = {};
  if (typeof event.detail.provider === "string") runtime.provider = event.detail.provider;
  if (typeof event.detail.model === "string") runtime.model = event.detail.model;
  if (typeof event.detail.concurrency === "number" && Number.isInteger(event.detail.concurrency)) runtime.concurrency = event.detail.concurrency;
  if (typeof event.detail.requestTimeoutMs === "number" && Number.isFinite(event.detail.requestTimeoutMs)) runtime.requestTimeoutMs = event.detail.requestTimeoutMs;
  return runtime;
}

function hasRuntime(runtime: RuntimeMetadata): boolean {
  return runtime.provider !== undefined
    || runtime.model !== undefined
    || runtime.concurrency !== undefined
    || runtime.requestTimeoutMs !== undefined;
}

export function registerAnalysisRoutes(server: FastifyInstance, options: AnalysisRouteOptions) {
  const states = new Map<string, AnalysisState>();
  const bus = options.bus ?? new ProgressBus();
  const repository = new AnalysisRepository(options.projectRoot);

  async function hydrateState(analysisId: string): Promise<HydratedAnalysisState | null> {
    const current = states.get(analysisId);
    if (current) return current;

    const summary = await repository.getSummary(analysisId);
    if (!summary) return null;

    if (summary.status === "running") {
      await repository.interrupt(analysisId, INTERRUPTED_MESSAGE);
      return { status: "interrupted", analysisId, error: INTERRUPTED_MESSAGE };
    }

    if (summary.status === "completed") {
      const report = await repository.getReport(analysisId);
      if (!report) return { status: "unavailable", analysisId, error: REPORT_UNAVAILABLE_MESSAGE };
      return { status: "completed", analysisId, report };
    }

    return { status: summary.status, analysisId, error: summary.error ?? (summary.status === "interrupted" ? INTERRUPTED_MESSAGE : "Analysis failed.") };
  }

  async function completedState(analysisId: string): Promise<Extract<AnalysisState, { status: "completed" }> | HydratedAnalysisState | null> {
    return await hydrateState(analysisId);
  }

  server.post("/api/analyses/demo", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    if (body && Object.keys(body).length > 0) return reply.code(400).send({ error: "demo request does not accept filesystem paths or overrides" });
    const analysisId = options.idFactory();
    await repository.createRunning(analysisId);
    states.set(analysisId, { status: "running", analysisId });
    let runtime: RuntimeMetadata = {};
    let runtimePersistence: Promise<void> = Promise.resolve();
    const enqueueRuntimePersistence = () => {
      if (!hasRuntime(runtime)) return;
      const snapshot = { ...runtime };
      runtimePersistence = runtimePersistence
        .then(async () => await repository.patchRuntime(analysisId, snapshot))
        .catch(() => undefined);
    };
    const emit = (event: ProgressEvent) => {
      if (event.type === "analysis_started") {
        runtime = { ...runtime, ...runtimeFromEvent(event) };
        enqueueRuntimePersistence();
      }
      bus.publish({ ...event, analysisId });
    };

    void Promise.resolve().then(async () => {
      try {
        const report = await options.runDemo({ analysisId, emit });
        const reportFile = path.join(analysisArtifactDir(options.projectRoot, analysisId), "report.json");
        await writeJson(reportFile, report);
        await writeReportBundle(options.projectRoot, report);
        await runtimePersistence;
        if (hasRuntime(runtime)) await repository.patchRuntime(analysisId, runtime);
        await repository.complete(analysisId, report);
        states.set(analysisId, { status: "completed", analysisId, report });
        if (!bus.events(analysisId).some((event) => event.type === "analysis_completed")) {
          emit({ type: "analysis_completed", analysisId });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await runtimePersistence;
        try {
          if (hasRuntime(runtime)) await repository.patchRuntime(analysisId, runtime);
        } catch {
          // Runtime metadata is useful but must not prevent the terminal state from being persisted.
        }
        try {
          await repository.fail(analysisId, message);
        } catch {
          // Preserve the original execution error in API state even if persistence also fails.
        }
        states.set(analysisId, { status: "failed", analysisId, error: message });
        bus.publish({ type: "analysis_failed", analysisId, detail: { error: message } });
      }
    });

    return reply.code(202).send({ analysisId });
  });

  server.get("/api/analyses", async () => {
    const summaries = await repository.list(50);
    const analyses = await Promise.all(summaries.map(async (summary) => {
      if (summary.status !== "running" || states.has(summary.analysisId)) return summary;
      await repository.interrupt(summary.analysisId, INTERRUPTED_MESSAGE);
      return await repository.getSummary(summary.analysisId) ?? { ...summary, status: "interrupted" as const, error: INTERRUPTED_MESSAGE };
    }));
    return { analyses };
  });

  server.get<{ Params: { analysisId: string } }>("/api/analyses/:analysisId", async (request, reply) => {
    const state = await hydrateState(request.params.analysisId);
    if (!state) return reply.code(404).send({ error: "analysis not found" });
    if (state.status === "unavailable") return reply.code(409).send({ error: state.error });
    if (state.status === "completed") return { ...state, report: publicReport(state.report) };
    return state;
  });

  server.get<{ Params: { analysisId: string; scenarioId: string } }>("/api/analyses/:analysisId/scenarios/:scenarioId", async (request, reply) => {
    const state = await completedState(request.params.analysisId);
    if (!state) return reply.code(404).send({ error: "analysis not found" });
    if (state.status === "unavailable") return reply.code(409).send({ error: state.error });
    if (state.status !== "completed") return reply.code(409).send({ error: `analysis is ${state.status}` });
    const payload = scenarioPayload(state.report, request.params.scenarioId);
    if (!payload) return reply.code(404).send({ error: "scenario not found" });
    return payload;
  });

  server.get<{ Params: { analysisId: string; exportName: string } }>("/api/analyses/:analysisId/exports/:exportName", async (request, reply) => {
    const state = await completedState(request.params.analysisId);
    if (!state) return reply.code(404).send({ error: "analysis not found" });
    if (state.status === "unavailable") return reply.code(409).send({ error: state.error });
    if (state.status !== "completed") return reply.code(409).send({ error: `analysis is ${state.status}` });
    if (!(request.params.exportName in EXPORTS)) return reply.code(404).send({ error: "export not found" });

    const name = request.params.exportName as ExportName;
    try {
      const content = await fs.readFile(exportFilePath(options.projectRoot, request.params.analysisId, name), "utf8");
      return reply.type(EXPORTS[name].contentType).send(content);
    } catch {
      return reply.code(404).send({ error: "export not found" });
    }
  });

  server.get<{
    Params: { analysisId: string; scenarioId: string; candidateId: string; trial: string; kind: string };
  }>("/api/analyses/:analysisId/scenarios/:scenarioId/candidates/:candidateId/trials/:trial/artifacts/:kind", async (request, reply) => {
    const { analysisId, scenarioId, candidateId, trial: rawTrial, kind } = request.params;
    const state = await completedState(analysisId);
    if (!state) return reply.code(404).send({ error: "analysis not found" });
    if (state.status === "unavailable") return reply.code(409).send({ error: state.error });
    if (state.status !== "completed") return reply.code(409).send({ error: `analysis is ${state.status}` });
    if ((candidateId !== "A" && candidateId !== "B") || (kind !== "patch" && kind !== "events")) return reply.code(404).send({ error: "artifact not found" });
    const trial = Number(rawTrial);
    if (!Number.isInteger(trial) || trial < 1) return reply.code(404).send({ error: "artifact not found" });
    const candidate = state.report.candidates[candidateId];
    const run = candidate.scenarioRuns.find((item) => item.scenarioId === scenarioId && item.trial === trial);
    if (!run) return reply.code(404).send({ error: "artifact not found" });

    try {
      const file = safeArtifactPath(options.projectRoot, analysisId, candidateId, scenarioId, trial, kind);
      const content = await fs.readFile(file, "utf8");
      return reply.type("text/plain; charset=utf-8").send(content);
    } catch {
      return reply.code(404).send({ error: "artifact not found" });
    }
  });

  server.get<{ Params: { analysisId: string } }>("/api/analyses/:analysisId/events", async (request, reply) => {
    const analysisId = request.params.analysisId;
    const state = await hydrateState(analysisId);
    if (!state) return reply.code(404).send({ error: "analysis not found" });
    if (state.status === "unavailable") return reply.code(409).send({ error: state.error });

    const history = bus.events(analysisId);
    if (state.status !== "running") {
      const terminal = state.status === "completed"
        ? { type: "analysis_completed", analysisId } as const
        : { type: "analysis_failed", analysisId, detail: { error: state.error } } as const;
      if (!history.some((event) => event.type === terminal.type)) history.push(terminal);
      sendSse(reply, history);
      return;
    }

    reply.hijack();
    const raw = reply.raw;
    raw.statusCode = 200;
    raw.setHeader("content-type", "text/event-stream; charset=utf-8");
    raw.setHeader("cache-control", "no-cache");
    raw.setHeader("connection", "keep-alive");
    for (const event of history) raw.write(`data: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = bus.subscribe(analysisId, (event) => {
      if (raw.destroyed || raw.writableEnded) return;
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "analysis_completed" || event.type === "analysis_failed") {
        unsubscribe();
        raw.end();
      }
    });
    raw.on("close", unsubscribe);
  });

  return { states, bus, repository };
}
