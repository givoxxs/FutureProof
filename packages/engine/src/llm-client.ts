import type { AgentToolName } from "@futureproof/core";

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface LlmClient {
  completeJson<T>(args: {
    system: string;
    user: string;
    schemaName: string;
  }): Promise<{ value: T; inputTokens: number; outputTokens: number }>;
}

export interface ToolDefinition {
  name: AgentToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallingLlmClient extends LlmClient {
  nextToolTurn(args: {
    system: string;
    messages: Array<Record<string, unknown>>;
    tools: ToolDefinition[];
  }): Promise<{
    assistantMessage: Record<string, unknown>;
    toolCalls: Array<{ id: string; name: AgentToolName; arguments: Record<string, unknown> }>;
    inputTokens: number;
    outputTokens: number;
  }>;
}

interface ClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface OpenAiResponse {
  choices?: Array<{ message?: Record<string, unknown> }>;
  usage?: OpenAiUsage;
}

export class OpenAiCompatibleClient implements ToolCallingLlmClient {
  private readonly config: ModelConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: ModelConfig, options: ClientOptions = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private endpoint(): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  private async post(body: Record<string, unknown>): Promise<OpenAiResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`LLM request failed with ${response.status}: ${detail}`);
      }
      return await response.json() as OpenAiResponse;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`LLM request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async completeJson<T>(args: { system: string; user: string; schemaName: string }): Promise<{ value: T; inputTokens: number; outputTokens: number }> {
    const payload = await this.post({
      model: this.config.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${args.system}\nReturn valid JSON for schema: ${args.schemaName}.` },
        { role: "user", content: args.user },
      ],
    });
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("LLM response did not contain assistant JSON content");
    try {
      return {
        value: JSON.parse(content) as T,
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
      };
    } catch {
      throw new Error("LLM assistant content was not valid JSON");
    }
  }

  async nextToolTurn(args: {
    system: string;
    messages: Array<Record<string, unknown>>;
    tools: ToolDefinition[];
  }): Promise<{
    assistantMessage: Record<string, unknown>;
    toolCalls: Array<{ id: string; name: AgentToolName; arguments: Record<string, unknown> }>;
    inputTokens: number;
    outputTokens: number;
  }> {
    const payload = await this.post({
      model: this.config.model,
      temperature: 0,
      messages: [{ role: "system", content: args.system }, ...args.messages],
      tools: args.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      })),
    });
    const assistantMessage = payload.choices?.[0]?.message ?? {};
    const rawCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
    const toolCalls = rawCalls.map((raw) => {
      const call = raw as Record<string, unknown>;
      const fn = call.function as Record<string, unknown> | undefined;
      const name = fn?.name;
      if (typeof call.id !== "string" || typeof name !== "string" || typeof fn?.arguments !== "string") {
        throw new Error("malformed tool call returned by LLM");
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(fn.arguments) as Record<string, unknown>;
      } catch {
        throw new Error(`tool call ${name} contained invalid JSON arguments`);
      }
      return { id: call.id, name: name as AgentToolName, arguments: parsed };
    });
    return {
      assistantMessage,
      toolCalls,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    };
  }
}
