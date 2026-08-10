import test from "node:test";
import assert from "node:assert/strict";
import { resolveRealModelSmokeConfig, runRealModelSmoke } from "../../packages/engine/src/real-model-smoke.ts";

test("real-model smoke config requires key and model when enforcement is enabled", () => {
  assert.throws(() => resolveRealModelSmokeConfig({ REQUIRE_REAL_MODEL: "1" }), /OPENAI_API_KEY/);
  assert.throws(() => resolveRealModelSmokeConfig({ REQUIRE_REAL_MODEL: "1", OPENAI_API_KEY: "secret" }), /OPENAI_MODEL/);
});

test("real-model smoke can skip locally when credentials are absent", () => {
  assert.deepEqual(resolveRealModelSmokeConfig({}), { enabled: false, reason: "OPENAI_API_KEY and OPENAI_MODEL are required" });
});

test("real-model smoke normalizes an OpenAI-compatible configuration", () => {
  assert.deepEqual(resolveRealModelSmokeConfig({
    OPENAI_API_KEY: "secret",
    OPENAI_MODEL: "model-x",
    OPENAI_BASE_URL: "https://example.test/v1/",
  }), {
    enabled: true,
    config: { apiKey: "secret", model: "model-x", baseUrl: "https://example.test/v1" },
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
    model: "model-x",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.model, "model-x");
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
    model: "model-x",
  }), /unexpected smoke response/);
});
