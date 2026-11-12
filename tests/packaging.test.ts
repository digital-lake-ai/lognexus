import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listMcpTools } from "../src/mcp/tools.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

interface RegistryPackage {
  registryType: string;
  identifier: string;
  version: string;
}

interface ServerManifest {
  $schema: string;
  name: string;
  version: string;
  packages: RegistryPackage[];
}

describe("MCP Registry manifest (server.json)", () => {
  it("declares the official schema, the server name and both package registries", () => {
    expect(existsSync(join(repoRoot, "server.json"))).toBe(true);

    const server = JSON.parse(readRepoFile("server.json")) as ServerManifest;

    expect(server.$schema).toBe(
      "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    );
    expect(server.name).toBe("io.github.digital-lake-ai/lognexus");

    const npmPackage = server.packages.find((entry) => entry.registryType === "npm");
    const pypiPackage = server.packages.find((entry) => entry.registryType === "pypi");

    expect(npmPackage?.identifier).toBe("@digital-lake/lognexus");
    expect(pypiPackage?.identifier).toBe("lognexus-mcp");
    expect(npmPackage?.version).toBe(server.version);
    expect(pypiPackage?.version).toBe(server.version);
  });

  it("keeps server.json, pyproject.toml and the Python launcher on the same version", () => {
    const server = JSON.parse(readRepoFile("server.json")) as ServerManifest;
    const pyproject = readRepoFile("pyproject.toml");
    const launcher = readRepoFile("python/lognexus_mcp/__init__.py");

    expect(pyproject).toMatch(/^name = "lognexus-mcp"$/m);
    expect(pyproject).toMatch(new RegExp(`^version = "${server.version}"$`, "m"));
    expect(launcher).toContain(`__version__ = "${server.version}"`);
  });
});

describe("PyPI package metadata (pyproject.toml)", () => {
  it("declares lognexus-mcp with classifiers for Linux, macOS and Windows", () => {
    expect(existsSync(join(repoRoot, "pyproject.toml"))).toBe(true);

    const pyproject = readRepoFile("pyproject.toml");

    expect(pyproject).toContain("Operating System :: MacOS");
    expect(pyproject).toContain("Operating System :: Microsoft :: Windows");
    expect(pyproject).toContain("Operating System :: POSIX :: Linux");
  });
});

describe("Python launcher (python/lognexus_mcp/__init__.py)", () => {
  it("invokes subprocess.run with shell=False and never shell=True", () => {
    const launcher = readRepoFile("python/lognexus_mcp/__init__.py");

    expect(launcher).toContain("subprocess.run(");
    expect(launcher).toContain("shell=False");
    expect(launcher).not.toContain("shell=True");
  });
});

describe("CLI --help & Biome schema parity", () => {
  it("documents every MCP tool and the current commit/handoff/init flags in printUsage()", () => {
    const cli = readRepoFile("src/cli.ts");
    const usage = cli.slice(
      cli.indexOf("function printUsage()"),
      cli.indexOf("async function handleInit"),
    );

    for (const tool of listMcpTools()) {
      expect(usage).toContain(tool.name);
    }
    expect(usage).toContain("--stage-allowed");
    expect(usage).toContain("--prompt");
    expect(usage).toContain("--protect-tokens");
  });

  it("pins the Biome $schema to the installed @biomejs/biome version", () => {
    const biome = JSON.parse(readRepoFile("biome.json")) as { $schema: string };
    const pkg = JSON.parse(readRepoFile("node_modules/@biomejs/biome/package.json")) as {
      version: string;
    };

    expect(biome.$schema).toContain(pkg.version);
  });
});
