import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditBranch } from "../src/audit/audit.js";
import { getCliVersion } from "../src/cli.js";
import { runDiagnostics } from "../src/doctor.js";
import { MCP_SERVER_VERSION, processMcpMessage } from "../src/mcp/server.js";
import type { ToolCallResult } from "../src/mcp/tools.js";
import { attachCurrentStateToCommit } from "../src/notes/attach.js";
import { getNote } from "../src/notes/notes.js";
import { initProject } from "../src/scaffold.js";
import { clearState, finishSubtask, loadState, setSubtask } from "../src/state/manager.js";
import { getProjectStatus } from "../src/status.js";
import { getJourneyTimeline } from "../src/timeline/timeline.js";

function commitFile(targetDir: string, fileName: string, content: string, message: string): string {
  writeFileSync(join(targetDir, fileName), content, "utf8");
  execSync(`git add ${fileName}`, { cwd: targetDir, stdio: "ignore" });
  const messageFile = join(tmpdir(), `lognexus-e2e-msg-${Date.now()}-${Math.random()}.txt`);
  writeFileSync(messageFile, message, "utf8");
  try {
    execSync(`git commit -F "${messageFile}"`, { cwd: targetDir, stdio: "ignore" });
  } finally {
    rmSync(messageFile, { force: true });
  }
  return execSync("git rev-parse HEAD", { cwd: targetDir, encoding: "utf8" }).trim();
}

describe("LogNexus End-to-End (E2E) Golden Path Lifecycle", () => {
  let tempDir: string;
  let baseBranch: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-e2e-test-"));
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Digital Lake"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "dev@digital-lake.ai"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config commit.gpgsign "false"', { cwd: tempDir, stdio: "ignore" });

    commitFile(tempDir, "README.md", "# Test Project", "chore: initial commit");
    const current = execSync("git branch --show-current", {
      cwd: tempDir,
      encoding: "utf8",
    }).trim();
    baseBranch = current || "main";

    execSync("git checkout -b issue/42-auth-feature", { cwd: tempDir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("executes the full lifecycle: scaffold -> task tracking -> commit with note -> timeline -> audit -> mcp -> clear", async () => {
    // 1. Scaffold rules and routing
    const initRes = initProject(tempDir);
    expect(initRes.created).toContain(".lognexus/routing.md");

    // 2. Diagnostics
    const checks = runDiagnostics(tempDir);
    const gitCheck = checks.find((c) => c.name === "Git");
    const rulesCheck = checks.find((c) => c.name === "LogNexus Rules");
    expect(gitCheck?.status).toBe("pass");
    expect(rulesCheck?.status).toBe("pass");

    // 3. Project status detection
    const status = getProjectStatus(tempDir);
    expect(status.branch).toBe("issue/42-auth-feature");
    expect(status.activeIssue).toBe("#42");
    expect(status.routingMode).toBe("confirm");

    // 4. Set active subtask with closed contract
    const contract = {
      allowedFiles: ["auth.ts"],
      mustNotChange: ["package.json"],
    };
    setSubtask("T1", "Add user authentication", contract, tempDir);
    const stateDuring = loadState(tempDir);
    expect(stateDuring.currentSubtask?.id).toBe("T1");
    expect(stateDuring.currentSubtask?.title).toBe("Add user authentication");

    // 5. Commit scoped changes and attach Git Note
    const commitSha = commitFile(
      tempDir,
      "auth.ts",
      "export const auth = true;",
      "feat(#42/T1): add user authentication\n\nAuthored-by: deepseek/chat (kimi-code)\n",
    );
    const notePayload = attachCurrentStateToCommit("HEAD", { cwd: tempDir });
    expect(notePayload.generator).toBe("LogNexus");
    expect(notePayload.subtask?.id).toBe("T1");
    expect(notePayload.version).toBe("1.2.7");

    const noteRaw = getNote("HEAD", { cwd: tempDir });
    expect(noteRaw).not.toBeNull();
    expect(noteRaw).toContain("Add user authentication");

    // 6. Finish subtask
    finishSubtask("T1", tempDir);
    const stateAfter = loadState(tempDir);
    expect(stateAfter.currentSubtask?.status).toBe("completed");
    expect(stateAfter.completedSubtasks).toContain("T1");

    // 7. Reconstruct Journey Timeline
    const timeline = getJourneyTimeline(baseBranch, tempDir);
    expect(timeline.commitCount).toBe(1);
    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0].sha).toBe(commitSha);
    expect(timeline.items[0].taskId).toBe("T1");
    expect(timeline.items[0].hasNote).toBe(true);
    expect(timeline.markdownTable).toContain("| `T1` |");
    expect(timeline.markdownTable).toContain("| Yes |");
    expect(timeline.prBodyDraft).toContain("## Journey Timeline");

    // 8. Traceability Audit Gate
    const audit = auditBranch(baseBranch, tempDir);
    expect(audit.passed).toBe(true);
    expect(audit.violations).toEqual([]);
    expect(audit.summary.errors).toBe(0);

    // 9. Native MCP Server stdio interaction
    const mcpStatusRaw = await processMcpMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "lognexus_status", arguments: {} },
      }),
      tempDir,
    );
    expect(mcpStatusRaw).not.toBeNull();
    const mcpStatus = JSON.parse(mcpStatusRaw as string);
    expect(mcpStatus.result.content[0].text).toContain("issue/42-auth-feature");

    const mcpTimelineRaw = await processMcpMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "lognexus_timeline", arguments: { baseBranch } },
      }),
      tempDir,
    );
    expect(mcpTimelineRaw).not.toBeNull();
    const mcpTimeline = JSON.parse(mcpTimelineRaw as string);
    expect((mcpTimeline.result as ToolCallResult).content[0].text).toContain("`T1`");

    // 9b. Every published surface must advertise the same version (Glama handshake parity)
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const mcpInitializeRaw = await processMcpMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} }),
      tempDir,
    );
    const mcpInitialize = JSON.parse(mcpInitializeRaw as string);
    expect(mcpInitialize.result.serverInfo.version).toBe(pkg.version);
    expect(MCP_SERVER_VERSION).toBe(pkg.version);
    expect(getCliVersion()).toBe(pkg.version);

    // 10. Clear persistent state post-merge
    clearState(tempDir);
    const stateFinal = loadState(tempDir);
    expect(stateFinal.currentSubtask).toBeNull();
    expect(stateFinal.completedSubtasks).toEqual([]);
  }, 20000);
});
