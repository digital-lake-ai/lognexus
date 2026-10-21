import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_ROUTING_TEMPLATE } from "../scaffold.js";
import { loadState } from "../state/manager.js";

export const MCP_RESOURCE_PREFIX = "lognexus://";
export const STATE_RESOURCE_URI = `${MCP_RESOURCE_PREFIX}state`;
export const ROUTING_RESOURCE_URI = `${MCP_RESOURCE_PREFIX}routing`;

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export interface ResourceReadResult {
  contents: ResourceContent[];
}

export class McpResourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpResourceError";
  }
}

const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  {
    uri: STATE_RESOURCE_URI,
    name: "LogNexus agent state",
    description:
      "Persistent LogNexus agent state (.lognexus/state.json): active issue, current subtask, completed subtasks and last synchronization timestamp.",
    mimeType: "application/json",
  },
  {
    uri: ROUTING_RESOURCE_URI,
    name: "Model-tier routing configuration",
    description:
      "Multi-model routing rules from .lognexus/routing.md, or the default tier taxonomy when the project has not been initialized.",
    mimeType: "text/markdown",
  },
];

export function listMcpResources(): ResourceDefinition[] {
  return RESOURCE_DEFINITIONS;
}

export function readStateResource(targetDir: string = process.cwd()): ResourceReadResult {
  return {
    contents: [
      {
        uri: STATE_RESOURCE_URI,
        mimeType: "application/json",
        text: JSON.stringify(loadState(targetDir), null, 2),
      },
    ],
  };
}

export function readRoutingResource(targetDir: string = process.cwd()): ResourceReadResult {
  const routingPath = join(targetDir, ".lognexus", "routing.md");
  const hasRoutingFile = existsSync(routingPath);

  let text: string;
  try {
    text = hasRoutingFile ? readFileSync(routingPath, "utf8") : DEFAULT_ROUTING_TEMPLATE;
  } catch {
    text = DEFAULT_ROUTING_TEMPLATE;
  }

  if (!hasRoutingFile) {
    text = `<!-- Default routing template: .lognexus/routing.md not found in this project. -->\n${text}`;
  }

  return {
    contents: [
      {
        uri: ROUTING_RESOURCE_URI,
        mimeType: "text/markdown",
        text,
      },
    ],
  };
}

export function readMcpResource(
  uri: string,
  targetDir: string = process.cwd(),
): ResourceReadResult {
  switch (uri) {
    case STATE_RESOURCE_URI:
      return readStateResource(targetDir);
    case ROUTING_RESOURCE_URI:
      return readRoutingResource(targetDir);
    default:
      throw new McpResourceError(`Unknown LogNexus resource: '${uri}'.`);
  }
}
