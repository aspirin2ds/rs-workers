import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp";
import { auth } from "../../better-auth";

function getAuthProps() {
  const ctx = getMcpAuthContext();
  const userId = ctx?.props?.userId as string | undefined;
  const email = ctx?.props?.email as string | undefined;
  const name = ctx?.props?.name as string | undefined;
  const role = ctx?.props?.role as string | undefined;
  const sessionToken = ctx?.props?.sessionToken as string | undefined;

  if (!userId || !email) {
    throw new Error("Missing MCP auth context");
  }

  return { userId, email, name, role, sessionToken };
}

function getSelfContext() {
  const { userId, sessionToken } = getAuthProps();

  if (!sessionToken) {
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
    "whoami",
    {
      description: "Return the currently authenticated MCP user and session context",
      inputSchema: {},
    },
    async () => {
      const props = getAuthProps();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                user: {
                  id: props.userId,
                  email: props.email,
                  name: props.name ?? null,
                  role: props.role ?? "user",
                },
                session: props.sessionToken
                  ? { token: props.sessionToken }
                  : null,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

}
