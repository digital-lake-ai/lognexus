import { type OpenAICompatibleOptions, OpenAICompatibleProvider } from "./openaiCompatible.js";

export interface DeepSeekProviderOptions {
  apiKey?: string;
  model?: string;
  apiBaseUrl?: string;
}

export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(options: DeepSeekProviderOptions = {}) {
    const opts: OpenAICompatibleOptions = {
      id: "deepseek",
      apiKey: options.apiKey,
      model: options.model || "deepseek-chat",
      apiBaseUrl: options.apiBaseUrl || "https://api.deepseek.com",
    };
    super(opts);
  }
}
