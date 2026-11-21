import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkVersionParity,
  readVersionSurfaces,
  syncVersionSurfaces,
} from "../scripts/sync-version.mjs";

const tempDirs: string[] = [];

function createFixtureRoot(version = "1.4.1", minCriticalVersion = "0.0.0"): string {
  const root = mkdtempSync(join(tmpdir(), "lognexus-sync-version-"));
  tempDirs.push(root);

  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "python", "lognexus_mcp"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });

  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "@digital-lake/lognexus",
        version,
        lognexusPolicy: {
          minCriticalVersion,
          termsVersion: "2026-10-v1",
          requiresTermsAcceptance: false,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    join(root, "package-lock.json"),
    `${JSON.stringify(
      {
        name: "@digital-lake/lognexus",
        version,
        lockfileVersion: 3,
        packages: {
          "": {
            name: "@digital-lake/lognexus",
            version,
          },
          "node_modules/zod": {
            version: "4.6.7",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(
      {
        name: "lognexus",
        version,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    join(root, "server.json"),
    `${JSON.stringify(
      {
        name: "io.github.digital-lake-ai/lognexus",
        version,
        packages: [
          {
            registryType: "npm",
            identifier: "@digital-lake/lognexus",
            version,
          },
          {
            registryType: "pypi",
            identifier: "lognexus-mcp",
            version,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    join(root, "pyproject.toml"),
    [
      "[build-system]",
      'requires = ["setuptools>=61.0"]',
      "",
      "[project]",
      'name = "lognexus-mcp"',
      `version = "${version}"`,
      'description = "Fixture"',
      "",
      "[tool.setuptools]",
      'version = "9.9.9"',
      "",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(root, "python", "lognexus_mcp", "__init__.py"),
    [
      '"""Launcher."""',
      "",
      `__version__ = "${version}"`,
      'NPM_PACKAGE = f"@digital-lake/lognexus@{__version__}"',
      "",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(root, "src", "cli.ts"),
    [
      "export function getCliVersion(): string {",
      "  try {",
      "    if (process.env.FAKE_PKG) return process.env.FAKE_PKG;",
      "  } catch {",
      "    // ignore",
      "  }",
      `  return "${version}";`,
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("scripts/sync-version.mjs", () => {
  it("passes checkVersionParity when all 7 surfaces match", () => {
    const root = createFixtureRoot("1.4.1");
    const parity = checkVersionParity(root);

    expect(parity.ok).toBe(true);
    expect(parity.expectedVersion).toBe("1.4.1");
    expect(parity.minCriticalVersion).toBe("0.0.0");
    expect(parity.mismatches).toEqual([]);
  });

  it("detects drift on package.json", () => {
    const root = createFixtureRoot("1.4.1");
    const pkgPath = join(root, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.version = "1.4.2";
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

    const parity = checkVersionParity(root);
    expect(parity.ok).toBe(false);
    expect(parity.expectedVersion).toBe("1.4.2");
    expect(parity.mismatches.length).toBeGreaterThanOrEqual(6);
  });

  it("detects drift on package-lock.json root version", () => {
    const root = createFixtureRoot("1.4.1");
    const lockPath = join(root, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.version = "1.4.0";
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const parity = checkVersionParity(root);
    expect(parity.ok).toBe(false);
    expect(parity.mismatches.map((m) => m.surface)).toContain("package-lock.json");
  });

  it('detects drift on package-lock.json packages[""]', () => {
    const root = createFixtureRoot("1.4.1");
    const lockPath = join(root, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.packages[""].version = "1.4.0";
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const parity = checkVersionParity(root);
    expect(parity.ok).toBe(false);
    expect(parity.mismatches.map((m) => m.surface)).toContain('package-lock.json#packages[""]');
  });

  it("detects drift on .claude-plugin/plugin.json", () => {
    const root = createFixtureRoot("1.4.1");
    const pluginPath = join(root, ".claude-plugin", "plugin.json");
    const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
    plugin.version = "1.4.0";
    writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`, "utf8");

    const parity = checkVersionParity(root);
    expect(parity.ok).toBe(false);
    expect(parity.mismatches.map((m) => m.surface)).toContain(".claude-plugin/plugin.json");
  });

  it("detects drift on server.json top-level version", () => {
    const root = createFixtureRoot("1.4.1");
    const serverPath = join(root, "server.json");
    const server = JSON.parse(readFileSync(serverPath, "utf8"));
    server.version = "1.4.0";
    writeFileSync(serverPath, `${JSON.stringify(server, null, 2)}\n`, "utf8");

    const parity = checkVersionParity(root);
    expect(parity.ok).toBe(false);
    expect(parity.mismatches.map((m) => m.surface)).toContain("server.json");
  });

  it("detects drift on server.json packages[*]", () => {
    const root = createFixtureRoot("1.4.1");
    const serverPath = join(root, "server.json");
    const server = JSON.parse(readFileSync(serverPath, "utf8"));
    server.packages[1].version = "1.4.0";
    writeFileSync(serverPath, `${JSON.stringify(server, null, 2)}\n`, "utf8");

    const parity = checkVersionParity(root);
    expect(parity.ok).toBe(false);
    expect(parity.mismatches.map((m) => m.surface)).toContain(
      "server.json#packages[1] (lognexus-mcp)",
    );
  });

  it("detects drift on pyproject.toml", () => {
    const root = createFixtureRoot("1.4.1");
    const pyprojectPath = join(root, "pyproject.toml");
    writeFileSync(
      pyprojectPath,
      readFileSync(pyprojectPath, "utf8").replace('version = "1.4.1"', 'version = "1.4.0"'),
      "utf8",
    );

    const parity = checkVersionParity(root);
    expect(parity.ok).toBe(false);
    expect(parity.mismatches.map((m) => m.surface)).toContain("pyproject.toml");
  });

  it("detects drift on python/lognexus_mcp/__init__.py", () => {
    const root = createFixtureRoot("1.4.1");
    const initPath = join(root, "python", "lognexus_mcp", "__init__.py");
    writeFileSync(
      initPath,
      readFileSync(initPath, "utf8").replace('__version__ = "1.4.1"', '__version__ = "1.4.0"'),
      "utf8",
    );

    const parity = checkVersionParity(root);
    expect(parity.ok).toBe(false);
    expect(parity.mismatches.map((m) => m.surface)).toContain("python/lognexus_mcp/__init__.py");
  });

  it("detects drift on src/cli.ts fallback", () => {
    const root = createFixtureRoot("1.4.1");
    const cliPath = join(root, "src", "cli.ts");
    writeFileSync(
      cliPath,
      readFileSync(cliPath, "utf8").replace('  return "1.4.1";', '  return "1.4.0";'),
      "utf8",
    );

    const parity = checkVersionParity(root);
    expect(parity.ok).toBe(false);
    expect(parity.mismatches.map((m) => m.surface)).toContain("src/cli.ts#getCliVersion");
  });

  it("detects drift when lognexusPolicy.minCriticalVersion is not 0.0.0", () => {
    const root = createFixtureRoot("1.4.1", "1.0.0");

    const parity = checkVersionParity(root);
    expect(parity.ok).toBe(false);
    expect(parity.mismatches.map((m) => m.surface)).toContain(
      "package.json#lognexusPolicy.minCriticalVersion",
    );
  });

  it("syncVersionSurfaces updates all 7 surfaces, preserves minCriticalVersion 0.0.0 and passes parity", () => {
    const root = createFixtureRoot("1.4.1", "0.0.0");
    const result = syncVersionSurfaces(root, "1.5.0");

    expect(result.version).toBe("1.5.0");
    expect(result.updatedFiles).toHaveLength(7);

    const parity = checkVersionParity(root);
    expect(parity.ok).toBe(true);
    expect(parity.expectedVersion).toBe("1.5.0");
    expect(parity.minCriticalVersion).toBe("0.0.0");

    const surfaces = readVersionSurfaces(root);
    expect(surfaces.packageJson.version).toBe("1.5.0");
    expect(surfaces.packageLock.version).toBe("1.5.0");
    expect(surfaces.packageLock.rootPackageVersion).toBe("1.5.0");
    expect(surfaces.claudePlugin.version).toBe("1.5.0");
    expect(surfaces.serverJson.version).toBe("1.5.0");
    expect(surfaces.serverJson.packageVersions.map((p) => p.version)).toEqual(["1.5.0", "1.5.0"]);
    expect(surfaces.pyprojectToml.version).toBe("1.5.0");
    expect(surfaces.pythonInit.version).toBe("1.5.0");
    expect(surfaces.cliFallback.version).toBe("1.5.0");

    const lockRaw = readFileSync(join(root, "package-lock.json"), "utf8");
    expect(lockRaw.endsWith("\n")).toBe(true);
    const lockParsed = JSON.parse(lockRaw);
    expect(lockParsed.packages["node_modules/zod"].version).toBe("4.6.7");

    const pyprojectRaw = readFileSync(join(root, "pyproject.toml"), "utf8");
    expect(pyprojectRaw).toContain('[tool.setuptools]\nversion = "9.9.9"');
  });

  it("rejects invalid SemVer strings without touching any file", () => {
    const root = createFixtureRoot("1.4.1");
    const beforePkg = readFileSync(join(root, "package.json"), "utf8");
    const beforeCli = readFileSync(join(root, "src", "cli.ts"), "utf8");

    for (const badVersion of ["1.5", "v1.5.0", "1.5.0-beta;rm", "", "1.5.0-alpha.1"]) {
      expect(() => syncVersionSurfaces(root, badVersion)).toThrow(/Invalid SemVer/);
    }

    expect(readFileSync(join(root, "package.json"), "utf8")).toBe(beforePkg);
    expect(readFileSync(join(root, "src", "cli.ts"), "utf8")).toBe(beforeCli);
  });
});
