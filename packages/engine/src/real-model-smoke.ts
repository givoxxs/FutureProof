import type { LlmClient, ModelConfig } from "./llm-client.ts";

export type RealModelSmokeConfig =
  | { enabled: false; reason: string }
  | { enabled: true; config: ModelConfig };

export function resolveRealModelSmokeConfig(env: Record<string, string | undefined>): RealModelSmokeConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim();
  const required = env.REQUIRE_REAL_MODEL === "1";

  if (!apiKey) {
    if (required) throw new Error("OPENAI_API_KEY is required for the real-model smoke test");
    return { enabled: false, reason: "OPENAI_API_KEY and OPENAI_MODEL are required" };
  }
  if (!model) {
    if (required) throw new Error("OPENAI_MODEL is required for the real-model smoke test");
    return { enabled: false, reason: "OPENAI_API_KEY and OPENAI_MODEL are required" };
  }

  const baseUrl = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  return { enabled: true, config: { apiKey, model, baseUrl } };
}

export interface RealModelSmokeResult {
  status: "ok";
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function runRealModelSmoke(args: { client: LlmClient; model: string }): Promise<RealModelSmokeResult> {
  const completion = await args.client.completeJson<{ status?: unknown }>({
    system: "You are validating an OpenAI-compatible JSON completion path for FutureProof. Follow the requested JSON contract exactly.",
    user: "Return a JSON object whose status field is the string ok.",
    schemaName: '{"status":"ok"}',
  });

  if (completion.value?.status !== "ok") {
    throw new Error(`unexpected smoke response: ${JSON.stringify(completion.value)}`);
  }

  return {
    status: "ok",
    model: args.model,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
  };
}
