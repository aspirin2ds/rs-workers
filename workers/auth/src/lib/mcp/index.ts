import { createMcpHandler, getMcpAuthContext } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSessionTools } from "./tools/session";
import { registerAdminTools } from "./tools/admin";

function createServer(env: CloudflareBindings) {
  const server = new McpServer({
    name: "rs-auth-mcp",
    version: "1.0.0",
  });

  // Session tools available to all authenticated users
  registerSessionTools(server, env);

  // Admin tools are always registered; each handler enforces admin auth.
  // This avoids tool-discovery issues when auth context is unavailable during list.
  registerAdminTools(server, env);

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
