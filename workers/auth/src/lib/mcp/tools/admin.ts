import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp";
import { z } from "zod";
import { auth } from "../../better-auth";

function getAdminHeaders(sessionToken: string): Headers {
  return new Headers({ Authorization: `Bearer ${sessionToken}` });
}

export function registerAdminTools(
  server: McpServer,
  env: CloudflareBindings
) {
  const authInstance = auth(env);

  server.registerTool(
    "list-users",
    {
      description:
        "List users with optional search, pagination, and sorting",
      inputSchema: {
        searchValue: z.string().optional().describe("Search term"),
        searchField: z
          .enum(["email", "name"])
          .optional()
          .describe("Field to search"),
        searchOperator: z
          .enum(["contains", "starts_with", "ends_with"])
          .optional()
          .describe("Search operator"),
        limit: z.number().optional().describe("Max results (default 50)"),
        offset: z.number().optional().describe("Pagination offset"),
        sortBy: z.string().optional().describe("Field to sort by"),
        sortDirection: z
          .enum(["asc", "desc"])
          .optional()
          .describe("Sort direction"),
      },
    },
    async (params) => {
      const ctx = getMcpAuthContext();
      const headers = getAdminHeaders(ctx?.props?.sessionToken as string);

      const result = await authInstance.api.listUsers({
        headers,
        query: {
          searchValue: params.searchValue,
          searchField: params.searchField,
          searchOperator: params.searchOperator,
          limit: params.limit,
          offset: params.offset,
          sortBy: params.sortBy,
          sortDirection: params.sortDirection,
        },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "create-user",
    {
      description: "Create a new user",
      inputSchema: {
        email: z.string().email().describe("User email"),
        password: z.string().describe("User password"),
        name: z.string().describe("User display name"),
        role: z
          .enum(["user", "admin"])
          .optional()
          .describe("User role (default: user)"),
      },
    },
    async (params) => {
      const ctx = getMcpAuthContext();
      const headers = getAdminHeaders(ctx?.props?.sessionToken as string);

      const result = await authInstance.api.createUser({
        headers,
        body: {
          email: params.email,
          password: params.password,
          name: params.name,
          role: params.role ?? "user",
        },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "set-role",
    {
      description: "Set a user's role",
      inputSchema: {
        userId: z.string().describe("The user ID"),
        role: z.enum(["user", "admin"]).describe("The new role to assign"),
      },
    },
    async ({ userId, role }) => {
      const ctx = getMcpAuthContext();
      const headers = getAdminHeaders(ctx?.props?.sessionToken as string);

      const result = await authInstance.api.setRole({
        headers,
        body: { userId, role },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "ban-user",
    {
      description: "Ban a user, preventing sign-in and revoking all sessions",
      inputSchema: {
        userId: z.string().describe("The user ID to ban"),
        banReason: z.string().optional().describe("Reason for the ban"),
        banExpiresIn: z
          .number()
          .optional()
          .describe("Seconds until ban expires (omit for permanent)"),
      },
    },
    async (params) => {
      const ctx = getMcpAuthContext();
      const headers = getAdminHeaders(ctx?.props?.sessionToken as string);

      const result = await authInstance.api.banUser({
        headers,
        body: {
          userId: params.userId,
          banReason: params.banReason,
          banExpiresIn: params.banExpiresIn,
        },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "unban-user",
    {
      description: "Remove ban from a user",
      inputSchema: {
        userId: z.string().describe("The user ID to unban"),
      },
    },
    async ({ userId }) => {
      const ctx = getMcpAuthContext();
      const headers = getAdminHeaders(ctx?.props?.sessionToken as string);

      const result = await authInstance.api.unbanUser({
        headers,
        body: { userId },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "remove-user",
    {
      description: "Permanently delete a user",
      inputSchema: {
        userId: z.string().describe("The user ID to delete"),
      },
    },
    async ({ userId }) => {
      const ctx = getMcpAuthContext();
      const headers = getAdminHeaders(ctx?.props?.sessionToken as string);

      const result = await authInstance.api.removeUser({
        headers,
        body: { userId },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "revoke-session",
    {
      description: "Revoke a specific session by token",
      inputSchema: {
        sessionToken: z.string().describe("The session token to revoke"),
      },
    },
    async ({ sessionToken }) => {
      const ctx = getMcpAuthContext();
      const headers = getAdminHeaders(ctx?.props?.sessionToken as string);

      const result = await authInstance.api.revokeSession({
        headers,
        body: { token: sessionToken },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "revoke-user-sessions",
    {
      description: "Revoke all sessions for a user",
      inputSchema: {
        userId: z.string().describe("The user ID"),
      },
    },
    async ({ userId }) => {
      const ctx = getMcpAuthContext();
      const headers = getAdminHeaders(ctx?.props?.sessionToken as string);

      const result = await authInstance.api.revokeUserSessions({
        headers,
        body: { userId },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
