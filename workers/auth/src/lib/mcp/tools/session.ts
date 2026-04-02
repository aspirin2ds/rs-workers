import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp";
import { z } from "zod";
import { auth } from "../../better-auth";

function getSelfContext() {
  const ctx = getMcpAuthContext();
  const userId = ctx?.props?.userId as string | undefined;
  const sessionToken = ctx?.props?.sessionToken as string | undefined;

  if (!userId || !sessionToken) {
    throw new Error("Missing MCP auth context");
  }

  return { userId, sessionToken };
}

export function registerSessionTools(
  server: McpServer,
  env: CloudflareBindings
) {
  const authInstance = auth(env);

  server.registerTool(
    "verify-session",
    {
      description: "Verify a session token and return the associated user",
      inputSchema: { token: z.string().describe("Bearer session token") },
    },
    async ({ token }) => {
      const { sessionToken } = getSelfContext();

      if (token !== sessionToken) {
        return {
          content: [{ type: "text", text: "You can only verify your own session" }],
        };
      }

      const session = await authInstance.api.getSession({
        headers: new Headers({ Authorization: `Bearer ${token}` }),
      });

      if (!session) {
        return {
          content: [{ type: "text", text: "Invalid or expired session" }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { user: session.user, session: session.session },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get-user",
    {
      description: "Get a user by their ID",
      inputSchema: { userId: z.string().describe("The user ID") },
    },
    async ({ userId }) => {
      const self = getSelfContext();

      if (userId !== self.userId) {
        return { content: [{ type: "text", text: "You can only access your own user record" }] };
      }

      const user = await authInstance.api.getUser({
        query: { id: userId },
      });

      if (!user) {
        return { content: [{ type: "text", text: "User not found" }] };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(user, null, 2) }],
      };
    }
  );

  server.registerTool(
    "list-user-sessions",
    {
      description: "List active sessions for a user",
      inputSchema: { userId: z.string().describe("The user ID") },
    },
    async ({ userId }) => {
      const self = getSelfContext();

      if (userId !== self.userId) {
        return { content: [{ type: "text", text: "You can only list your own sessions" }] };
      }

      const sessions = await authInstance.api.listSessions({
        headers: new Headers({ Authorization: `Bearer ${self.sessionToken}` }),
      });

      return {
        content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
      };
    }
  );
}
