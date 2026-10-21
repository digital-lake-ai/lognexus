import type { GenerateRequest, LLMProvider, LLMResponse, ProviderHealth } from "./types.js";

export interface OpenAICompatibleOptions {
  id?: string;
  apiKey?: string;
  model: string;
  apiBaseUrl: string;
}

export class OpenAICompatibleProvider implements LLMProvider {
  public readonly id: string;
  protected apiKey?: string;
  protected defaultModel: string;
  protected apiBaseUrl: string;

  constructor(options: OpenAICompatibleOptions) {
    this.id = options.id || "openai-compatible";
    this.apiKey = options.apiKey;
    this.defaultModel = options.model;
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "");
  }

  public async generate(req: GenerateRequest): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error(
        `API key is required for provider "${this.id}". Set appropriate environment variable or .lognexus/config.json`,
      );
    }

    const model = req.model || this.defaultModel;
    const url = `${this.apiBaseUrl}/chat/completions`;

    const payload: Record<string, unknown> = {
      model,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    if (req.temperature !== undefined) {
      payload.temperature = req.temperature;
    }

    if (req.maxTokens !== undefined) {
      payload.max_tokens = req.maxTokens;
    }

    if (req.responseFormat === "json") {
      payload.response_format = { type: "json_object" };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let errorDetails = `HTTP ${res.status} ${res.statusText}`;
      try {
        const errorJson = (await res.json()) as { error?: { message?: string } };
        if (errorJson.error?.message) {
          errorDetails = errorJson.error.message;
        }
      } catch {
        // Fallback
      }
      throw new Error(`${this.id} API Error: ${errorDetails}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const text = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        }
      : undefined;

    return {
      text,
      usage,
      model,
      provider: this.id,
      raw: data,
    };
  }

  public async healthCheck(): Promise<ProviderHealth> {
    if (!this.apiKey) {
      return {
        ok: false,
        message: `Missing API key for provider "${this.id}"`,
      };
    }

    const start = Date.now();
    try {
      await this.generate({
        messages: [{ role: "user", content: "Ping" }],
        maxTokens: 1,
      });
      return {
        ok: true,
        message: `Connected successfully to ${this.id} (${this.defaultModel})`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
