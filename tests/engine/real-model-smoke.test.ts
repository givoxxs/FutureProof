import test from "node:test";
import assert from "node:assert/strict";
import { resolveRealModelSmokeConfig, runRealModelSmoke } from "../../packages/engine/src/real-model-smoke.ts";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";

test("real-model smoke requires an OpenRouter key when enforcement is enabled", () => {
  assert.throws(() => resolveRealModelSmokeConfig({ REQUIRE_REAL_MODEL: "1" }), /OPENROUTER_API_KEY/);
});

test("real-model smoke can skip locally when OpenRouter credentials are absent", () => {
  assert.deepEqual(resolveRealModelSmokeConfig({}), { enabled: false, reason: "OPENROUTER_API_KEY is required" });
});

test("real-model smoke defaults to the selected DeepSeek model and OpenRouter base URL", () => {
  assert.deepEqual(resolveRealModelSmokeConfig({
    OPENROUTER_API_KEY: "sk-or-test",
  }), {
    enabled: true,
    config: { apiKey: "sk-or-test", model: DEFAULT_MODEL, baseUrl: OPENROUTER_BASE_URL },
  });
});

test("real-model smoke allows switching to GPT-5.6 Luna Pro with only OPENROUTER_MODEL", () => {
  assert.deepEqual(resolveRealModelSmokeConfig({
    OPENROUTER_API_KEY: "sk-or-test",
    OPENROUTER_MODEL: "openai/gpt-5.6-luna-pro",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1/",
  }), {
    enabled: true,
    config: { apiKey: "sk-or-test", model: "openai/gpt-5.6-luna-pro", baseUrl: OPENROUTER_BASE_URL },
  });
});

test("real-model smoke verifies a live JSON completion contract through an injected client", async () => {
  const calls: unknown[] = [];
  const result = await runRealModelSmoke({
    client: {
      async completeJson(args: unknown) {
        calls.push(args);
        return { value: { status: "ok" }, inputTokens: 12, outputTokens: 3 };
      },
    } as any,
    model: DEFAULT_MODEL,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.model, DEFAULT_MODEL);
  assert.equal(result.inputTokens, 12);
  assert.equal(result.outputTokens, 3);
  assert.equal(calls.length, 1);
});

test("real-model smoke rejects a semantically wrong model response", async () => {
  await assert.rejects(() => runRealModelSmoke({
    client: {
      async completeJson() {
        return { value: { status: "maybe" }, inputTokens: 1, outputTokens: 1 };
      },
    } as any,
    model: DEFAULT_MODEL,
  }), /unexpected smoke response/);
});
