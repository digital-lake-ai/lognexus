import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepSeekProvider } from "../src/providers/deepseek.js";

describe("DeepSeekProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should throw error when DEEPSEEK_API_KEY is missing", async () => {
    const provider = new DeepSeekProvider({ apiKey: undefined });
    await expect(
      provider.generate({
        messages: [{ role: "user", content: "Implement feature" }],
      }),
    ).rejects.toThrow(/API key is required for provider "deepseek"/);
  });

  it("should send standard OpenAI-compatible format and parse response", async () => {
    const mockResponse = {
      id: "chatcmpl-12345",
      choices: [
        {
          message: {
            role: "assistant",
            content: "const x = 42;",
          },
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 8,
        total_tokens: 28,
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DeepSeekProvider({
      apiKey: "sk-test-deepseek-key",
      model: "deepseek-chat",
    });

    const res = await provider.generate({
      messages: [
        { role: "system", content: "You are a coder." },
        { role: "user", content: "Write code" },
      ],
      temperature: 0.1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer sk-test-deepseek-key");

    const payload = JSON.parse(options.body as string);
    expect(payload.model).toBe("deepseek-chat");
    expect(payload.messages).toHaveLength(2);
    expect(payload.temperature).toBe(0.1);

    expect(res.text).toBe("const x = 42;");
    expect(res.usage?.totalTokens).toBe(28);
    expect(res.provider).toBe("deepseek");
  });

  it("should handle error messages correctly", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({
        error: { message: "Authentication failed" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DeepSeekProvider({ apiKey: "bad-key" });

    await expect(
      provider.generate({
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toThrow("deepseek API Error: Authentication failed");
  });
});
