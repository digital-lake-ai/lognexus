export type MessageRole = "system" | "user" | "assistant";

export interface LLMMessage {
  role: MessageRole;
  content: string;
}

export interface GenerateRequest {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  text: string;
  usage?: TokenUsage;
  model: string;
  provider: string;
  raw?: unknown;
}

export interface ProviderHealth {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export interface LLMProvider {
  readonly id: string;
  generate(req: GenerateRequest): Promise<LLMResponse>;
  healthCheck(): Promise<ProviderHealth>;
}
