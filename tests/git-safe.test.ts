import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rejectNotesReference, validateGitReference, verifyCommitish } from "../src/git/safe.js";

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
});
