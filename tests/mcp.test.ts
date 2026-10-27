import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { listMcpPrompts, PromptResult } from "../src/mcp/prompts.js";
import type { listMcpResources, ResourceReadResult } from "../src/mcp/resources.js";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_VERSION, processMcpMessage } from "../src/mcp/server.js";
import type { listMcpTools, ToolCallResult } from "../src/mcp/tools.js";
import { saveState } from "../src/state/manager.js";

interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id: string | number | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let rpcId = 0;

async function rpc(
  method: string,
  params?: Record<string, unknown>,
  targetDir?: string,
): Promise<JsonRpcResponse> {
  rpcId += 1;
  const raw = JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params });
  const response = await processMcpMessage(raw, targetDir);
  expect(response).not.toBeNull();
  return JSON.parse(response as string) as JsonRpcResponse;
}

function toolText(result: ToolCallResult): string {
  return result.content.map((c) => c.text).join("\n");
}

describe("MCP Server (JSON-RPC 2.0 over stdio)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lognexus-mcp-test-"));
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: "ignore" });
    writeFileSync(join(tempDir, "file.txt"), "hello world", "utf8");
    execSync("git add file.txt", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "initial commit"', { cwd: tempDir, stdio: "ignore" });
    execSync("git checkout -b issue/15-mcp-branch", { cwd: tempDir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("initialize handshake", () => {
    it("advertises protocol 2024-11-05, capabilities and serverInfo", async () => {
      const res = await rpc("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }, tempDir);

      expect(res.jsonrpc).toBe("2.0");
      expect(res.error).toBeUndefined();

      const result = res.result as {
        protocolVersion: string;
        capabilities: Record<string, unknown>;
        serverInfo: { name: string; version: string };
      };

      expect(result.protocolVersion).toBe("2024-11-05");
      expect(result.capabilities).toHaveProperty("tools");
      expect(result.capabilities).toHaveProperty("resources");
      expect(result.capabilities).toHaveProperty("prompts");
      expect(result.serverInfo.name).toBe("lognexus");
      expect(result.serverInfo.version).toBe("1.2.5");
    });

    it("advertises the same version as the published package manifest", async () => {
      const res = await rpc("initialize", { protocolVersion: MCP_PROTOCOL_VERSION }, tempDir);
      const result = res.result as { serverInfo: { version: string } };
      const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

      expect(result.serverInfo.version).toBe(pkg.version);
      expect(MCP_SERVER_VERSION).toBe(pkg.version);
    });

    it("does not respond to the notifications/initialized notification", async () => {
      const response = await processMcpMessage(
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        tempDir,
      );
      expect(response).toBeNull();
    });
  });

  describe("ping", () => {
    it("returns an empty object", async () => {
      const res = await rpc("ping", undefined, tempDir);
      expect(res.result).toEqual({});
    });
  });

  describe("tools/list", () => {
    it("lists every mandatory LogNexus tool with a valid input schema", async () => {
      const res = await rpc("tools/list", undefined, tempDir);
      const { tools } = res.result as { tools: ReturnType<typeof listMcpTools> };

      const names = tools.map((t) => t.name);
      expect(names).toEqual([
        "lognexus_status",
        "lognexus_state_get",
        "lognexus_state_sync",
        "lognexus_state_set_task",
        "lognexus_state_finish_task",
        "lognexus_state_clear",
        "lognexus_commit",
        "lognexus_note_show",
        "lognexus_note_attach",
        "lognexus_timeline",
        "lognexus_audit",
        "lognexus_telemetry",
      ]);

      for (const tool of tools) {
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema.properties).toBeTypeOf("object");
      }

      const setTask = tools.find((t) => t.name === "lognexus_state_set_task");
      expect(setTask?.inputSchema.required).toEqual(["taskId"]);
    });
  });

  describe("tools/call", () => {
    it("executes lognexus_status against the target directory", async () => {
      const res = await rpc("tools/call", { name: "lognexus_status", arguments: {} }, tempDir);
      const result = res.result as ToolCallResult;

      expect(result.isError).toBeUndefined();
      expect(result.content[0].type).toBe("text");

      const status = JSON.parse(result.content[0].text) as {
        branch: string;
        isInsideGit: boolean;
        recommendedTier: string;
      };
      expect(status.isInsideGit).toBe(true);
      expect(typeof status.branch).toBe("string");
      expect(status.branch.length).toBeGreaterThan(0);
      expect(status.recommendedTier.length).toBeGreaterThan(0);
    });

    it("executes lognexus_state_get returning the persisted state", async () => {
      saveState(
        {
          schemaVersion: "1.0.0",
          activeIssue: {
            id: 7,
            title: "Native MCP Server",
            branch: "issue/7-mcp-server",
            phase: "commit",
            tier: "tier-3",
            readiness: "ready",
          },
          currentSubtask: null,
          completedSubtasks: [],
          lastSync: new Date().toISOString(),
        },
        tempDir,
      );

      const res = await rpc("tools/call", { name: "lognexus_state_get", arguments: {} }, tempDir);
      const result = res.result as ToolCallResult;
      expect(result.isError).toBeUndefined();

      const state = JSON.parse(result.content[0].text) as {
        activeIssue: { id: number; title: string } | null;
        completedSubtasks: string[];
      };
      expect(state.activeIssue?.id).toBe(7);
      expect(state.activeIssue?.title).toBe("Native MCP Server");
      expect(state.completedSubtasks).toEqual([]);
    });

    it("executes lognexus_state_sync without throwing", async () => {
      const res = await rpc("tools/call", { name: "lognexus_state_sync", arguments: {} }, tempDir);
      const result = res.result as ToolCallResult;
      expect(result.isError).toBeUndefined();

      const state = JSON.parse(result.content[0].text) as { schemaVersion: string };
      expect(state.schemaVersion).toBe("1.0.0");
    });

    it("sets and finishes a subtask through tools/call", async () => {
      const set = await rpc(
        "tools/call",
        {
          name: "lognexus_state_set_task",
          arguments: { taskId: "T1", title: "Implement MCP server" },
        },
        tempDir,
      );
      const setResult = set.result as ToolCallResult;
      expect(setResult.isError).toBeUndefined();

      const afterSet = JSON.parse(setResult.content[0].text) as {
        currentSubtask: { id: string; title: string; status: string } | null;
      };
      expect(afterSet.currentSubtask?.id).toBe("T1");
      expect(afterSet.currentSubtask?.title).toBe("Implement MCP server");
      expect(afterSet.currentSubtask?.status).toBe("in-progress");

      const finish = await rpc(
        "tools/call",
        { name: "lognexus_state_finish_task", arguments: { taskId: "T1" } },
        tempDir,
      );
      const finishResult = finish.result as ToolCallResult;
      expect(finishResult.isError).toBeUndefined();

      const afterFinish = JSON.parse(finishResult.content[0].text) as {
        currentSubtask: { id: string; status: string } | null;
        completedSubtasks: string[];
      };
      expect(afterFinish.currentSubtask?.status).toBe("completed");
      expect(afterFinish.completedSubtasks).toContain("T1");
    });

    it("sets a subtask contract and tier through lognexus_state_set_task", async () => {
      const res = await rpc(
        "tools/call",
        {
          name: "lognexus_state_set_task",
          arguments: {
            taskId: "T2",
            title: "Contract via MCP",
            tier: "tier-2",
            allowedFiles: ["src/state/manager.ts"],
            forbiddenFiles: ["package.json"],
            decisionBudget: "narrow",
            verificationCmd: "npm test",
          },
        },
        tempDir,
      );
      const result = res.result as ToolCallResult;
      expect(result.isError).toBeUndefined();

      const state = JSON.parse(result.content[0].text) as {
        activeIssue: { id: number; tier: string } | null;
        currentSubtask: { id: string; contract: Record<string, unknown> } | null;
      };

      expect(state.currentSubtask?.id).toBe("T2");
      expect(state.currentSubtask?.contract).toEqual({
        allowedFiles: ["src/state/manager.ts"],
        forbiddenFiles: ["package.json"],
        decisionBudget: "narrow",
        verificationCmd: "npm test",
      });
      expect(state.activeIssue?.id).toBe(15);
      expect(state.activeIssue?.tier).toBe("tier-2");
    });

    it("rejects an invalid tier for lognexus_state_set_task", async () => {
      const res = await rpc(
        "tools/call",
        { name: "lognexus_state_set_task", arguments: { taskId: "T1", tier: "tier-9" } },
        tempDir,
      );
      const result = res.result as ToolCallResult;
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain("tier");
    });

    it("rejects lognexus_state_set_task without a taskId", async () => {
      const res = await rpc(
        "tools/call",
        { name: "lognexus_state_set_task", arguments: {} },
        tempDir,
      );
      const result = res.result as ToolCallResult;
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain("taskId");
    });

    it("clears the state through tools/call", async () => {
      await rpc(
        "tools/call",
        { name: "lognexus_state_set_task", arguments: { taskId: "T1" } },
        tempDir,
      );

      const res = await rpc("tools/call", { name: "lognexus_state_clear", arguments: {} }, tempDir);
      const result = res.result as ToolCallResult;
      expect(result.isError).toBeUndefined();
      expect(toolText(result)).toContain("state cleared");

      const state = await rpc("tools/call", { name: "lognexus_state_get" }, tempDir);
      const read = JSON.parse((state.result as ToolCallResult).content[0].text) as {
        currentSubtask: unknown;
        completedSubtasks: string[];
      };
      expect(read.currentSubtask).toBeNull();
      expect(read.completedSubtasks).toEqual([]);
    });

    it("attaches and reads a Git Note through tools/call", async () => {
      const attach = await rpc(
        "tools/call",
        { name: "lognexus_note_attach", arguments: { commitRef: "HEAD" } },
        tempDir,
      );
      expect((attach.result as ToolCallResult).isError).toBeUndefined();

      const show = await rpc(
        "tools/call",
        { name: "lognexus_note_show", arguments: { commitRef: "HEAD" } },
        tempDir,
      );
      const showResult = show.result as ToolCallResult;
      expect(showResult.isError).toBeUndefined();

      const payload = JSON.parse(showResult.content[0].text) as { generator: string };
      expect(payload.generator).toBe("LogNexus");
    });

    it("executes lognexus_commit atomically through tools/call", async () => {
      writeFileSync(join(tempDir, "commit_file.txt"), "atomic commit content", "utf8");
      execSync("git add commit_file.txt", { cwd: tempDir, stdio: "ignore" });

      const res = await rpc(
        "tools/call",
        {
          name: "lognexus_commit",
          arguments: {
            message: "feat(#15/T1): add atomic commit",
            author: "gemini/flash (mcp)",
            reviewer: "gemini/pro (review-gate)",
            finishTask: true,
          },
        },
        tempDir,
      );
      const result = res.result as ToolCallResult;
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(toolText(result)) as {
        sha: string;
        shortSha: string;
        noteAttached: boolean;
      };
      expect(payload.sha).toHaveLength(40);
      expect(payload.noteAttached).toBe(true);
    });

    it("executes lognexus_timeline returning markdown table", async () => {
      const res = await rpc("tools/call", { name: "lognexus_timeline", arguments: {} }, tempDir);
      const result = res.result as ToolCallResult;
      expect(result.isError).toBeUndefined();
      expect(toolText(result)).toContain("| Commit | Subtask | Summary | Tier | Author | Note |");
    });

    it("executes lognexus_audit returning audit results", async () => {
      execSync("git checkout -b feature/audit-check", { cwd: tempDir, stdio: "ignore" });
      const res = await rpc("tools/call", { name: "lognexus_audit", arguments: {} }, tempDir);
      const result = res.result as ToolCallResult;
      expect(result.isError).toBeUndefined();
      expect(toolText(result)).toContain("[PASS]");
    });

    it("executes lognexus_telemetry tool actions through tools/call", async () => {
      // 1. Initial status is off
      const statusRes = await rpc(
        "tools/call",
        { name: "lognexus_telemetry", arguments: { action: "status" } },
        tempDir,
      );
      const statusResult = statusRes.result as ToolCallResult;
      expect(statusResult.isError).toBeUndefined();
      expect(toolText(statusResult)).toContain('"mode": "off"');

      // 2. Enable local telemetry
      const enableRes = await rpc(
        "tools/call",
        { name: "lognexus_telemetry", arguments: { action: "enable" } },
        tempDir,
      );
      const enableResult = enableRes.result as ToolCallResult;
      expect(enableResult.isError).toBeUndefined();
      expect(toolText(enableResult)).toContain("Telemetry enabled in 'local' mode");

      // 3. Inspect zero-pii payload
      const inspectRes = await rpc(
        "tools/call",
        { name: "lognexus_telemetry", arguments: { action: "inspect" } },
        tempDir,
      );
      const inspectResult = inspectRes.result as ToolCallResult;
      expect(inspectResult.isError).toBeUndefined();
      expect(toolText(inspectResult)).toContain("anonymousProjectId");

      // 4. Generate report
      const reportRes = await rpc(
        "tools/call",
        { name: "lognexus_telemetry", arguments: { action: "report" } },
        tempDir,
      );
      const reportResult = reportRes.result as ToolCallResult;
      expect(reportResult.isError).toBeUndefined();
      expect(toolText(reportResult)).toContain("LogNexus Telemetry & ROI Performance Report");

      // 5. Disable telemetry
      const disableRes = await rpc(
        "tools/call",
        { name: "lognexus_telemetry", arguments: { action: "disable" } },
        tempDir,
      );
      const disableResult = disableRes.result as ToolCallResult;
      expect(disableResult.isError).toBeUndefined();
      expect(toolText(disableResult)).toContain("Telemetry disabled");
    });

    it("returns an error result for an unknown tool name", async () => {
      const res = await rpc("tools/call", { name: "lognexus_does_not_exist" }, tempDir);
      const result = res.result as ToolCallResult;
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain("lognexus_does_not_exist");
    });

    it("rejects a non-object arguments payload with -32602", async () => {
      const res = await rpc(
        "tools/call",
        { name: "lognexus_status", arguments: "not-an-object" },
        tempDir,
      );
      expect(res.error?.code).toBe(-32602);
    });
  });

  describe("resources", () => {
    it("lists lognexus://state and lognexus://routing", async () => {
      const res = await rpc("resources/list", undefined, tempDir);
      const { resources } = res.result as { resources: ReturnType<typeof listMcpResources> };

      expect(resources.map((r) => r.uri)).toEqual(["lognexus://state", "lognexus://routing"]);
      expect(resources.find((r) => r.uri === "lognexus://state")?.mimeType).toBe(
        "application/json",
      );
      expect(resources.find((r) => r.uri === "lognexus://routing")?.mimeType).toBe("text/markdown");
    });

    it("reads lognexus://state as JSON matching the persisted state", async () => {
      saveState(
        {
          schemaVersion: "1.0.0",
          activeIssue: {
            id: 11,
            title: "Resource Test",
            branch: "issue/11-resource-test",
            phase: "branch",
            tier: "tier-2",
            readiness: "ready",
          },
          currentSubtask: null,
          completedSubtasks: ["T1"],
          lastSync: new Date().toISOString(),
        },
        tempDir,
      );

      const res = await rpc("resources/read", { uri: "lognexus://state" }, tempDir);
      const { contents } = res.result as ResourceReadResult;

      expect(contents).toHaveLength(1);
      expect(contents[0].uri).toBe("lognexus://state");
      expect(contents[0].mimeType).toBe("application/json");

      const state = JSON.parse(contents[0].text) as {
        activeIssue: { id: number } | null;
        completedSubtasks: string[];
      };
      expect(state.activeIssue?.id).toBe(11);
      expect(state.completedSubtasks).toEqual(["T1"]);
    });

    it("returns the default routing template when .lognexus/routing.md is missing", async () => {
      const res = await rpc("resources/read", { uri: "lognexus://routing" }, tempDir);
      const { contents } = res.result as ResourceReadResult;

      expect(contents[0].mimeType).toBe("text/markdown");
      expect(contents[0].text).toContain("tier-1");
      expect(contents[0].text).toContain("tier-3");
      expect(contents[0].text).toContain("routing: confirm");
    });

    it("returns the project routing file when it exists", async () => {
      mkdirSync(join(tempDir, ".lognexus"), { recursive: true });
      writeFileSync(join(tempDir, ".lognexus", "routing.md"), "# Custom\nrouting: off\n", "utf8");

      const res = await rpc("resources/read", { uri: "lognexus://routing" }, tempDir);
      const { contents } = res.result as ResourceReadResult;
      expect(contents[0].text).toContain("routing: off");
      expect(contents[0].text).not.toContain("Default routing template");
    });

    it("rejects an unknown resource URI with -32602", async () => {
      const res = await rpc("resources/read", { uri: "lognexus://unknown" }, tempDir);
      expect(res.error?.code).toBe(-32602);
      expect(res.error?.message).toContain("lognexus://unknown");
    });
  });

  describe("prompts", () => {
    it("lists lognexus-plan and lognexus-review", async () => {
      const res = await rpc("prompts/list", undefined, tempDir);
      const { prompts } = res.result as { prompts: ReturnType<typeof listMcpPrompts> };

      expect(prompts.map((p) => p.name)).toEqual(["lognexus-plan", "lognexus-review"]);
      for (const prompt of prompts) {
        expect(prompt.description.length).toBeGreaterThan(0);
        expect(Array.isArray(prompt.arguments)).toBe(true);
      }
    });

    it("gets the lognexus-plan prompt with tier contracts", async () => {
      const res = await rpc(
        "prompts/get",
        { name: "lognexus-plan", arguments: { issue: "#7", context: "Native MCP server" } },
        tempDir,
      );
      const prompt = res.result as PromptResult;

      expect(prompt.messages).toHaveLength(1);
      expect(prompt.messages[0].role).toBe("user");
      const text = prompt.messages[0].content.text;
      expect(text).toContain("#7");
      expect(text).toContain("Native MCP server");
      expect(text).toContain("[tier-X]");
      expect(text).toContain("Allowed files");
      expect(text).toContain("Decision budget");
    });

    it("gets the lognexus-review prompt with the gate checklist", async () => {
      const res = await rpc(
        "prompts/get",
        { name: "lognexus-review", arguments: { target: "issue/7-mcp-server" } },
        tempDir,
      );
      const prompt = res.result as PromptResult;

      expect(prompt.messages).toHaveLength(1);
      const text = prompt.messages[0].content.text;
      expect(text).toContain("issue/7-mcp-server");
      expect(text).toContain("review gate");
      expect(text).toContain("Verdict");
      expect(text).toContain("npm test");
    });

    it("rejects an unknown prompt name with -32602", async () => {
      const res = await rpc("prompts/get", { name: "lognexus-unknown" }, tempDir);
      expect(res.error?.code).toBe(-32602);
    });
  });

  describe("JSON-RPC protocol errors", () => {
    it("returns -32601 for an unknown method", async () => {
      const res = await rpc("does/not/exist", undefined, tempDir);
      expect(res.jsonrpc).toBe("2.0");
      expect(res.error?.code).toBe(-32601);
      expect(res.error?.message).toContain("does/not/exist");
      expect(res.result).toBeUndefined();
    });

    it("returns -32700 for malformed JSON", async () => {
      const response = await processMcpMessage("{ this is not json", tempDir);
      const parsed = JSON.parse(response as string) as JsonRpcResponse;
      expect(parsed.error?.code).toBe(-32700);
      expect(parsed.id).toBeNull();
    });

    it("returns -32600 for a message without method", async () => {
      const response = await processMcpMessage(JSON.stringify({ jsonrpc: "2.0", id: 1 }), tempDir);
      expect(response).toBeNull();

      const responseWithId = await processMcpMessage(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: 42 }),
        tempDir,
      );
      const parsed = JSON.parse(responseWithId as string) as JsonRpcResponse;
      expect(parsed.error?.code).toBe(-32600);
    });

    it("ignores blank lines and client responses", async () => {
      expect(await processMcpMessage("   ", tempDir)).toBeNull();
      expect(
        await processMcpMessage(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), tempDir),
      ).toBeNull();
    });

    it("preserves string ids and echoes them back", async () => {
      const response = await processMcpMessage(
        JSON.stringify({ jsonrpc: "2.0", id: "abc-123", method: "ping" }),
        tempDir,
      );
      const parsed = JSON.parse(response as string) as JsonRpcResponse;
      expect(parsed.id).toBe("abc-123");
      expect(parsed.result).toEqual({});
    });

    it("emits a single-line response with no embedded newlines", async () => {
      const response = await processMcpMessage(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        tempDir,
      );
      expect(response).not.toBeNull();
      expect((response as string).includes("\n")).toBe(false);
    });
  });
});
