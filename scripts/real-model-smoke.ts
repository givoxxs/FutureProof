import { OpenAiCompatibleClient } from "../packages/engine/src/llm-client.ts";
import { resolveRealModelSmokeConfig, runRealModelSmoke } from "../packages/engine/src/real-model-smoke.ts";

const resolved = resolveRealModelSmokeConfig(process.env);
if (!resolved.enabled) {
  console.log(`SKIPPED: ${resolved.reason}`);
  process.exit(0);
}

const client = new OpenAiCompatibleClient(resolved.config, { timeoutMs: 30_000 });
const result = await runRealModelSmoke({ client, model: resolved.config.model });
console.log(JSON.stringify(result));
