import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  declineTelemetry,
  enableTelemetry,
  getTelemetryConsentState,
  getTelemetryPath,
  isTelemetryActive,
  loadTelemetry,
} from "../src/telemetry/collector.js";
import {
  isAgentEnvironment,
  isAgentOrAutomationEnv,
  isInteractiveConsentAllowed,
  maybePromptTelemetryConsent,
} from "../src/telemetry/consent-prompt.js";
import { TELEMETRY_POLICY_VERSION } from "../src/telemetry/schema.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Interactive Telemetry Consent Prompt (Policy v2.0.0)", () => {
  let tempDir: string;

  const seedInitializedRepo = (marker: "routing.md" | "state.json" = "routing.md") => {
    mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
    writeFileSync(join(tempDir, ".lognexus", marker), "# marker\n", "utf8");
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-consent-prompt-"));
  });

  afterEach(() => {
    delete process.env.DO_NOT_TRACK;
    delete process.env.LOGNEXUS_TELEMETRY_DISABLED;
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Environment Detection", () => {
    it("detects AI agent runtimes while allowing a normal human VS Code terminal", () => {
      expect(isAgentEnvironment({})).toBe(false);
      expect(
        isAgentEnvironment({
          TERM_PROGRAM: "vscode",
          VSCODE_IPC_HOOK_CLI: "1",
          VSCODE_INJECTION: "1",
        }),
      ).toBe(false);

      for (const key of [
        "LOGNEXUS_AUTHOR",
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CURSOR_TRACE_ID",
        "CODEX_SANDBOX",
        "ANTIGRAVITY_CLI",
        "GEMINI_CLI",
        "AIDER_MODEL",
      ]) {
        expect(isAgentEnvironment({ [key]: "1" })).toBe(true);
      }

      expect(isAgentEnvironment({ TERM_PROGRAM: "vscode", VSCODE_AGENT_SESSION: "active" })).toBe(
        true,
      );
      expect(isAgentEnvironment({ TERM_PROGRAM: "vscode", VSCODE_COPILOT_CHAT: "1" })).toBe(true);
    });

    it("detects CI and non-interactive automation environments", () => {
      expect(isAgentOrAutomationEnv({ TERM: "xterm-256color" })).toBe(false);
      expect(isAgentOrAutomationEnv({ CI: "true" })).toBe(true);
      expect(isAgentOrAutomationEnv({ CI: "1" })).toBe(true);
      expect(isAgentOrAutomationEnv({ VITEST: "true" })).toBe(true);
      expect(isAgentOrAutomationEnv({ NODE_ENV: "test" })).toBe(true);
      expect(isAgentOrAutomationEnv({ TERM: "dumb" })).toBe(true);
      expect(isAgentOrAutomationEnv({ LOGNEXUS_NO_PROMPT: "1" })).toBe(true);
      expect(isAgentOrAutomationEnv({ LOGNEXUS_NO_UPDATE_CHECK: "1" })).toBe(true);
      expect(isAgentOrAutomationEnv({ GITHUB_ACTIONS: "true" })).toBe(true);
      expect(isAgentOrAutomationEnv({ LOGNEXUS_AUTHOR: "google/gemini-flash-worker-agy" })).toBe(
        true,
      );
    });
  });

  describe("Interactive Gate Eligibility", () => {
    it("allows init, status, and doctor in an initialized human TTY", () => {
      seedInitializedRepo("routing.md");
      for (const command of ["init", "status", "doctor"]) {
        expect(
          isInteractiveConsentAllowed({
            command,
            args: [],
            targetDir: tempDir,
            stdinIsTTY: true,
            stdoutIsTTY: true,
            env: {},
          }),
        ).toBe(true);
      }

      expect(
        isInteractiveConsentAllowed({
          command: "commit",
          args: [],
          targetDir: tempDir,
          stdinIsTTY: true,
          stdoutIsTTY: true,
          env: {},
        }),
      ).toBe(false);
    });

    it("skips bare .lognexus directories without routing.md or state.json", () => {
      mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
      expect(
        isInteractiveConsentAllowed({
          command: "status",
          args: [],
          targetDir: tempDir,
          stdinIsTTY: true,
          stdoutIsTTY: true,
          env: {},
        }),
      ).toBe(false);

      seedInitializedRepo("state.json");
      expect(
        isInteractiveConsentAllowed({
          command: "status",
          args: [],
          targetDir: tempDir,
          stdinIsTTY: true,
          stdoutIsTTY: true,
          env: {},
        }),
      ).toBe(true);
    });

    it("skips when DO_NOT_TRACK, non-TTY, agent env, or non-interactive flags are present", () => {
      seedInitializedRepo("routing.md");

      process.env.DO_NOT_TRACK = "1";
      expect(
        isInteractiveConsentAllowed({
          command: "status",
          args: [],
          targetDir: tempDir,
          stdinIsTTY: true,
          stdoutIsTTY: true,
          env: {},
        }),
      ).toBe(false);
      delete process.env.DO_NOT_TRACK;

      expect(
        isInteractiveConsentAllowed({
          command: "status",
          args: [],
          targetDir: tempDir,
          stdinIsTTY: false,
          stdoutIsTTY: true,
          env: {},
        }),
      ).toBe(false);

      expect(
        isInteractiveConsentAllowed({
          command: "status",
          args: [],
          targetDir: tempDir,
          stdinIsTTY: true,
          stdoutIsTTY: false,
          env: {},
        }),
      ).toBe(false);

      expect(
        isInteractiveConsentAllowed({
          command: "status",
          args: [],
          targetDir: tempDir,
          stdinIsTTY: true,
          stdoutIsTTY: true,
          env: { LOGNEXUS_AUTHOR: "google/gemini-4-hydrogen-high (antigravity)" },
        }),
      ).toBe(false);

      expect(
        isInteractiveConsentAllowed({
          command: "status",
          args: [],
          targetDir: tempDir,
          stdinIsTTY: true,
          stdoutIsTTY: true,
          env: { CLAUDECODE: "1" },
        }),
      ).toBe(false);

      for (const flag of [
        "--json",
        "--prompt",
        "--compact-prompt",
        "--pr-body",
        "--enable-telemetry",
        "--no-telemetry",
        "--disable-telemetry",
        "--yes",
        "-y",
        "--help",
        "-h",
        "--version",
        "-v",
      ]) {
        expect(
          isInteractiveConsentAllowed({
            command: "init",
            args: [flag],
            targetDir: tempDir,
            stdinIsTTY: true,
            stdoutIsTTY: true,
            env: {},
          }),
        ).toBe(false);
      }
    });
  });

  describe("maybePromptTelemetryConsent", () => {
    const baseOptions = () => ({
      command: "status",
      args: [] as string[],
      targetDir: tempDir,
      stdinIsTTY: true,
      stdoutIsTTY: true,
      env: {} as NodeJS.ProcessEnv,
    });

    it("accepts and seals Policy v2.0.0 when the operator answers y", async () => {
      seedInitializedRepo();
      const notices: string[] = [];
      const askQuestion = vi.fn(async (promptText: string) => {
        expect(promptText).toContain(`Policy v${TELEMETRY_POLICY_VERSION}`);
        expect(promptText).toContain("[y/N]");
        return "y";
      });

      const outcome = await maybePromptTelemetryConsent({
        ...baseOptions(),
        writeNotice: (text) => notices.push(text),
        askQuestion,
      });

      expect(outcome).toBe("accepted");
      expect(askQuestion).toHaveBeenCalledTimes(1);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain("docs/TELEMETRY_PRIVACY.md");
      expect(notices[0]).toContain(".lognexus/telemetry.json");
      expect(isTelemetryActive(tempDir)).toBe(true);
      expect(getTelemetryConsentState(tempDir)).toBe("accepted");
    });

    it("declines and seals refusal on empty Enter or n", async () => {
      seedInitializedRepo();
      const firstOutcome = await maybePromptTelemetryConsent({
        ...baseOptions(),
        writeNotice: () => {},
        askQuestion: async () => "",
      });

      expect(firstOutcome).toBe("declined");
      expect(isTelemetryActive(tempDir)).toBe(false);
      expect(getTelemetryConsentState(tempDir)).toBe("declined");
      expect(loadTelemetry(tempDir).consent.declinedAt).not.toBeNull();

      // Fresh repo with explicit "n"
      const secondDir = mkdtempSync(join(tmpdir(), "lognexus-consent-n-"));
      try {
        mkdirSync(join(secondDir, ".lognexus"), { recursive: true });
        writeFileSync(join(secondDir, ".lognexus", "routing.md"), "# routing\n", "utf8");

        const secondOutcome = await maybePromptTelemetryConsent({
          command: "doctor",
          args: [],
          targetDir: secondDir,
          stdinIsTTY: true,
          stdoutIsTTY: true,
          env: {},
          writeNotice: () => {},
          askQuestion: async () => "N",
        });

        expect(secondOutcome).toBe("declined");
        expect(getTelemetryConsentState(secondDir)).toBe("declined");
      } finally {
        rmSync(secondDir, { recursive: true, force: true });
      }
    });

    it("skips with zero disk writes on EOF, Ctrl+C, or timeout (null)", async () => {
      seedInitializedRepo();
      const outcome = await maybePromptTelemetryConsent({
        ...baseOptions(),
        writeNotice: () => {},
        askQuestion: async () => null,
      });

      expect(outcome).toBe("skipped");
      expect(existsSync(getTelemetryPath(tempDir))).toBe(false);
      expect(getTelemetryConsentState(tempDir)).toBe("unanswered");
    });

    it("skips silently with zero notices when already accepted or declined", async () => {
      seedInitializedRepo();
      enableTelemetry({ cwd: tempDir, acceptTerms: true });

      const notices: string[] = [];
      const askQuestion = vi.fn(async () => "y");
      const acceptedOutcome = await maybePromptTelemetryConsent({
        ...baseOptions(),
        writeNotice: (text) => notices.push(text),
        askQuestion,
      });
      expect(acceptedOutcome).toBe("skipped");
      expect(notices).toHaveLength(0);
      expect(askQuestion).not.toHaveBeenCalled();

      declineTelemetry(tempDir);
      const declinedOutcome = await maybePromptTelemetryConsent({
        ...baseOptions(),
        writeNotice: (text) => notices.push(text),
        askQuestion,
      });
      expect(declinedOutcome).toBe("skipped");
      expect(notices).toHaveLength(0);
      expect(askQuestion).not.toHaveBeenCalled();
    });

    it("re-prompts when consent policyVersion is outdated (1.0.0)", async () => {
      seedInitializedRepo();
      enableTelemetry({ cwd: tempDir, acceptTerms: true });
      const store = loadTelemetry(tempDir);
      store.consent.policyVersion = "1.0.0";
      writeFileSync(getTelemetryPath(tempDir), JSON.stringify(store, null, 2), "utf8");
      expect(getTelemetryConsentState(tempDir)).toBe("outdated");

      const notices: string[] = [];
      const outcome = await maybePromptTelemetryConsent({
        ...baseOptions(),
        writeNotice: (text) => notices.push(text),
        askQuestion: async () => "yes",
      });

      expect(outcome).toBe("accepted");
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain("updated to v2.0.0");
      expect(notices[0]).toContain("paused until confirmed");
      expect(getTelemetryConsentState(tempDir)).toBe("accepted");
      expect(isTelemetryActive(tempDir)).toBe(true);
    });

    it("skips silently under DO_NOT_TRACK, bare .lognexus, agent env, non-TTY, and --json", async () => {
      const notices: string[] = [];
      const askQuestion = vi.fn(async () => "y");

      // 1. Bare .lognexus without routing.md or state.json
      mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
      expect(
        await maybePromptTelemetryConsent({
          ...baseOptions(),
          writeNotice: (text) => notices.push(text),
          askQuestion,
        }),
      ).toBe("skipped");

      // Now seed routing.md for remaining skip tests
      seedInitializedRepo("routing.md");

      // 2. DO_NOT_TRACK=1
      process.env.DO_NOT_TRACK = "1";
      expect(
        await maybePromptTelemetryConsent({
          ...baseOptions(),
          writeNotice: (text) => notices.push(text),
          askQuestion,
        }),
      ).toBe("skipped");
      delete process.env.DO_NOT_TRACK;

      // 3. Agent env (LOGNEXUS_AUTHOR / CLAUDECODE)
      expect(
        await maybePromptTelemetryConsent({
          ...baseOptions(),
          env: { LOGNEXUS_AUTHOR: "google/gemini-flash-worker-agy" },
          writeNotice: (text) => notices.push(text),
          askQuestion,
        }),
      ).toBe("skipped");
      expect(
        await maybePromptTelemetryConsent({
          ...baseOptions(),
          env: { CLAUDECODE: "1" },
          writeNotice: (text) => notices.push(text),
          askQuestion,
        }),
      ).toBe("skipped");

      // 4. Non-TTY and --json
      expect(
        await maybePromptTelemetryConsent({
          ...baseOptions(),
          stdinIsTTY: false,
          writeNotice: (text) => notices.push(text),
          askQuestion,
        }),
      ).toBe("skipped");
      expect(
        await maybePromptTelemetryConsent({
          ...baseOptions(),
          args: ["--json"],
          writeNotice: (text) => notices.push(text),
          askQuestion,
        }),
      ).toBe("skipped");

      expect(notices).toHaveLength(0);
      expect(askQuestion).not.toHaveBeenCalled();
    });
  });

  describe("Offline Guarantee", () => {
    it("contains no network calls or URL literals in consent-prompt.ts", () => {
      const source = readFileSync(join(repoRoot, "src", "telemetry", "consent-prompt.ts"), "utf8");
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/https?:\/\//);
      expect(source).not.toMatch(/LOGNEXUS_TELEMETRY_URL/);
    });
  });
});
