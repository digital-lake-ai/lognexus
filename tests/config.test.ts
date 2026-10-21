import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loadConfig.js";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lognexus-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return default configuration when no environment or config file is present", () => {
    const config = loadConfig(undefined, {});
    expect(config.provider).toBe("gemini");
    expect(config.gemini.model).toBe("gemini-3.8-flash");
    expect(config.deepseek.model).toBe("deepseek-chat");
  });

  it("should prioritize environment variables over file configuration", () => {
    const filePath = path.join(tempDir, "config.json");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        provider: "deepseek",
        gemini: { model: "gemini-1.5-pro" },
      }),
    );

    const env = {
      LOGNEXUS_PROVIDER: "gemini",
      GEMINI_API_KEY: "env-gemini-key",
      GEMINI_MODEL: "gemini-3.8-flash",
    };

    const config = loadConfig(filePath, env);
    expect(config.provider).toBe("gemini");
    expect(config.gemini.apiKey).toBe("env-gemini-key");
    expect(config.gemini.model).toBe("gemini-3.8-flash");
  });

  it("should read from custom config file when environment variables are omitted", () => {
    const filePath = path.join(tempDir, "custom.json");
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        provider: "deepseek",
        deepseek: {
          apiKey: "sk-custom-file-key",
          model: "deepseek-reasoner",
        },
      }),
    );

    const config = loadConfig(filePath, {});
    expect(config.provider).toBe("deepseek");
    expect(config.deepseek.apiKey).toBe("sk-custom-file-key");
    expect(config.deepseek.model).toBe("deepseek-reasoner");
  });
});
