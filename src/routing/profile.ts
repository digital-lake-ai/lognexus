import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type RoutingMode = "confirm" | "warn" | "off";

export type ReviewGateMode = "auto" | "cross-vendor" | "intra-fleet" | "advisory" | "off";

export type EffectiveReviewGateMode = "cross-vendor" | "intra-fleet" | "advisory" | "off";

export type AgentEcosystemId =
  | "antigravity"
  | "claude-code"
  | "cursor"
  | "codex"
  | "kimi"
  | "vscode"
  | "zed"
  | "windsurf"
  | "roo"
  | "aider";

export interface DetectedEcosystems {
  strong: AgentEcosystemId[];
  weak: AgentEcosystemId[];
  all: AgentEcosystemId[];
  profileLabel: string;
}

export interface ParsedRoutingConfig {
  routingMode: RoutingMode;
  configuredReviewGate: ReviewGateMode;
  implementer: string | null;
  reviewer: string | null;
  warnings: string[];
}

export interface RoutingProfile extends ParsedRoutingConfig {
  effectiveReviewGate: EffectiveReviewGateMode;
  ecosystems: DetectedEcosystems;
  hasRoutingFile: boolean;
}

const ECOSYSTEM_ORDER: readonly AgentEcosystemId[] = [
  "antigravity",
  "claude-code",
  "cursor",
  "codex",
  "kimi",
  "vscode",
  "zed",
  "windsurf",
  "roo",
  "aider",
];

export const ECOSYSTEM_MARKERS: Record<
  AgentEcosystemId,
  { readonly strong: readonly string[]; readonly weak: readonly string[] }
> = {
  antigravity: {
    strong: [".gemini", "GEMINI.md", ".agents"],
    weak: [".geminiignore", ".aiexclude"],
  },
  "claude-code": {
    strong: [".claude", "CLAUDE.md"],
    weak: [".claude-plugin"],
  },
  cursor: {
    strong: [".cursor", ".cursorrules"],
    weak: [".cursorignore"],
  },
  codex: {
    strong: [".codex"],
    weak: ["AGENTS.md"],
  },
  kimi: {
    strong: [".kimi"],
    weak: [],
  },
  vscode: {
    strong: [],
    weak: [".vscode"],
  },
  zed: {
    strong: [".zed"],
    weak: [],
  },
  windsurf: {
    strong: [".windsurf"],
    weak: [".codeiumignore"],
  },
  roo: {
    strong: [".roo"],
    weak: [".rooignore"],
  },
  aider: {
    strong: [".aider.conf.yml"],
    weak: [".aiderignore"],
  },
};

const VALID_ROUTING_MODES = new Set<string>(["confirm", "warn", "off"]);
const VALID_REVIEW_GATES = new Set<string>([
  "auto",
  "cross-vendor",
  "intra-fleet",
  "advisory",
  "off",
]);

function anyMarkerExists(targetDir: string, markers: readonly string[]): boolean {
  return markers.some((marker) => existsSync(join(targetDir, marker)));
}

/**
 * Detects configured AI client ecosystems using pure filesystem marker checks.
 * Weak/ignore-only markers are tracked separately from strong IDE/agent signals.
 */
export function detectAgentEcosystems(targetDir: string = process.cwd()): DetectedEcosystems {
  const strong: AgentEcosystemId[] = [];
  const weak: AgentEcosystemId[] = [];
  const all: AgentEcosystemId[] = [];

  for (const id of ECOSYSTEM_ORDER) {
    const markers = ECOSYSTEM_MARKERS[id];
    const hasStrong = anyMarkerExists(targetDir, markers.strong);
    const hasWeak = anyMarkerExists(targetDir, markers.weak);
    if (hasStrong) strong.push(id);
    if (hasWeak) weak.push(id);
    if (hasStrong || hasWeak) all.push(id);
  }

  const profileLabel =
    strong.length === 1
      ? `single-client (${strong[0]})`
      : strong.length > 1
        ? `multi-client (${strong.join(", ")})`
        : "generic";

  return { strong, weak, all, profileLabel };
}

