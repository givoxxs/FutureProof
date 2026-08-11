import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiCompatibleClient } from "../../packages/engine/src/llm-client.ts";

test("sends bearer auth to chat completions and accounts tokens", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (url, init) => {
    seenUrl = String(url);
    seenInit = init;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ answer: 42 }) } }],
      usage: { prompt_tokens: 11, completion_tokens: 4 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const client = new OpenAiCompatibleClient(
    { baseUrl: "https://llm.example/v1/", apiKey: "secret", model: "test-model" },
    { fetchImpl: fakeFetch, timeoutMs: 1000 },
  );
  const result = await client.completeJson<{ answer: number }>({ system: "system", user: "user", schemaName: "Answer" });

  assert.equal(seenUrl, "https://llm.example/v1/chat/completions");
  assert.equal((seenInit?.headers as Record<string, string>).Authorization, "Bearer secret");
  assert.equal(result.value.answer, 42);
  assert.equal(result.inputTokens, 11);
  assert.equal(result.outputTokens, 4);
});

test("throws a useful error on non-2xx responses", async () => {
  const fakeFetch: typeof fetch = async () => new Response("rate limited", { status: 429 });
  const client = new OpenAiCompatibleClient(
    { baseUrl: "https://llm.example/v1", apiKey: "secret", model: "test-model" },
    { fetchImpl: fakeFetch, timeoutMs: 1000 },
  );
  await assert.rejects(
    () => client.completeJson({ system: "s", user: "u", schemaName: "X" }),
    /429.*rate limited/i,
  );
});

test("rejects malformed assistant JSON", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: "not-json" } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new OpenAiCompatibleClient(
    { baseUrl: "https://llm.example/v1", apiKey: "secret", model: "test-model" },
    { fetchImpl: fakeFetch, timeoutMs: 1000 },
  );
  await assert.rejects(
    () => client.completeJson({ system: "s", user: "u", schemaName: "X" }),
    /valid JSON/i,
  );
});

test("aborts requests that exceed the configured timeout", async () => {
  const fakeFetch: typeof fetch = async (_url, init) => await new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  const client = new OpenAiCompatibleClient(
    { baseUrl: "https://llm.example/v1", apiKey: "secret", model: "test-model" },
    { fetchImpl: fakeFetch, timeoutMs: 5 },
  );
  await assert.rejects(
    () => client.completeJson({ system: "s", user: "u", schemaName: "X" }),
    /timed out/i,
  );
});
