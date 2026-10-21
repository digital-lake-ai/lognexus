import type {
  GenerateRequest,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  ProviderHealth,
} from "./types.js";

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  apiBaseUrl?: string;
}

export class GeminiProvider implements LLMProvider {
  public readonly id = "gemini";
  private apiKey?: string;
  private defaultModel: string;
  private apiBaseUrl: string;

  constructor(options: GeminiProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.defaultModel = options.model || "gemini-3.8-flash";
    this.apiBaseUrl = options.apiBaseUrl || "https://generativelanguage.googleapis.com/v1beta";
  }

  private mapRole(role: LLMMessage["role"]): "user" | "model" {
    return role === "assistant" ? "model" : "user";
  }

  public async generate(req: GenerateRequest): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error(
        "Gemini API key is required. Set GEMINI_API_KEY in your environment or .lognexus/config.json",
      );
    }

    const model = req.model || this.defaultModel;
    const url = `${this.apiBaseUrl}/models/${encodeURIComponent(model)}:generateContent`;

    const systemMessages = req.messages.filter((m) => m.role === "system");
    const nonSystemMessages = req.messages.filter((m) => m.role !== "system");

    const contents = nonSystemMessages.map((msg) => ({
      role: this.mapRole(msg.role),
      parts: [{ text: msg.content }],
    }));

    const payload: Record<string, unknown> = {
      contents,
    };

    if (systemMessages.length > 0) {
      payload.systemInstruction = {
        parts: [{ text: systemMessages.map((m) => m.content).join("\n\n") }],
      };
    }

    if (req.temperature !== undefined || req.maxTokens !== undefined) {
      payload.generationConfig = {
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
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
        // Fallback to status text
      }
      throw new Error(`Gemini API Error: ${errorDetails}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const usage = data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount ?? 0,
          completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: data.usageMetadata.totalTokenCount ?? 0,
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
        message: "Missing GEMINI_API_KEY in environment or configuration",
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
        message: `Connected successfully to Gemini (${this.defaultModel})`,
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
