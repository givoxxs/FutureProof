import type { LlmClient, ModelConfig } from "./llm-client.ts";

export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";

export type RealModelSmokeConfig =
  | { enabled: false; reason: string }
  | { enabled: true; config: ModelConfig };

export function resolveRealModelSmokeConfig(env: Record<string, string | undefined>): RealModelSmokeConfig {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  const required = env.REQUIRE_REAL_MODEL === "1";

  if (!apiKey) {
    if (required) throw new Error("OPENROUTER_API_KEY is required for the real-model smoke test");
    return { enabled: false, reason: "OPENROUTER_API_KEY is required" };
  }

  const model = env.OPENROUTER_MODEL?.trim() || OPENROUTER_DEFAULT_MODEL;
  const baseUrl = (env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
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
    system: "You are validating an OpenRouter-compatible JSON completion path for FutureProof. Follow the requested JSON contract exactly.",
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
