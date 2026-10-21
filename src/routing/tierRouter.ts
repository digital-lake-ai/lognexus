import type { LogNexusConfig } from "../config/loadConfig.js";
import { createProvider } from "../providers/factory.js";
import type { LLMProvider } from "../providers/types.js";

export type OperationTier = "tier-1" | "tier-2" | "tier-3";

export interface TierAssignment {
  tier: OperationTier;
  provider: LLMProvider;
  model: string;
  description: string;
}

export function resolveTier(tier: OperationTier, config: LogNexusConfig): TierAssignment {
  switch (tier) {
    case "tier-1": {
      // Tier 1 (Reasoning): Gemini Pro/Flash High or DeepSeek Reasoner
      if (config.provider === "deepseek") {
        return {
          tier,
          provider: createProvider("deepseek", config),
          model: "deepseek-reasoner",
          description: "High-reasoning architecture & review (DeepSeek Reasoner)",
        };
      }
      return {
        tier,
        provider: createProvider("gemini", config),
        model: config.gemini.model,
        description: `High-reasoning architecture & review (Gemini: ${config.gemini.model})`,
      };
    }
    case "tier-2": {
      // Tier 2 (Context): Ingestion, discovery, knowledge
      return {
        tier,
        provider: createProvider("gemini", config),
        model: config.gemini.model,
        description: `Long-context codebase exploration & triage (Gemini: ${config.gemini.model})`,
      };
    }
    case "tier-3": {
      // Tier 3 (Execution): DeepSeek Chat (or configured background provider)
      const providerType = config.deepseek.apiKey ? "deepseek" : config.provider;
      return {
        tier,
        provider: createProvider(providerType, config),
        model: providerType === "deepseek" ? config.deepseek.model : config.gemini.model,
        description: `Fast execution under closed delegation contract (${providerType})`,
      };
    }
  }
}
