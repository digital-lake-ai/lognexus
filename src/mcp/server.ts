import { createInterface } from "node:readline";
import { getMcpPrompt, listMcpPrompts, McpPromptError, type PromptResult } from "./prompts.js";
import { listMcpResources, McpResourceError, readMcpResource } from "./resources.js";
import {
  callMcpTool,
  isKnownTool,
  listMcpTools,
  MCP_SERVER_NAME,
  type ToolCallResult,
} from "./tools.js";

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_SERVER_VERSION = "1.0.0";

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_INTERNAL_ERROR = -32603;

type JsonRpcId = string | number;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId | null;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result: unknown;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools: Record<string, never>;
    resources: Record<string, never>;
    prompts: Record<string, never>;
  };
  serverInfo: { name: string; version: string };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function success(id: JsonRpcId | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  const error: JsonRpcFailure["error"] = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return { jsonrpc: "2.0", id, error };
}

function getPromptArgs(params: Record<string, unknown>): Record<string, string> {
  const raw = params.arguments;
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw)) {
    throw new McpPromptError("Parameter 'arguments' must be an object.");
  }

  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;
    args[key] = String(value);
  }
  return args;
}

function buildInitializeResult(): McpInitializeResult {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
    serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
  };
}

/**
 * Resolves a JSON-RPC method to its result payload.
 * Throws a JsonRpcFailure to short-circuit with an error response.
 */
async function dispatchRequest(
  method: string,
  params: Record<string, unknown>,
  targetDir: string,
): Promise<unknown> {
  switch (method) {
    case "initialize":
      return buildInitializeResult();

    case "ping":
      return {};

    case "tools/list":
      return { tools: listMcpTools() };

    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string" || name.trim() === "") {
        throw failure(
          null,
          JSON_RPC_INVALID_PARAMS,
          "Parameter 'name' must be a non-empty string.",
        );
      }
      if (!isKnownTool(name)) {
        const result: ToolCallResult = {
          content: [{ type: "text", text: `Unknown LogNexus tool: '${name}'.` }],
          isError: true,
        };
        return result;
      }
      const rawArgs = params.arguments;
      if (rawArgs !== undefined && rawArgs !== null && !isObject(rawArgs)) {
        throw failure(null, JSON_RPC_INVALID_PARAMS, "Parameter 'arguments' must be an object.");
      }
      return callMcpTool(name, (rawArgs as Record<string, unknown> | undefined) ?? {}, targetDir);
    }

    case "resources/list":
      return { resources: listMcpResources() };

    case "resources/read": {
      const uri = params.uri;
      if (typeof uri !== "string" || uri.trim() === "") {
        throw failure(null, JSON_RPC_INVALID_PARAMS, "Parameter 'uri' must be a non-empty string.");
      }
      try {
        return readMcpResource(uri, targetDir);
      } catch (error) {
        const message = error instanceof McpResourceError ? error.message : String(error);
        throw failure(null, JSON_RPC_INVALID_PARAMS, message);
      }
    }

    case "prompts/list":
      return { prompts: listMcpPrompts() };

    case "prompts/get": {
      const name = params.name;
      if (typeof name !== "string" || name.trim() === "") {
        throw failure(
          null,
          JSON_RPC_INVALID_PARAMS,
          "Parameter 'name' must be a non-empty string.",
        );
      }
      let prompt: PromptResult;
      try {
        prompt = getMcpPrompt(name, getPromptArgs(params));
      } catch (error) {
        const message = error instanceof McpPromptError ? error.message : String(error);
        throw failure(null, JSON_RPC_INVALID_PARAMS, message);
      }
      return prompt;
    }

    default:
      throw failure(null, JSON_RPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

/**
 * Processes a single newline-delimited JSON-RPC message.
 * Returns the serialized response, or null when no response must be written
 * (notifications and client responses).
 */
export async function processMcpMessage(
  rawMessage: string,
  targetDir: string = process.cwd(),
): Promise<string | null> {
  const trimmed = rawMessage.trim();
  if (trimmed === "") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return JSON.stringify(
      failure(null, JSON_RPC_PARSE_ERROR, "Parse error: invalid JSON payload."),
    );
  }

  if (!isObject(parsed)) {
    return JSON.stringify(
      failure(null, JSON_RPC_INVALID_REQUEST, "Invalid Request: expected a JSON object."),
    );
  }

  const hasMethod = typeof parsed.method === "string";
  const isNotification = hasMethod && !("id" in parsed);

  if (!isNotification && !("method" in parsed)) {
    return null;
  }

  const request = parsed as unknown as JsonRpcRequest;
  const rawId = request.id;
  const id: JsonRpcId | null =
    typeof rawId === "string" || typeof rawId === "number" ? rawId : null;

  if (!hasMethod || (request.method as string).trim() === "") {
    if (isNotification) return null;
    return JSON.stringify(
      failure(id, JSON_RPC_INVALID_REQUEST, "Invalid Request: 'method' must be a string."),
    );
  }

  const method = request.method;

  if ("jsonrpc" in parsed && parsed.jsonrpc !== "2.0") {
    if (isNotification) return null;
    return JSON.stringify(
      failure(id, JSON_RPC_INVALID_REQUEST, "Invalid Request: 'jsonrpc' must be \"2.0\"."),
    );
  }

  let params: Record<string, unknown> = {};
  if (request.params !== undefined && request.params !== null) {
    if (!isObject(request.params)) {
      if (isNotification) return null;
      return JSON.stringify(
        failure(id, JSON_RPC_INVALID_PARAMS, "Invalid params: 'params' must be an object."),
      );
    }
    params = request.params;
  }

  if (isNotification) {
    return null;
  }

  try {
    const result = await dispatchRequest(method, params, targetDir);
    return JSON.stringify(success(id, result));
  } catch (error) {
    if (isObject(error) && isObject(error.error) && typeof error.error.code === "number") {
      const payload = error as unknown as JsonRpcFailure;
      return JSON.stringify({ ...payload, id });
    }
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify(failure(id, JSON_RPC_INTERNAL_ERROR, `Internal error: ${message}`));
  }
}

export async function startMcpServer(targetDir: string = process.cwd()): Promise<void> {
  const rl = createInterface({ input: process.stdin, terminal: false });

  process.stderr.write(
    `${MCP_SERVER_NAME} MCP server v${MCP_SERVER_VERSION} listening on stdio (protocol ${MCP_PROTOCOL_VERSION}) — cwd: ${targetDir}\n`,
  );

  let queue: Promise<void> = Promise.resolve();

  rl.on("line", (line) => {
    queue = queue
      .then(async () => {
        const response = await processMcpMessage(line, targetDir);
        if (response !== null) {
          process.stdout.write(`${response}\n`);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Failed to process MCP message: ${message}\n`);
      });
  });

  await new Promise<void>((resolve) => {
    rl.on("close", () => resolve());
  });
}
