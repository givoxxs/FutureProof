import test from "node:test";
import assert from "node:assert/strict";

test("live analysis gives OpenRouter requests a 90s default timeout and supports an env override", async () => {
  const serverModule = await import("../../apps/api/src/server.ts") as Record<string, unknown>;
  const resolver = serverModule.resolveLiveLlmRequestTimeoutMs;

  assert.equal(typeof resolver, "function");
  if (typeof resolver !== "function") return;

  const resolveTimeout = resolver as (env: Record<string, string | undefined>) => number;
  assert.equal(resolveTimeout({}), 90_000);
  assert.equal(resolveTimeout({ OPENROUTER_REQUEST_TIMEOUT_MS: "120000" }), 120_000);
  assert.throws(
    () => resolveTimeout({ OPENROUTER_REQUEST_TIMEOUT_MS: "not-a-number" }),
    /OPENROUTER_REQUEST_TIMEOUT_MS/i,
  );
});
