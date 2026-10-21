import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loadConfig.js";
import { createProvider } from "../src/providers/factory.js";
import { resolveTier } from "../src/routing/tierRouter.js";

describe("Factory & Tier Router", () => {
  it("should create Gemini provider instance when provider is gemini", () => {
    const config = loadConfig(undefined, {
      LOGNEXUS_PROVIDER: "gemini",
      GEMINI_API_KEY: "test-gemini-key",
      GEMINI_MODEL: "gemini-3.8-flash",
    });
    const provider = createProvider("gemini", config);
    expect(provider.id).toBe("gemini");
  });

  it("should create DeepSeek provider instance when provider is deepseek", () => {
    const config = loadConfig(undefined, {
      LOGNEXUS_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "test-deepseek-key",
      DEEPSEEK_MODEL: "deepseek-chat",
    });
    const provider = createProvider("deepseek", config);
    expect(provider.id).toBe("deepseek");
  });

  it("should route tier-1 to Gemini when Gemini is default", () => {
    const config = loadConfig(undefined, {
      LOGNEXUS_PROVIDER: "gemini",
      GEMINI_API_KEY: "key",
      GEMINI_MODEL: "gemini-3.8-flash",
    });
    const assignment = resolveTier("tier-1", config);
    expect(assignment.provider.id).toBe("gemini");
    expect(assignment.model).toBe("gemini-3.8-flash");
  });

  it("should route tier-1 to DeepSeek Reasoner when DeepSeek is default", () => {
    const config = loadConfig(undefined, {
      LOGNEXUS_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "key",
      DEEPSEEK_MODEL: "deepseek-chat",
    });
    const assignment = resolveTier("tier-1", config);
    expect(assignment.provider.id).toBe("deepseek");
    expect(assignment.model).toBe("deepseek-reasoner");
  });

  it("should route tier-2 to Gemini for long context", () => {
    const config = loadConfig(undefined, {
      LOGNEXUS_PROVIDER: "gemini",
      GEMINI_API_KEY: "key",
      GEMINI_MODEL: "gemini-3.8-flash",
    });
    const assignment = resolveTier("tier-2", config);
    expect(assignment.provider.id).toBe("gemini");
  });

  it("should route tier-3 to DeepSeek when DeepSeek API key is present", () => {
    const config = loadConfig(undefined, {
      LOGNEXUS_PROVIDER: "gemini",
      GEMINI_API_KEY: "gemini-key",
      DEEPSEEK_API_KEY: "deepseek-key",
      DEEPSEEK_MODEL: "deepseek-chat",
    });
    const assignment = resolveTier("tier-3", config);
    expect(assignment.provider.id).toBe("deepseek");
    expect(assignment.model).toBe("deepseek-chat");
  });
});
