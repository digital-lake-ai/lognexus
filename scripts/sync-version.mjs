import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const STRICT_SEMVER_RE = /^\d+\.\d+\.\d+$/;
const TOML_VERSION_LINE_RE = /^version[ \t]*=[ \t]*"([^"\r\n]*)"$/;
const PY_VERSION_LINE_RE = /^__version__[ \t]*=[ \t]*"([^"\r\n]*)"$/;
const CLI_RETURN_LINE_RE = /^return "([^"\r\n]*)";$/;

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function splitLines(text) {
  return text.split(/\r?\n/);
}

function readJsonFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing required file: ${label}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function findPyprojectVersionLine(lines) {
  let inProjectSection = false;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inProjectSection = trimmed === "[project]";
      continue;
    }
    if (!inProjectSection) {
      continue;
    }
    const match = TOML_VERSION_LINE_RE.exec(trimmed);
    if (match) {
      return { index: i, version: match[1] };
    }
  }
  return null;
}

function findPythonInitVersionLine(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const match = PY_VERSION_LINE_RE.exec(lines[i].trim());
    if (match) {
      return { index: i, version: match[1] };
    }
  }
  return null;
}

function findCliFallbackVersionLine(lines) {
  let startIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes("function getCliVersion(")) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    return null;
  }

  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (lines[i].trimEnd() === "}") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return null;
  }

  for (let i = startIdx + 1; i < endIdx; i += 1) {
    const match = CLI_RETURN_LINE_RE.exec(lines[i].trim());
    if (match) {
      return { index: i, version: match[1] };
    }
  }
  return null;
}

export function assertStrictSemver(version) {
  if (typeof version !== "string" || !STRICT_SEMVER_RE.test(version)) {
    throw new Error(
      `Invalid SemVer "${String(version)}": expected strict numeric X.Y.Z (e.g. 1.5.0).`,
    );
  }
}

export function readVersionSurfaces(rootDir) {
  const pkgPath = join(rootDir, "package.json");
  const lockPath = join(rootDir, "package-lock.json");
  const claudePluginPath = join(rootDir, ".claude-plugin", "plugin.json");
  const serverPath = join(rootDir, "server.json");
  const pyprojectPath = join(rootDir, "pyproject.toml");
  const pythonInitPath = join(rootDir, "python", "lognexus_mcp", "__init__.py");
  const cliPath = join(rootDir, "src", "cli.ts");

  const pkg = readJsonFile(pkgPath, "package.json");
  const claudePlugin = readJsonFile(claudePluginPath, ".claude-plugin/plugin.json");
  const server = readJsonFile(serverPath, "server.json");

  let packageLock;
  if (existsSync(lockPath)) {
    const lock = readJsonFile(lockPath, "package-lock.json");
    packageLock = {
      present: true,
      version: typeof lock.version === "string" ? lock.version : null,
      rootPackageVersion:
        typeof lock.packages?.[""]?.version === "string" ? lock.packages[""].version : null,
    };
  } else {
    packageLock = {
      present: false,
      version: null,
      rootPackageVersion: null,
    };
  }

  if (!existsSync(pyprojectPath)) {
    throw new Error("Missing required file: pyproject.toml");
  }
  const pyprojectLines = splitLines(readFileSync(pyprojectPath, "utf8"));
  const pyprojectMatch = findPyprojectVersionLine(pyprojectLines);

  if (!existsSync(pythonInitPath)) {
    throw new Error("Missing required file: python/lognexus_mcp/__init__.py");
  }
  const pythonInitLines = splitLines(readFileSync(pythonInitPath, "utf8"));
  const pythonInitMatch = findPythonInitVersionLine(pythonInitLines);

  if (!existsSync(cliPath)) {
    throw new Error("Missing required file: src/cli.ts");
  }
  const cliLines = splitLines(readFileSync(cliPath, "utf8"));
  const cliMatch = findCliFallbackVersionLine(cliLines);

  return {
    packageJson: {
      version: typeof pkg.version === "string" ? pkg.version : null,
      minCriticalVersion:
        typeof pkg.lognexusPolicy?.minCriticalVersion === "string"
          ? pkg.lognexusPolicy.minCriticalVersion
          : null,
    },
    packageLock,
    claudePlugin: {
      version: typeof claudePlugin.version === "string" ? claudePlugin.version : null,
    },
    serverJson: {
      version: typeof server.version === "string" ? server.version : null,
      packageVersions: Array.isArray(server.packages)
        ? server.packages.map((entry, index) => ({
            index,
            identifier: typeof entry?.identifier === "string" ? entry.identifier : String(index),
            version: typeof entry?.version === "string" ? entry.version : null,
          }))
        : [],
    },
    pyprojectToml: {
      version: pyprojectMatch ? pyprojectMatch.version : null,
    },
    pythonInit: {
      version: pythonInitMatch ? pythonInitMatch.version : null,
    },
    cliFallback: {
      version: cliMatch ? cliMatch.version : null,
    },
  };
}

