import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { analysisArtifactDir } from "@futureproof/core/paths";
import { writeJson } from "@futureproof/core/artifacts";
import type { AnalysisReport } from "../../../packages/engine/src/compare.ts";
import { ProgressBus, type ProgressEvent } from "./progress-bus.ts";

export type AnalysisState =
  | { status: "running"; analysisId: string }
  | { status: "completed"; analysisId: string; report: AnalysisReport }
  | { status: "failed"; analysisId: string; error: string };

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

export function registerAnalysisRoutes(server: FastifyInstance, options: AnalysisRouteOptions) {
  const states = new Map<string, AnalysisState>();
  const bus = options.bus ?? new ProgressBus();

  server.post("/api/analyses/demo", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    if (body && Object.keys(body).length > 0) return reply.code(400).send({ error: "demo request does not accept filesystem paths or overrides" });
    const analysisId = options.idFactory();
    states.set(analysisId, { status: "running", analysisId });
    const emit = (event: ProgressEvent) => bus.publish({ ...event, analysisId });

    void Promise.resolve().then(async () => {
      try {
        const report = await options.runDemo({ analysisId, emit });
        const reportFile = path.join(analysisArtifactDir(options.projectRoot, analysisId), "report.json");
        await writeJson(reportFile, report);
        states.set(analysisId, { status: "completed", analysisId, report });
        if (!bus.events(analysisId).some((event) => event.type === "analysis_completed")) {
          emit({ type: "analysis_completed", analysisId });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        states.set(analysisId, { status: "failed", analysisId, error: message });
        bus.publish({ type: "analysis_failed", analysisId, detail: { error: message } });
      }
    });

    return reply.code(202).send({ analysisId });
  });

  server.get<{ Params: { analysisId: string } }>("/api/analyses/:analysisId", async (request, reply) => {
    const state = states.get(request.params.analysisId);
    if (!state) return reply.code(404).send({ error: "analysis not found" });
    return state;
  });

  server.get<{ Params: { analysisId: string; scenarioId: string } }>("/api/analyses/:analysisId/scenarios/:scenarioId", async (request, reply) => {
    const state = states.get(request.params.analysisId);
    if (!state) return reply.code(404).send({ error: "analysis not found" });
    if (state.status !== "completed") return reply.code(409).send({ error: `analysis is ${state.status}` });
    const payload = scenarioPayload(state.report, request.params.scenarioId);
    if (!payload) return reply.code(404).send({ error: "scenario not found" });
    return payload;
  });

  server.get<{
    Params: { analysisId: string; scenarioId: string; candidateId: string; trial: string; kind: string };
  }>("/api/analyses/:analysisId/scenarios/:scenarioId/candidates/:candidateId/trials/:trial/artifacts/:kind", async (request, reply) => {
    const { analysisId, scenarioId, candidateId, trial: rawTrial, kind } = request.params;
    const state = states.get(analysisId);
    if (!state) return reply.code(404).send({ error: "analysis not found" });
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
    const state = states.get(analysisId);
    if (!state) return reply.code(404).send({ error: "analysis not found" });

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

  return { states, bus };
}
