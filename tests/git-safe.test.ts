import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectBaseBranch,
  fetchNpmPackagePolicy,
  rejectNotesReference,
  resolveNpmCliScript,
  validateGitReference,
  verifyCommitish,
} from "../src/git/safe.js";

describe("Unified Git reference guard (src/git/safe.ts)", () => {
  describe("validateGitReference — accepted references", () => {
    it("accepts plain branch names, remotes, tags and SHAs", () => {
      expect(validateGitReference("main")).toBe("main");
      expect(validateGitReference("origin/main")).toBe("origin/main");
      expect(validateGitReference("v1.2.3")).toBe("v1.2.3");
      expect(validateGitReference("HEAD")).toBe("HEAD");
      expect(validateGitReference("0303b48")).toBe("0303b48");
      expect(validateGitReference("feature/sub_task-1.0")).toBe("feature/sub_task-1.0");
    });

    it("accepts both scoped lanes", () => {
      expect(validateGitReference("issue/21-security-command-injection-fix")).toBe(
        "issue/21-security-command-injection-fix",
      );
      expect(validateGitReference("security/22-audit-and-supply-chain")).toBe(
        "security/22-audit-and-supply-chain",
      );
    });

    it("accepts the default notes ref, which is not a base-branch concern", () => {
      expect(validateGitReference("refs/notes/lognexus")).toBe("refs/notes/lognexus");
    });

    it("trims surrounding whitespace", () => {
      expect(validateGitReference("  main  ")).toBe("main");
    });
  });

  describe("validateGitReference — rejected references", () => {
    const hostile = [
      ["empty string", ""],
      ["whitespace only", "   "],
      ["leading dash (flag injection)", "--upload-pack=evil"],
      ["single leading dash", "-D"],
      ["shell separator", "main; echo pwned"],
      ["command substitution", "main$(whoami)"],
      ["backtick execution", "main`id`"],
      ["pipe", "main | cat /etc/passwd"],
      ["newline injection", "main\nrm -rf"],
      ["revision range", "main..HEAD"],
      ["reflog operator", "main@{1}"],
      ["consecutive slashes", "refs//heads/main"],
      ["trailing slash", "feature/"],
      ["reserved .lock suffix", "main.lock"],
      ["trailing dot", "main."],
      ["space inside", "ma in"],
      ["glob character", "main*"],
      ["question mark", "main?"],
    ] as const;

    for (const [label, ref] of hostile) {
      it(`rejects ${label}`, () => {
        expect(() => validateGitReference(ref)).toThrow(/Governance violation/);
      });
    }

    it("names the offending reference in the error message", () => {
      expect(() => validateGitReference("main; echo pwned")).toThrow(/main; echo pwned/);
    });
  });

  describe("rejectNotesReference", () => {
    it("rejects refs under refs/notes/ as a base branch", () => {
      expect(() => rejectNotesReference("refs/notes/lognexus")).toThrow(/Git Notes ref/);
      expect(() => rejectNotesReference("refs/notes")).toThrow(/Git Notes ref/);
    });

    it("passes through ordinary base branches", () => {
      expect(rejectNotesReference("main")).toBe("main");
      expect(rejectNotesReference("origin/main")).toBe("origin/main");
    });

    it("still applies the strict reference guard first", () => {
      expect(() => rejectNotesReference("main..HEAD")).toThrow(/Governance violation/);
    });
  });

  describe("verifyCommitish", () => {
    let repoDir: string;
    let commitSha: string;

    beforeEach(() => {
      repoDir = mkdtempSync(join(tmpdir(), "lognexus-git-safe-"));
      execSync("git init -q", { cwd: repoDir, stdio: "ignore" });
      execSync("git config user.email safe@example.com", { cwd: repoDir, stdio: "ignore" });
      execSync("git config user.name 'Safe Runner'", { cwd: repoDir, stdio: "ignore" });
      execSync("git config commit.gpgsign false", { cwd: repoDir, stdio: "ignore" });
      writeFileSync(join(repoDir, "README.md"), "# safe\n", "utf8");
      execSync("git add README.md", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -qm "docs: init"', { cwd: repoDir, stdio: "ignore" });
      commitSha = execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf8" }).trim();
    });

    afterEach(() => {
      rmSync(repoDir, { recursive: true, force: true });
    });

    it("resolves a branch name to its commit SHA", () => {
      const resolved = verifyCommitish("HEAD", repoDir);
      expect(resolved).toBe(commitSha);
    });

    it("resolves a short SHA to the full commit SHA", () => {
      expect(verifyCommitish(commitSha.slice(0, 7), repoDir)).toBe(commitSha);
    });

    it("rejects a reference that does not exist", () => {
      expect(() => verifyCommitish("no-such-branch", repoDir)).toThrow(
        /does not resolve to a commit/,
      );
    });

    it("rejects a name that resolves to a tree, not a commit", () => {
      const treeSha = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
        cwd: repoDir,
        encoding: "utf8",
        shell: false,
      }).trim();
      expect(() => verifyCommitish(treeSha, repoDir)).toThrow(/does not resolve to a commit/);
    });

    it("rejects an unsafe reference before ever shelling out", () => {
      expect(() => verifyCommitish("main..HEAD", repoDir)).toThrow(/Governance violation/);
      expect(() => verifyCommitish("--help", repoDir)).toThrow(/Governance violation/);
    });
  });

  describe("detectBaseBranch", () => {
    let repoDir: string;

    beforeEach(() => {
      repoDir = mkdtempSync(join(tmpdir(), "lognexus-detect-base-"));
      execSync("git init -q", { cwd: repoDir, stdio: "ignore" });
      execSync("git config user.email safe@example.com", { cwd: repoDir, stdio: "ignore" });
      execSync("git config user.name 'Safe Runner'", { cwd: repoDir, stdio: "ignore" });
      execSync("git config commit.gpgsign false", { cwd: repoDir, stdio: "ignore" });
      writeFileSync(join(repoDir, "README.md"), "# safe\n", "utf8");
      execSync("git add README.md", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -qm "docs: init"', { cwd: repoDir, stdio: "ignore" });
    });

    afterEach(() => {
      rmSync(repoDir, { recursive: true, force: true });
    });

    it("prefers main when both main and master exist", () => {
      execSync("git branch -m master", { cwd: repoDir, stdio: "ignore" });
      execSync("git branch main", { cwd: repoDir, stdio: "ignore" });
      expect(detectBaseBranch(repoDir)).toBe("main");
    });

    it("falls back to master when only master exists", () => {
      execSync("git branch -m master", { cwd: repoDir, stdio: "ignore" });
      expect(detectBaseBranch(repoDir)).toBe("master");
    });

    it("defaults to main when neither candidate exists", () => {
      execSync("git branch -m trunk", { cwd: repoDir, stdio: "ignore" });
      expect(detectBaseBranch(repoDir)).toBe("main");
    });
  });

  describe("resolveNpmCliScript", () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "lognexus-npm-cli-"));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    function touch(filePath: string): string {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, "", "utf8");
      return filePath;
    }

    it("prefers npm_execpath when it points at a real JavaScript entrypoint", () => {
      const script = touch(join(root, "custom", "npm-cli.js"));
      expect(resolveNpmCliScript(join(root, "bin", "node"), { npm_execpath: script })).toBe(script);
    });

    it("ignores npm_execpath when it is not a JavaScript file", () => {
      const shim = touch(join(root, "custom", "npm"));
      expect(resolveNpmCliScript(join(root, "bin", "node"), { npm_execpath: shim })).toBeNull();
    });

    it("ignores npm_execpath when the file does not exist", () => {
      const missing = join(root, "custom", "npm-cli.js");
      expect(resolveNpmCliScript(join(root, "bin", "node"), { npm_execpath: missing })).toBeNull();
    });

    it("finds the Windows layout next to the node binary", () => {
      const execPath = touch(join(root, "nodejs", "node.exe"));
      const script = touch(join(root, "nodejs", "node_modules", "npm", "bin", "npm-cli.js"));
      expect(resolveNpmCliScript(execPath, {})).toBe(script);
    });

    it("finds the Unix layout one level above the node binary", () => {
      const execPath = touch(join(root, "usr", "bin", "node"));
      const script = touch(
        join(root, "usr", "bin", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
      );
      expect(resolveNpmCliScript(execPath, {})).toBe(script);
    });

    it("returns null when no npm installation can be located", () => {
      const execPath = touch(join(root, "bare", "bin", "node"));
      expect(resolveNpmCliScript(execPath, {})).toBeNull();
    });
  });

  describe("fetchNpmPackagePolicy", () => {
    it("rejects malformed package names before spawning npm", () => {
      expect(fetchNpmPackagePolicy("")).toBeNull();
      expect(fetchNpmPackagePolicy("-g evil")).toBeNull();
      expect(fetchNpmPackagePolicy("@scope/../..")).toBeNull();
      expect(fetchNpmPackagePolicy("pkg; rm -rf /")).toBeNull();
    });

    it("accepts the legacy cwd argument without failing", () => {
      const dir = mkdtempSync(join(tmpdir(), "lognexus-npm-policy-"));
      try {
        const result = fetchNpmPackagePolicy("lognexus-nonexistent-fixture-package-xyz", dir);
        expect(result).toBeNull();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
