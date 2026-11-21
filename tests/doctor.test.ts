import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkAgentEcosystem,
  checkGit,
  checkMcpClientConfigs,
  checkRulesConfig,
  checkScopeDrift,
  checkVersionMaturity,
  runDiagnostics,
} from "../src/doctor.js";

describe("doctor diagnostics", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-doctor-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("checks git presence and repository status", () => {
    const check = checkGit(process.cwd());
    expect(check.name).toBe("Git");
    expect(check.status).toBe("pass");
  });

  it("warns when no .lognexus directory is found", () => {
    const check = checkRulesConfig(tempDir);
    expect(check.status).toBe("warn");
    expect(check.message).toContain("No .lognexus/ directory found");
  });

  it("passes when .lognexus/routing.md is present", () => {
    const logDir = join(tempDir, ".lognexus");
    mkdirSync(logDir);
    writeFileSync(join(logDir, "routing.md"), "# Routing\nrouting: warn\n", "utf8");

    const check = checkRulesConfig(tempDir);
    expect(check.status).toBe("pass");
    expect(check.message).toContain("routing mode: warn");
  });

  it("runDiagnostics returns an array of checks", () => {
    const results = runDiagnostics(process.cwd());
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(4);
  });

  it("reports the Scope Drift Guard as passing when no subtask is active", () => {
    const check = checkScopeDrift(tempDir);
    expect(check.name).toBe("Scope Drift Guard");
    expect(check.status).toBe("pass");
    expect(check.message).toContain("nothing to compare against");
  });

  it("warns when the working tree leaves the contracted scope", () => {
    const logDir = join(tempDir, ".lognexus");
    mkdirSync(logDir);
    writeFileSync(
      join(logDir, "state.json"),
      JSON.stringify({ currentSubtask: { id: "T1", contract: { allowedFiles: ["src/ok.ts"] } } }),
      "utf8",
    );
    writeFileSync(join(tempDir, "rogue.ts"), "content\n", "utf8");
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore", shell: false });

    const check = checkScopeDrift(tempDir);
    expect(check.status).toBe("warn");
    expect(check.message).toContain("rogue.ts");
  });

  it("includes the Scope Drift Guard in the diagnostics table", () => {
    const results = runDiagnostics(process.cwd());
    expect(results.some((check) => check.name === "Scope Drift Guard")).toBe(true);
  });

  it("reports pass when the contracted subtask is already completed", () => {
    const logDir = join(tempDir, ".lognexus");
    mkdirSync(logDir);
    writeFileSync(
      join(logDir, "state.json"),
      JSON.stringify({
        currentSubtask: {
          id: "T1",
          status: "completed",
          contract: { allowedFiles: ["src/ok.ts"] },
        },
      }),
      "utf8",
    );
    writeFileSync(join(tempDir, "rogue.ts"), "content\n", "utf8");
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore", shell: false });

    const check = checkScopeDrift(tempDir);
    expect(check.status).toBe("pass");
    expect(check.message).toContain("nothing to compare against");
  });

  describe("Version Maturity", () => {
    function initRepo(): void {
      execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore", shell: false });
      writeFileSync(join(tempDir, "README.md"), "# demo\n", "utf8");
      execFileSync("git", ["add", "README.md"], { cwd: tempDir, stdio: "ignore", shell: false });
      execFileSync(
        "git",
        ["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-m", "chore: seed"],
        { cwd: tempDir, stdio: "ignore", shell: false },
      );
    }

    it("warns on the npm init -y default version with no published release", () => {
      initRepo();
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "1.0.0" }), "utf8");

      const check = checkVersionMaturity(tempDir);
      expect(check.name).toBe("Version Maturity");
      expect(check.status).toBe("warn");
      expect(check.message).toContain("npm init -y");
      expect(check.message).toContain("0.1.0");
    });

    it("passes when the manifest starts at 0.1.0", () => {
      initRepo();
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");

      const check = checkVersionMaturity(tempDir);
      expect(check.status).toBe("pass");
      expect(check.message).toContain("Manifest version 0.1.0");
    });

    it("passes once a release tag exists", () => {
      initRepo();
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "1.0.0" }), "utf8");
      execFileSync(
        "git",
        [
          "-c",
          "user.name=T",
          "-c",
          "user.email=t@example.com",
          "tag",
          "-a",
          "v1.0.0",
          "-m",
          "v1.0.0",
        ],
        {
          cwd: tempDir,
          stdio: "ignore",
          shell: false,
        },
      );

      const check = checkVersionMaturity(tempDir);
      expect(check.status).toBe("pass");
      expect(check.message).toContain("1 release(s) published");
    });

    it("skips the check when no manifest declares a version", () => {
      initRepo();

      const check = checkVersionMaturity(tempDir);
      expect(check.status).toBe("pass");
      expect(check.message).toContain("No package manifest detected");
    });

    it("is the fifth check in the diagnostics table", () => {
      const results = runDiagnostics(process.cwd());
      expect(results[4]?.name).toBe("Version Maturity");
      expect(results[5]?.name).toBe("Agent Ecosystem");
    });

    it("passes when multiple manifests share the exact same version", () => {
      initRepo();
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");
      mkdirSync(join(tempDir, "src-tauri"), { recursive: true });
      writeFileSync(
        join(tempDir, "src-tauri", "Cargo.toml"),
        '[package]\nname = "app"\nversion = "0.1.0"\n',
        "utf8",
      );
      mkdirSync(join(tempDir, "modules", "modA"), { recursive: true });
      writeFileSync(
        join(tempDir, "modules", "modA", "plugin.manifest.json"),
        JSON.stringify({ version: "0.1.0" }),
        "utf8",
      );

      const check = checkVersionMaturity(tempDir);
      expect(check.status).toBe("pass");
      expect(check.message).toContain("Manifest version 0.1.0");
    });

    it("warns when software versions drift across manifests", () => {
      initRepo();
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "0.1.0" }), "utf8");
      mkdirSync(join(tempDir, "src-tauri"), { recursive: true });
      writeFileSync(
        join(tempDir, "src-tauri", "Cargo.toml"),
        '[package]\nname = "app"\nversion = "0.2.0"\n',
        "utf8",
      );
      mkdirSync(join(tempDir, "modules", "modA"), { recursive: true });
      writeFileSync(
        join(tempDir, "modules", "modA", "plugin.manifest.json"),
        JSON.stringify({ version: "0.3.0" }),
        "utf8",
      );

      const check = checkVersionMaturity(tempDir);
      expect(check.name).toBe("Version Maturity");
      expect(check.status).toBe("warn");
      expect(check.message).toContain("Software version drift across manifests");
      expect(check.message).toContain("package.json=0.1.0");
      expect(check.message).toContain("src-tauri/Cargo.toml=0.2.0");
      expect(check.message).toContain("modules/modA/plugin.manifest.json=0.3.0");
      expect(check.message).toContain("Document Revision");
    });
  });

  it("ignores commented routing directives and warns on unknown keys in routing.md", () => {
    const logDir = join(tempDir, ".lognexus");
    mkdirSync(logDir);
    writeFileSync(
      join(logDir, "routing.md"),
      "# routing: off\nrouting: confirm\nunknown_setting: true\n",
      "utf8",
    );

    const check = checkRulesConfig(tempDir);
    expect(check.status).toBe("warn");
    expect(check.message).toContain("routing mode: confirm");
    expect(check.message).toContain("Unknown routing key 'unknown_setting'");
  });

  it("reports detected agent ecosystem profile and effective review_gate", () => {
    mkdirSync(join(tempDir, ".claude"));
    const check = checkAgentEcosystem(tempDir);
    expect(check.name).toBe("Agent Ecosystem");
    expect(check.status).toBe("pass");
    expect(check.message).toContain("single-client (claude-code)");
    expect(check.message).toContain("review_gate: intra-fleet");
  });

  it("reports policy profile in checkRulesConfig when .lognexus/policy.json is valid and fails when invalid", () => {
    const logDir = join(tempDir, ".lognexus");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, "routing.md"), "# Routing\nrouting: confirm\n", "utf8");
    writeFileSync(join(logDir, "policy.json"), JSON.stringify({ profile: "incremental" }), "utf8");

    const validCheck = checkRulesConfig(tempDir);
    expect(validCheck.name).toBe("LogNexus Rules");
    expect(validCheck.status).toBe("pass");
    expect(validCheck.message).toContain("policy: incremental");

    writeFileSync(
      join(logDir, "policy.json"),
      JSON.stringify({ rules: { "review-gate-separation": "warn" } }),
      "utf8",
    );

    const invalidCheck = checkRulesConfig(tempDir);
    expect(invalidCheck.name).toBe("LogNexus Rules");
    expect(invalidCheck.status).toBe("fail");
    expect(invalidCheck.message).toContain("Invalid .lognexus/policy.json");
  });

  describe("MCP Client Configs (#39)", () => {
    it("resolves Claude Desktop config paths across darwin, linux, and win32 using mocked home/env", () => {
      const darwinHome = join(tempDir, "darwin-home");
      const darwinCfg = join(
        darwinHome,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      );
      mkdirSync(join(darwinCfg, ".."), { recursive: true });
      writeFileSync(
        darwinCfg,
        JSON.stringify({
          mcpServers: {
            lognexus: { command: "npx", args: ["-y", "@digital-lake/lognexus", "mcp"] },
          },
        }),
        "utf8",
      );
      const darwinCheck = checkMcpClientConfigs(tempDir, {
        platform: "darwin",
        homeDir: darwinHome,
        env: {},
      });
      expect(darwinCheck.status).toBe("pass");
      expect(darwinCheck.message).toContain("Claude Desktop");

      const linuxHome = join(tempDir, "linux-home");
      const linuxDefaultCfg = join(linuxHome, ".config", "Claude", "claude_desktop_config.json");
      mkdirSync(join(linuxDefaultCfg, ".."), { recursive: true });
      writeFileSync(
        linuxDefaultCfg,
        JSON.stringify({
          mcpServers: {
            lognexus: { command: "uvx", args: ["lognexus-mcp"] },
          },
        }),
        "utf8",
      );
      const linuxDefaultCheck = checkMcpClientConfigs(tempDir, {
        platform: "linux",
        homeDir: linuxHome,
        env: {},
      });
      expect(linuxDefaultCheck.status).toBe("pass");
      expect(linuxDefaultCheck.message).toContain("uvx lognexus-mcp");

      const xdgDir = join(tempDir, "custom-xdg");
      const linuxXdgCfg = join(xdgDir, "Claude", "claude_desktop_config.json");
      mkdirSync(join(linuxXdgCfg, ".."), { recursive: true });
      writeFileSync(
        linuxXdgCfg,
        JSON.stringify({
          mcpServers: {
            lognexus: { command: "lognexus-mcp" },
          },
        }),
        "utf8",
      );
      const linuxXdgCheck = checkMcpClientConfigs(tempDir, {
        platform: "linux",
        homeDir: linuxHome,
        env: { XDG_CONFIG_HOME: xdgDir },
      });
      expect(linuxXdgCheck.status).toBe("pass");
      expect(linuxXdgCheck.message).toContain("lognexus-mcp");

      const winHome = join(tempDir, "win-home");
      const winDefaultCfg = join(
        winHome,
        "AppData",
        "Roaming",
        "Claude",
        "claude_desktop_config.json",
      );
      mkdirSync(join(winDefaultCfg, ".."), { recursive: true });
      writeFileSync(
        winDefaultCfg,
        JSON.stringify({
          mcpServers: {
            lognexus: { command: "npx.cmd", args: ["-y", "@digital-lake/lognexus@latest", "mcp"] },
          },
        }),
        "utf8",
      );
      const winDefaultCheck = checkMcpClientConfigs(tempDir, {
        platform: "win32",
        homeDir: winHome,
        env: {},
      });
      expect(winDefaultCheck.status).toBe("pass");
      expect(winDefaultCheck.message).toContain("npx.cmd @digital-lake/lognexus mcp");

      const winAppData = join(tempDir, "win-appdata");
      const winAppDataCfg = join(winAppData, "Claude", "claude_desktop_config.json");
      mkdirSync(join(winAppDataCfg, ".."), { recursive: true });
      writeFileSync(
        winAppDataCfg,
        JSON.stringify({
          mcpServers: {
            lognexus: { command: "python", args: ["-m", "lognexus_mcp"] },
          },
        }),
        "utf8",
      );
      const winAppDataCheck = checkMcpClientConfigs(tempDir, {
        platform: "win32",
        homeDir: winHome,
        env: { APPDATA: winAppData },
      });
      expect(winAppDataCheck.status).toBe("pass");
      expect(winAppDataCheck.message).toContain("python -m lognexus_mcp");
    });

    it("validates workspace .cursor/mcp.json, .vscode/mcp.json (servers and mcpServers), and .mcp.json", () => {
      const emptyHome = join(tempDir, "empty-home");
      mkdirSync(join(tempDir, ".cursor"), { recursive: true });
      mkdirSync(join(tempDir, ".vscode"), { recursive: true });

      writeFileSync(
        join(tempDir, ".cursor", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            lognexus: { command: "npx", args: ["-y", "@digital-lake/lognexus", "mcp"] },
          },
        }),
        "utf8",
      );
      writeFileSync(
        join(tempDir, ".vscode", "mcp.json"),
        JSON.stringify({
          servers: {
            "lognexus-py": { command: "uvx", args: ["lognexus-mcp"] },
          },
        }),
        "utf8",
      );
      writeFileSync(
        join(tempDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            "lognexus-local": { command: "node", args: ["dist/cli.js", "mcp"] },
          },
        }),
        "utf8",
      );

      const check = checkMcpClientConfigs(tempDir, {
        platform: "linux",
        homeDir: emptyHome,
        env: {},
      });
      expect(check.name).toBe("MCP Client Configs");
      expect(check.status).toBe("pass");
      expect(check.message).toContain("Cursor");
      expect(check.message).toContain("VS Code");
      expect(check.message).toContain("Workspace");

      // Also verify .vscode/mcp.json with mcpServers works
      writeFileSync(
        join(tempDir, ".vscode", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            lognexus: { command: "lognexus", args: ["mcp"] },
          },
        }),
        "utf8",
      );
      const vsCodeMcpServers = checkMcpClientConfigs(tempDir, {
        platform: "linux",
        homeDir: emptyHome,
        env: {},
      });
      expect(vsCodeMcpServers.status).toBe("pass");
      expect(vsCodeMcpServers.message).toContain("VS Code (lognexus mcp)");
    });

    it("fails when @digital-lake/lognexus entry is missing the 'mcp' subcommand", () => {
      const emptyHome = join(tempDir, "empty-home");
      writeFileSync(
        join(tempDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            lognexus: { command: "npx", args: ["-y", "@digital-lake/lognexus"] },
          },
        }),
        "utf8",
      );

      const check = checkMcpClientConfigs(tempDir, {
        platform: "linux",
        homeDir: emptyHome,
        env: {},
      });
      expect(check.status).toBe("fail");
      expect(check.message).toContain('missing "mcp" subcommand');
    });

    it("fails on malformed JSON or non-object server maps", () => {
      const emptyHome = join(tempDir, "empty-home");
      mkdirSync(join(tempDir, ".cursor"), { recursive: true });
      writeFileSync(join(tempDir, ".cursor", "mcp.json"), "{ invalid json", "utf8");

      const jsonCheck = checkMcpClientConfigs(tempDir, {
        platform: "linux",
        homeDir: emptyHome,
        env: {},
      });
      expect(jsonCheck.status).toBe("fail");
      expect(jsonCheck.message).toContain("invalid JSON");

      rmSync(join(tempDir, ".cursor", "mcp.json"));
      writeFileSync(
        join(tempDir, ".mcp.json"),
        JSON.stringify({ mcpServers: ["not-an-object"] }),
        "utf8",
      );

      const nonObjCheck = checkMcpClientConfigs(tempDir, {
        platform: "linux",
        homeDir: emptyHome,
        env: {},
      });
      expect(nonObjCheck.status).toBe("fail");
      expect(nonObjCheck.message).toContain('"mcpServers" must be an object');
    });

    it("warns without writing any files when no LogNexus MCP config exists", () => {
      const emptyHome = join(tempDir, "empty-home");
      mkdirSync(emptyHome, { recursive: true });

      const check = checkMcpClientConfigs(tempDir, {
        platform: "linux",
        homeDir: emptyHome,
        env: {},
      });

      expect(check.name).toBe("MCP Client Configs");
      expect(check.status).toBe("warn");
      expect(readdirSync(emptyHome)).toEqual([]);
      expect(existsSync(join(tempDir, ".mcp.json"))).toBe(false);
      expect(existsSync(join(tempDir, ".cursor"))).toBe(false);
      expect(existsSync(join(tempDir, ".vscode"))).toBe(false);
    });

    it("appends MCP Client Configs at index 6 only when options.mcp === true", () => {
      const emptyHome = join(tempDir, "empty-home");
      const withoutMcp = runDiagnostics(tempDir);
      expect(withoutMcp).toHaveLength(6);
      expect(withoutMcp.some((c) => c.name === "MCP Client Configs")).toBe(false);

      const withMcp = runDiagnostics(tempDir, {
        mcp: true,
        platform: "linux",
        homeDir: emptyHome,
        env: {},
      });
      expect(withMcp).toHaveLength(7);
      expect(withMcp[6]?.name).toBe("MCP Client Configs");
    });
  });
});