function normalizeAutoIdentity(rawValue: string): string | null {
  if (rawValue === "" || rawValue.toLowerCase() === "auto") {
    return null;
  }
  return rawValue;
}

/**
 * Parses `.lognexus/routing.md` with line-anchored keys, skipping `#` comments,
 * HTML comments (`<!--` / `-->`), and inline `# ...` comments. Never throws.
 */
export function parseRoutingConfigContent(content: string): ParsedRoutingConfig {
  let routingMode: RoutingMode = "confirm";
  let configuredReviewGate: ReviewGateMode = "auto";
  let implementer: string | null = null;
  let reviewer: string | null = null;
  const warnings: string[] = [];

  let inHtmlComment = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (inHtmlComment) {
      if (trimmed.includes("-->")) {
        inHtmlComment = false;
      }
      continue;
    }

    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("-->")) {
      continue;
    }

    if (trimmed.startsWith("<!--")) {
      if (!trimmed.includes("-->")) {
        inHtmlComment = true;
      }
      continue;
    }

    const uncommented = trimmed.replace(/\s+#.*$/, "").trim();
    const match = uncommented.match(/^([a-z_]+)\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = match[2].replace(/\s*<!--.*$/, "").trim();

    switch (key) {
      case "routing": {
        const normalized = value.toLowerCase();
        if (VALID_ROUTING_MODES.has(normalized)) {
          routingMode = normalized as RoutingMode;
        } else {
          warnings.push(
            `Invalid routing value '${value}' in .lognexus/routing.md; defaulting to 'confirm'`,
          );
        }
        break;
      }
      case "review_gate": {
        const normalized = value.toLowerCase();
        if (VALID_REVIEW_GATES.has(normalized)) {
          configuredReviewGate = normalized as ReviewGateMode;
        } else {
          warnings.push(
            `Invalid review_gate value '${value}' in .lognexus/routing.md; defaulting to 'auto'`,
          );
        }
        break;
      }
      case "implementer":
        implementer = normalizeAutoIdentity(value);
        break;
      case "reviewer":
        reviewer = normalizeAutoIdentity(value);
        break;
      default:
        warnings.push(`Unknown routing key '${key}' in .lognexus/routing.md`);
        break;
    }
  }

  return {
    routingMode,
    configuredReviewGate,
    implementer,
    reviewer,
    warnings,
  };
}

/**
 * Resolves the effective routing profile for a repository.
 * `review_gate: auto` always resolves to `"intra-fleet"` regardless of detected folder count.
 */
export function resolveRoutingProfile(targetDir: string = process.cwd()): RoutingProfile {
  const ecosystems = detectAgentEcosystems(targetDir);
  const routingPath = join(targetDir, ".lognexus", "routing.md");

  if (!existsSync(routingPath)) {
    return {
      routingMode: "confirm",
      configuredReviewGate: "auto",
      effectiveReviewGate: "intra-fleet",
      implementer: null,
      reviewer: null,
      ecosystems,
      warnings: [],
      hasRoutingFile: false,
    };
  }

  let content = "";
  try {
    content = readFileSync(routingPath, "utf8");
  } catch {
    return {
      routingMode: "confirm",
      configuredReviewGate: "auto",
      effectiveReviewGate: "intra-fleet",
      implementer: null,
      reviewer: null,
      ecosystems,
      warnings: ["Unable to read .lognexus/routing.md; using defaults"],
      hasRoutingFile: true,
    };
  }

  const parsed = parseRoutingConfigContent(content);
  const effectiveReviewGate: EffectiveReviewGateMode =
    parsed.configuredReviewGate === "auto" ? "intra-fleet" : parsed.configuredReviewGate;

  return {
    ...parsed,
    effectiveReviewGate,
    ecosystems,
    hasRoutingFile: true,
  };
}
