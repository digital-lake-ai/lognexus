import type { LogNexusConfig, ProviderType } from "../config/loadConfig.js";
import { DeepSeekProvider } from "./deepseek.js";
import { GeminiProvider } from "./gemini.js";
import type { LLMProvider } from "./types.js";

export function createProvider(type: ProviderType, config: LogNexusConfig): LLMProvider {
  switch (type) {
    case "gemini":
      return new GeminiProvider({
        apiKey: config.gemini.apiKey,
        model: config.gemini.model,
        apiBaseUrl: config.gemini.apiBaseUrl,
      });
    case "deepseek":
      return new DeepSeekProvider({
        apiKey: config.deepseek.apiKey,
        model: config.deepseek.model,
        apiBaseUrl: config.deepseek.apiBaseUrl,
      });
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unsupported provider: ${exhaustiveCheck}`);
    }
  }
}
