import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "../src/providers/gemini.js";

describe("GeminiProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should throw an error when API key is missing", async () => {
    const provider = new GeminiProvider({ apiKey: undefined });
    await expect(
      provider.generate({
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).rejects.toThrow(/Gemini API key is required/);
  });

  it("should format request body and parse response correctly", async () => {
    const mockResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: "Hello! How can I assist you with LogNexus?" }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 15,
        candidatesTokenCount: 10,
        totalTokenCount: 25,
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider({
      apiKey: "test-gemini-key",
      model: "gemini-3.8-flash",
    });

    const res = await provider.generate({
      messages: [
        { role: "system", content: "You are an assistant." },
        { role: "user", content: "Hello" },
      ],
      temperature: 0.2,
      maxTokens: 500,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toContain("/models/gemini-3.8-flash:generateContent");
    expect(options.headers["x-goog-api-key"]).toBe("test-gemini-key");

    const payload = JSON.parse(options.body as string);
    expect(payload.systemInstruction.parts[0].text).toBe("You are an assistant.");
    expect(payload.contents[0].role).toBe("user");
    expect(payload.contents[0].parts[0].text).toBe("Hello");
    expect(payload.generationConfig.temperature).toBe(0.2);
    expect(payload.generationConfig.maxOutputTokens).toBe(500);

    expect(res.text).toBe("Hello! How can I assist you with LogNexus?");
    expect(res.usage?.totalTokens).toBe(25);
    expect(res.provider).toBe("gemini");
  });

  it("should handle error responses from the API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({
        error: { message: "Invalid argument supplied" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider({ apiKey: "test-key" });

    await expect(
      provider.generate({
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toThrow("Gemini API Error: Invalid argument supplied");
  });

  it("should perform healthcheck", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "pong" }] } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiProvider({ apiKey: "test-key" });
    const health = await provider.healthCheck();

    expect(health.ok).toBe(true);
    expect(health.message).toContain("Connected successfully");
  });
});
