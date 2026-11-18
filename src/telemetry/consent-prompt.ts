import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  declineTelemetry,
  enableTelemetry,
  getTelemetryConsentState,
  isTelemetryGloballyDisabled,
} from "./collector.js";
import { TELEMETRY_POLICY_VERSION } from "./schema.js";

export type ConsentPromptOutcome = "accepted" | "declined" | "skipped";

export interface InteractiveConsentOptions {
  command?: string;
  args?: string[];
  targetDir?: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface MaybePromptConsentOptions extends InteractiveConsentOptions {
  askQuestion?: (promptText: string) => Promise<string | null>;
  writeNotice?: (text: string) => void;
}

const INTERACTIVE_CONSENT_COMMANDS = new Set(["init", "status", "doctor"]);

const NON_INTERACTIVE_FLAGS = new Set([
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
]);

const AGENT_ENV_KEYS = [
  "LOGNEXUS_AUTHOR",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CURSOR_TRACE_ID",
  "CODEX_SANDBOX",
  "ANTIGRAVITY_CLI",
  "GEMINI_CLI",
  "AIDER_MODEL",
] as const;

const CONSENT_PROMPT_TIMEOUT_MS = 60_000;

function hasNonEmptyEnv(env: NodeJS.ProcessEnv, key: string): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim() !== "";
}

function isTelemetryDisabledInEnv(env: NodeJS.ProcessEnv): boolean {
  return (
    env.DO_NOT_TRACK === "1" ||
    env.DO_NOT_TRACK === "true" ||
    env.LOGNEXUS_TELEMETRY_DISABLED === "1" ||
    env.LOGNEXUS_TELEMETRY_DISABLED === "true"
  );
}

/**
 * Detects AI coding agent runtimes from well-known environment variables so automated
 * sessions never seal GDPR consent on a human operator's behalf.
 */
export function isAgentEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (AGENT_ENV_KEYS.some((key) => hasNonEmptyEnv(env, key))) {
    return true;
  }

  if (env.TERM_PROGRAM === "vscode") {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value !== "string" || value.trim() === "") continue;
      if (
        key.startsWith("VSCODE_AGENT_") ||
        key.startsWith("VSCODE_COPILOT_") ||
        key.startsWith("ANTIGRAVITY_") ||
        key.startsWith("CURSOR_")
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns true when running inside an AI agent runtime, CI pipeline, test runner,
 * dumb terminal, or explicit non-interactive mode.
 */
export function isAgentOrAutomationEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isAgentEnvironment(env)) return true;

  return (
    env.CI === "true" ||
    env.CI === "1" ||
    Boolean(env.VITEST) ||
    env.NODE_ENV === "test" ||
    env.TERM === "dumb" ||
    env.LOGNEXUS_NO_PROMPT === "1" ||
    env.LOGNEXUS_NO_UPDATE_CHECK === "1" ||
    Boolean(env.GITHUB_ACTIONS)
  );
}

/**
 * Determines whether the CLI may ask the one-time interactive `[y/N]` local telemetry
 * consent question for the current command invocation.
 */
export function isInteractiveConsentAllowed(options: InteractiveConsentOptions = {}): boolean {
  const env = options.env ?? process.env;
  if (isTelemetryGloballyDisabled() || isTelemetryDisabledInEnv(env)) {
    return false;
  }

  if (options.command === undefined || !INTERACTIVE_CONSENT_COMMANDS.has(options.command)) {
    return false;
  }

  const stdinIsTTY = options.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  const stdoutIsTTY = options.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  if (stdinIsTTY !== true || stdoutIsTTY !== true) {
    return false;
  }

  if (isAgentOrAutomationEnv(env)) {
    return false;
  }

  const args = options.args ?? [];
  if (args.some((arg) => NON_INTERACTIVE_FLAGS.has(arg))) {
    return false;
  }

  const targetDir = options.targetDir ?? process.cwd();
  const hasRoutingMarker = existsSync(join(targetDir, ".lognexus", "routing.md"));
  const hasStateMarker = existsSync(join(targetDir, ".lognexus", "state.json"));
  return hasRoutingMarker || hasStateMarker;
}

function defaultAskQuestion(promptText: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: Boolean(process.stdin.isTTY),
    });

    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      try {
        rl.close();
      } finally {
        process.stdin.pause();
      }
      resolve(value);
    };

    timer = setTimeout(() => {
      finish(null);
    }, CONSENT_PROMPT_TIMEOUT_MS);
    timer.unref();

    rl.once("line", (line) => {
      finish(line);
    });
    rl.once("SIGINT", () => {
      finish(null);
    });
    rl.once("close", () => {
      finish(null);
    });
    rl.once("error", () => {
      finish(null);
    });

    process.stderr.write(promptText);
  });
}

/**
 * Prompts a human operator once on interactive `init`, `status`, or `doctor` runs when
 * local telemetry consent is unanswered or outdated. Never writes on EOF, Ctrl+C, or timeout.
 */
export async function maybePromptTelemetryConsent(
  options: MaybePromptConsentOptions = {},
): Promise<ConsentPromptOutcome> {
  if (!isInteractiveConsentAllowed(options)) {
    return "skipped";
  }

  const targetDir = options.targetDir ?? process.cwd();
  const state = getTelemetryConsentState(targetDir);
  if (state === "accepted" || state === "declined") {
    return "skipped";
  }

  const writeNotice = options.writeNotice ?? ((text: string) => process.stderr.write(text));
  const headerLine =
    state === "outdated"
      ? `\nLogNexus Telemetry Policy updated to v${TELEMETRY_POLICY_VERSION}; local recording in .lognexus/telemetry.json is paused until confirmed.\n`
      : `\nLogNexus Local Telemetry (Policy v${TELEMETRY_POLICY_VERSION}): 100% offline local metrics in .lognexus/telemetry.json.\n`;

  writeNotice(
    `${headerLine}` +
      "Zero network calls, zero telemetry endpoints, and zero PII/code paths are ever collected or sent.\n" +
      "Review details in docs/TELEMETRY_PRIVACY.md (opt out anytime via 'lognexus telemetry disable').\n",
  );

  const ask = options.askQuestion ?? defaultAskQuestion;
  let answer: string | null;
  try {
    answer = await ask(
      `Enable local-only telemetry (Policy v${TELEMETRY_POLICY_VERSION})? [y/N]: `,
    );
  } catch {
    return "skipped";
  }

  if (answer === null) {
    return "skipped";
  }

  const normalized = answer.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes") {
    enableTelemetry({ cwd: targetDir, acceptTerms: true });
    return "accepted";
  }

  declineTelemetry(targetDir);
  return "declined";
}
