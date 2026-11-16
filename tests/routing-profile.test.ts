import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectAgentEcosystems,
  parseRoutingConfigContent,
  resolveRoutingProfile,
} from "../src/routing/profile.js";

describe("detectAgentEcosystems", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-routing-eco-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns generic when no markers exist", () => {
    const res = detectAgentEcosystems(tempDir);
    expect(res.strong).toEqual([]);
    expect(res.weak).toEqual([]);
    expect(res.all).toEqual([]);
    expect(res.profileLabel).toBe("generic");
  });

  it("distinguishes weak ignore/editor markers from strong IDE markers", () => {
    writeFileSync(join(tempDir, "AGENTS.md"), "# rules\n", "utf8");
    mkdirSync(join(tempDir, ".vscode"));
    writeFileSync(join(tempDir, ".geminiignore"), "node_modules/\n", "utf8");
    writeFileSync(join(tempDir, ".cursorignore"), "node_modules/\n", "utf8");
    mkdirSync(join(tempDir, ".claude-plugin"));

    const res = detectAgentEcosystems(tempDir);
    expect(res.strong).toEqual([]);
    expect(res.weak).toEqual(["antigravity", "claude-code", "cursor", "codex", "vscode"]);
    expect(res.all).toEqual(["antigravity", "claude-code", "cursor", "codex", "vscode"]);
    expect(res.profileLabel).toBe("generic");
  });

  it("detects a single strong ecosystem across all supported clients", () => {
    const cases: Array<{ id: string; marker: string; isDir?: boolean }> = [
      { id: "antigravity", marker: "GEMINI.md" },
      { id: "claude-code", marker: ".claude", isDir: true },
      { id: "cursor", marker: ".cursorrules" },
      { id: "codex", marker: ".codex", isDir: true },
      { id: "kimi", marker: ".kimi", isDir: true },
      { id: "zed", marker: ".zed", isDir: true },
      { id: "windsurf", marker: ".windsurf", isDir: true },
      { id: "roo", marker: ".roo", isDir: true },
      { id: "aider", marker: ".aider.conf.yml" },
    ];

    for (const entry of cases) {
      const dir = mkdtempSync(join(tmpdir(), "lognexus-eco-case-"));
      try {
        const target = join(dir, entry.marker);
        if (entry.isDir) mkdirSync(target);
        else writeFileSync(target, "", "utf8");

        const res = detectAgentEcosystems(dir);
        expect(res.strong).toEqual([entry.id]);
        expect(res.all).toContain(entry.id);
        expect(res.profileLabel).toBe(`single-client (${entry.id})`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("detects multi-client when two or more strong ecosystems exist", () => {
    mkdirSync(join(tempDir, ".claude"));
    mkdirSync(join(tempDir, ".cursor"));

    const res = detectAgentEcosystems(tempDir);
    expect(res.strong).toEqual(["claude-code", "cursor"]);
    expect(res.profileLabel).toBe("multi-client (claude-code, cursor)");
  });
});

describe("parseRoutingConfigContent", () => {
  it("skips # comments, inline # comments, and HTML comments", () => {
    const content = [
      "# routing: off",
      "<!-- routing: off -->",
      "<!--",
      "review_gate: off",
      "-->",
      "routing: warn # trailing comment",
      "review_gate: cross-vendor",
      "implementer: auto",
      "reviewer: Claude Opus",
    ].join("\n");

    const parsed = parseRoutingConfigContent(content);
    expect(parsed.routingMode).toBe("warn");
    expect(parsed.configuredReviewGate).toBe("cross-vendor");
    expect(parsed.implementer).toBeNull();
    expect(parsed.reviewer).toBe("Claude Opus");
    expect(parsed.warnings).toEqual([]);
  });

  it("warns without throwing on unknown keys and invalid values", () => {
    const content = [
      "routing: bogus",
      "review_gate: invalid_gate",
      "unknown_field: something",
      "implementer: google/gemini-4-hydrogen-high (antigravity)",
    ].join("\n");

    const parsed = parseRoutingConfigContent(content);
    expect(parsed.routingMode).toBe("confirm");
    expect(parsed.configuredReviewGate).toBe("auto");
    expect(parsed.implementer).toBe("google/gemini-4-hydrogen-high (antigravity)");
    expect(parsed.warnings).toHaveLength(3);
    expect(parsed.warnings[0]).toContain("Invalid routing value");
    expect(parsed.warnings[1]).toContain("Invalid review_gate value");
    expect(parsed.warnings[2]).toContain("Unknown routing key 'unknown_field'");
  });

  it("preserves backwards compatibility for legacy 1-field routing.md", () => {
    const parsed = parseRoutingConfigContent("# Model-Tier Routing\nrouting: off\n");
    expect(parsed.routingMode).toBe("off");
    expect(parsed.configuredReviewGate).toBe("auto");
    expect(parsed.implementer).toBeNull();
    expect(parsed.reviewer).toBeNull();
    expect(parsed.warnings).toEqual([]);
  });

  it("handles pathological whitespace and comment inputs in linear time without throwing", () => {
    const payload = [
      `${" ".repeat(50_000)}# comment`,
      `_:${" ".repeat(50_000)}`,
      `routing: confirm ${"<!--".repeat(10_000)}`,
    ].join("\n");

    const start = performance.now();
    const parsed = parseRoutingConfigContent(payload);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(parsed.routingMode).toBe("confirm");
    expect(parsed.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("resolveRoutingProfile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-routing-profile-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns safe defaults when .lognexus/routing.md is absent", () => {
    const profile = resolveRoutingProfile(tempDir);
    expect(profile.hasRoutingFile).toBe(false);
    expect(profile.routingMode).toBe("confirm");
    expect(profile.configuredReviewGate).toBe("auto");
    expect(profile.effectiveReviewGate).toBe("intra-fleet");
    expect(profile.warnings).toEqual([]);
  });

  it("always resolves review_gate: auto to intra-fleet regardless of client folder count", () => {
    mkdirSync(join(tempDir, ".lognexus"));
    writeFileSync(
      join(tempDir, ".lognexus", "routing.md"),
      "routing: confirm\nreview_gate: auto\n",
    );
    mkdirSync(join(tempDir, ".gemini"));
    mkdirSync(join(tempDir, ".claude"));
    mkdirSync(join(tempDir, ".cursor"));

    const profile = resolveRoutingProfile(tempDir);
    expect(profile.ecosystems.strong).toEqual(["antigravity", "claude-code", "cursor"]);
    expect(profile.configuredReviewGate).toBe("auto");
    expect(profile.effectiveReviewGate).toBe("intra-fleet");
  });

  it("respects explicit review_gate modes and custom identities", () => {
    mkdirSync(join(tempDir, ".lognexus"));
    writeFileSync(
      join(tempDir, ".lognexus", "routing.md"),
      "routing: warn\nreview_gate: advisory\nimplementer: claude/sonnet\nreviewer: claude/opus\n",
    );

    const profile = resolveRoutingProfile(tempDir);
    expect(profile.hasRoutingFile).toBe(true);
    expect(profile.routingMode).toBe("warn");
    expect(profile.effectiveReviewGate).toBe("advisory");
    expect(profile.implementer).toBe("claude/sonnet");
    expect(profile.reviewer).toBe("claude/opus");
  });
});