export function checkVersionParity(rootDir) {
  const surfaces = readVersionSurfaces(rootDir);
  const expectedVersion = surfaces.packageJson.version;
  const mismatches = [];

  if (!expectedVersion || !STRICT_SEMVER_RE.test(expectedVersion)) {
    mismatches.push({
      surface: "package.json",
      actual: expectedVersion,
      expected: "strict X.Y.Z SemVer",
    });
  }

  if (surfaces.packageJson.minCriticalVersion !== "0.0.0") {
    mismatches.push({
      surface: "package.json#lognexusPolicy.minCriticalVersion",
      actual: surfaces.packageJson.minCriticalVersion,
      expected: "0.0.0",
    });
  }

  if (surfaces.packageLock.present) {
    if (surfaces.packageLock.version !== expectedVersion) {
      mismatches.push({
        surface: "package-lock.json",
        actual: surfaces.packageLock.version,
        expected: expectedVersion,
      });
    }
    if (surfaces.packageLock.rootPackageVersion !== expectedVersion) {
      mismatches.push({
        surface: 'package-lock.json#packages[""]',
        actual: surfaces.packageLock.rootPackageVersion,
        expected: expectedVersion,
      });
    }
  }

  if (surfaces.claudePlugin.version !== expectedVersion) {
    mismatches.push({
      surface: ".claude-plugin/plugin.json",
      actual: surfaces.claudePlugin.version,
      expected: expectedVersion,
    });
  }

  if (surfaces.serverJson.version !== expectedVersion) {
    mismatches.push({
      surface: "server.json",
      actual: surfaces.serverJson.version,
      expected: expectedVersion,
    });
  }

  if (surfaces.serverJson.packageVersions.length === 0) {
    mismatches.push({
      surface: "server.json#packages",
      actual: null,
      expected: expectedVersion,
    });
  } else {
    for (const entry of surfaces.serverJson.packageVersions) {
      if (entry.version !== expectedVersion) {
        mismatches.push({
          surface: `server.json#packages[${entry.index}] (${entry.identifier})`,
          actual: entry.version,
          expected: expectedVersion,
        });
      }
    }
  }

  if (surfaces.pyprojectToml.version !== expectedVersion) {
    mismatches.push({
      surface: "pyproject.toml",
      actual: surfaces.pyprojectToml.version,
      expected: expectedVersion,
    });
  }

  if (surfaces.pythonInit.version !== expectedVersion) {
    mismatches.push({
      surface: "python/lognexus_mcp/__init__.py",
      actual: surfaces.pythonInit.version,
      expected: expectedVersion,
    });
  }

  if (surfaces.cliFallback.version !== expectedVersion) {
    mismatches.push({
      surface: "src/cli.ts#getCliVersion",
      actual: surfaces.cliFallback.version,
      expected: expectedVersion,
    });
  }

  return {
    ok: mismatches.length === 0,
    expectedVersion,
    minCriticalVersion: surfaces.packageJson.minCriticalVersion,
    mismatches,
    surfaces,
  };
}

