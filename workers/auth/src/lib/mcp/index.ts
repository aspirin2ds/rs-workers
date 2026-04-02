import { createMcpHandler, getMcpAuthContext } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSessionTools } from "./tools/session";
import { registerAdminTools } from "./tools/admin";

function createServer(env: CloudflareBindings) {
  const server = new McpServer({
    name: "rs-auth-mcp",
    version: "1.0.0",
  });

  const authContext = getMcpAuthContext();

  // Session tools available to all authenticated users
  registerSessionTools(server, env);

  // Admin tools only registered for admin users
  if (authContext?.props?.role === "admin") {
    registerAdminTools(server, env);
  }

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
