import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAdoptTool } from "./tools/adopt";
import { registerFeedTool } from "./tools/feed";
import { registerPackTool } from "./tools/pack";
import { registerItemsTool } from "./tools/items";
import { registerSaveStoryTool } from "./tools/save-story";

function createServer(_env: CloudflareBindings) {
  const server = new McpServer({
    name: "rs-pebble-mcp",
    version: "1.0.0",
  });

  registerAdoptTool(server, _env);
  registerFeedTool(server, _env);
  registerPackTool(server, _env);
  registerItemsTool(server, _env);
  registerSaveStoryTool(server, _env);

  return server;
}

export const mcpApiHandler = {
  async fetch(
    request: Request,
    env: CloudflareBindings,
    ctx: ExecutionContext
  ) {
    const server = createServer(env);
    return createMcpHandler(server)(request, env, ctx);
  },
};