export function syncVersionSurfaces(rootDir, nextVersion) {
  assertStrictSemver(nextVersion);

  const pkgPath = join(rootDir, "package.json");
  const lockPath = join(rootDir, "package-lock.json");
  const claudePluginPath = join(rootDir, ".claude-plugin", "plugin.json");
  const serverPath = join(rootDir, "server.json");
  const pyprojectPath = join(rootDir, "pyproject.toml");
  const pythonInitPath = join(rootDir, "python", "lognexus_mcp", "__init__.py");
  const cliPath = join(rootDir, "src", "cli.ts");

  // Stage all updates in memory first so validation errors never leave partial writes.
  const pendingWrites = [];

  const pkg = readJsonFile(pkgPath, "package.json");
  pkg.version = nextVersion;
  if (!pkg.lognexusPolicy || typeof pkg.lognexusPolicy !== "object") {
    pkg.lognexusPolicy = {};
  }
  pkg.lognexusPolicy.minCriticalVersion = "0.0.0";
  pendingWrites.push({
    relativePath: "package.json",
    fullPath: pkgPath,
    content: `${JSON.stringify(pkg, null, 2)}\n`,
  });

  if (existsSync(lockPath)) {
    const lock = readJsonFile(lockPath, "package-lock.json");
    lock.version = nextVersion;
    if (lock.packages && typeof lock.packages === "object" && lock.packages[""]) {
      lock.packages[""].version = nextVersion;
    }
    pendingWrites.push({
      relativePath: "package-lock.json",
      fullPath: lockPath,
      content: `${JSON.stringify(lock, null, 2)}\n`,
    });
  }

  const claudePlugin = readJsonFile(claudePluginPath, ".claude-plugin/plugin.json");
  claudePlugin.version = nextVersion;
  pendingWrites.push({
    relativePath: ".claude-plugin/plugin.json",
    fullPath: claudePluginPath,
    content: `${JSON.stringify(claudePlugin, null, 2)}\n`,
  });

  const server = readJsonFile(serverPath, "server.json");
  server.version = nextVersion;
  if (!Array.isArray(server.packages) || server.packages.length === 0) {
    throw new Error("Invalid server.json: expected non-empty packages array.");
  }
  for (const entry of server.packages) {
    if (entry && typeof entry === "object") {
      entry.version = nextVersion;
    }
  }
  pendingWrites.push({
    relativePath: "server.json",
    fullPath: serverPath,
    content: `${JSON.stringify(server, null, 2)}\n`,
  });

  if (!existsSync(pyprojectPath)) {
    throw new Error("Missing required file: pyproject.toml");
  }
  const pyprojectRaw = readFileSync(pyprojectPath, "utf8");
  const pyprojectEol = detectEol(pyprojectRaw);
  const pyprojectLines = splitLines(pyprojectRaw);
  const pyprojectMatch = findPyprojectVersionLine(pyprojectLines);
  if (!pyprojectMatch) {
    throw new Error("Unable to locate [project] version line in pyproject.toml.");
  }
  pyprojectLines[pyprojectMatch.index] = `version = "${nextVersion}"`;
  pendingWrites.push({
    relativePath: "pyproject.toml",
    fullPath: pyprojectPath,
    content: pyprojectLines.join(pyprojectEol),
  });

  if (!existsSync(pythonInitPath)) {
    throw new Error("Missing required file: python/lognexus_mcp/__init__.py");
  }
  const pythonInitRaw = readFileSync(pythonInitPath, "utf8");
  const pythonInitEol = detectEol(pythonInitRaw);
  const pythonInitLines = splitLines(pythonInitRaw);
  const pythonInitMatch = findPythonInitVersionLine(pythonInitLines);
  if (!pythonInitMatch) {
    throw new Error("Unable to locate __version__ line in python/lognexus_mcp/__init__.py.");
  }
  pythonInitLines[pythonInitMatch.index] = `__version__ = "${nextVersion}"`;
  pendingWrites.push({
    relativePath: "python/lognexus_mcp/__init__.py",
    fullPath: pythonInitPath,
    content: pythonInitLines.join(pythonInitEol),
  });

  if (!existsSync(cliPath)) {
    throw new Error("Missing required file: src/cli.ts");
  }
  const cliRaw = readFileSync(cliPath, "utf8");
  const cliEol = detectEol(cliRaw);
  const cliLines = splitLines(cliRaw);
  const cliMatch = findCliFallbackVersionLine(cliLines);
  if (!cliMatch) {
    throw new Error("Unable to locate fallback return statement inside getCliVersion() in src/cli.ts.");
  }
  const indentLength = cliLines[cliMatch.index].length - cliLines[cliMatch.index].trimStart().length;
  const indent = cliLines[cliMatch.index].slice(0, indentLength);
  cliLines[cliMatch.index] = `${indent}return "${nextVersion}";`;
  pendingWrites.push({
    relativePath: "src/cli.ts",
    fullPath: cliPath,
    content: cliLines.join(cliEol),
  });

  for (const item of pendingWrites) {
    writeFileSync(item.fullPath, item.content, "utf8");
  }

  return {
    version: nextVersion,
    updatedFiles: pendingWrites.map((item) => item.relativePath),
  };
}

function isDirectExecution() {
  const argv1 = process.argv[1];
  if (!argv1) {
    return false;
  }
  try {
    const currentUrl = pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
    const entryUrl = pathToFileURL(realpathSync(resolve(argv1))).href;
    return currentUrl === entryUrl;
  } catch {
    return import.meta.url === pathToFileURL(resolve(argv1)).href;
  }
}

function runCli() {
  const args = process.argv.slice(2);
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  if (args.length !== 1) {
    console.error("Usage: node scripts/sync-version.mjs [--check | <X.Y.Z>]");
    process.exitCode = 1;
    return;
  }

  const arg = args[0];
  if (arg === "--check") {
    const result = checkVersionParity(rootDir);
    if (result.ok) {
      console.log(`[PASS] All 7 version surfaces match (${result.expectedVersion})`);
      process.exitCode = 0;
      return;
    }
    console.error(
      `[FAIL] Version parity mismatch (expected ${result.expectedVersion ?? "unknown"}):`,
    );
    for (const mismatch of result.mismatches) {
      console.error(
        `  - ${mismatch.surface}: got ${JSON.stringify(mismatch.actual)}, expected ${JSON.stringify(mismatch.expected)}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  try {
    const updated = syncVersionSurfaces(rootDir, arg);
    console.log(
      `[PASS] Synced ${updated.updatedFiles.length} version surfaces to ${updated.version}`,
    );
    process.exitCode = 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
  }
}

if (isDirectExecution()) {
  runCli();
}
