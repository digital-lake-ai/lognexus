import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const ProviderTypeSchema = z.enum(["gemini", "deepseek"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const GeminiConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().default("gemini-3.8-flash"),
  apiBaseUrl: z.string().default("https://generativelanguage.googleapis.com/v1beta"),
});

export const DeepSeekConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().default("deepseek-chat"),
  apiBaseUrl: z.string().default("https://api.deepseek.com"),
});

export const LogNexusConfigSchema = z.object({
  provider: ProviderTypeSchema.default("gemini"),
  gemini: GeminiConfigSchema.default({
    model: "gemini-3.8-flash",
    apiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  }),
  deepseek: DeepSeekConfigSchema.default({
    model: "deepseek-chat",
    apiBaseUrl: "https://api.deepseek.com",
  }),
});

export type LogNexusConfig = z.infer<typeof LogNexusConfigSchema>;

export function loadConfigFile(customPath?: string): Partial<LogNexusConfig> {
  const candidates = customPath
    ? [customPath]
    : [
        path.resolve(process.cwd(), ".lognexus/config.json"),
        path.resolve(process.cwd(), ".shiplog/config.json"),
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, "utf-8");
        return JSON.parse(raw);
      } catch {
        // ignore parse errors and proceed to next/defaults
      }
    }
  }

  return {};
}

export function loadConfig(
  customConfigPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): LogNexusConfig {
  const fileConfig = loadConfigFile(customConfigPath);

  const merged = {
    provider: (env.LOGNEXUS_PROVIDER as ProviderType) || fileConfig.provider || "gemini",
    gemini: {
      apiKey: env.GEMINI_API_KEY || fileConfig.gemini?.apiKey,
      model: env.GEMINI_MODEL || fileConfig.gemini?.model || "gemini-3.8-flash",
      apiBaseUrl:
        env.GEMINI_BASE_URL ||
        fileConfig.gemini?.apiBaseUrl ||
        "https://generativelanguage.googleapis.com/v1beta",
    },
    deepseek: {
      apiKey: env.DEEPSEEK_API_KEY || fileConfig.deepseek?.apiKey,
      model: env.DEEPSEEK_MODEL || fileConfig.deepseek?.model || "deepseek-chat",
      apiBaseUrl:
        env.DEEPSEEK_BASE_URL || fileConfig.deepseek?.apiBaseUrl || "https://api.deepseek.com",
    },
  };

  return LogNexusConfigSchema.parse(merged);
}
