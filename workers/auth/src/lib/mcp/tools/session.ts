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

  return { userId, email, name, role, sessionToken };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

export function registerSessionTools(
  server: McpServer,
  env: CloudflareBindings
) {
  server.registerTool(
    "get-session",
    {
      description: "Return the current authenticated Better Auth session",
      inputSchema: {},
    },
    async () => {
      try {
        const props = getAuthProps();
        if (!props.userId || !props.email) {
          return errorResult(new Error("Missing MCP auth context"));
        }
        if (!props.sessionToken) {
          return errorResult(new Error("Missing session token in MCP auth context"));
        }

        const session = await auth(env).api.getSession({
          headers: new Headers({ Authorization: `Bearer ${props.sessionToken}` }),
        });

        if (!session) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    valid: false,
                    reason: "Invalid or expired Better Auth session",
                    detail:
                      "MCP auth context token is not currently a valid Better Auth session token. get-session requires a live Better Auth session header/cookie context.",
                    action:
                      "Re-authenticate through your Better Auth web flow to obtain a fresh Better Auth session, or rely on MCP auth context for MCP-only authorization.",
                    mcpContext: {
                      user: {
                        id: props.userId,
                        email: props.email,
                        name: props.name ?? null,
                        role: props.role ?? "user",
                      },
                      session: { tokenPresent: true },
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  valid: true,
                  user: session.user,
                  session: {
                    ...session.session,
                    token: "[redacted]",
                  },
                  mcpContext: {
                    userId: props.userId,
                    email: props.email,
                    name: props.name ?? null,
                    role: props.role ?? "user",
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

}
