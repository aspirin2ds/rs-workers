import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp";
import { z } from "zod";
import { auth } from "../../better-auth";

function getAdminContext() {
  const ctx = getMcpAuthContext();
  const sessionToken = ctx?.props?.sessionToken as string | undefined;
  const userId = ctx?.props?.userId as string | undefined;

  if (!sessionToken) {
    throw new Error("Missing admin session token");
  }

  return {
    headers: new Headers({ Authorization: `Bearer ${sessionToken}` }),
    userId,
  };
}

export function registerAdminTools(
  server: McpServer,
  env: CloudflareBindings
) {
  const listUsersInputSchema = {
    searchValue: z.string().optional().describe("Search term"),
    searchField: z.enum(["email", "name"]).optional().describe("Field to search"),
    searchOperator: z
      .enum(["contains", "starts_with", "ends_with"])
      .optional()
      .describe("Search operator"),
    limit: z.number().optional().describe("Max results"),
    offset: z.number().optional().describe("Pagination offset"),
    sortBy: z.string().optional().describe("Field to sort by"),
    sortDirection: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
    filterField: z.string().optional().describe("Field to filter by"),
    filterValue: z
      .union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())])
      .optional()
      .describe("Filter value"),
    filterOperator: z
      .enum(["eq", "ne", "lt", "lte", "gt", "gte", "in", "not_in", "contains", "starts_with", "ends_with"])
      .optional()
      .describe("Filter operator"),
  };

  const listUsersHandler = async (params: {
    searchValue?: string;
    searchField?: "email" | "name";
    searchOperator?: "contains" | "starts_with" | "ends_with";
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortDirection?: "asc" | "desc";
    filterField?: string;
    filterValue?: string | number | boolean | string[] | number[];
    filterOperator?:
      | "eq"
      | "ne"
      | "lt"
      | "lte"
      | "gt"
      | "gte"
      | "in"
      | "not_in"
      | "contains"
      | "starts_with"
      | "ends_with";
  }) => {
    const { headers } = getAdminContext();
    const result = await auth(env).api.listUsers({
      headers,
      query: {
        searchValue: params.searchValue,
        searchField: params.searchField,
        searchOperator: params.searchOperator,
        limit: params.limit,
        offset: params.offset,
        sortBy: params.sortBy,
        sortDirection: params.sortDirection,
        filterField: params.filterField,
        filterValue: params.filterValue,
        filterOperator: params.filterOperator,
      },
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  };

  server.registerTool(
    "list-users",
    {
      description: "List users with optional search/filter/pagination/sorting",
      inputSchema: listUsersInputSchema,
    },
    listUsersHandler
  );

  server.registerTool(
    "list-user",
    {
      description: "Alias of list-users with optional search/filter/pagination/sorting",
      inputSchema: listUsersInputSchema,
    },
    listUsersHandler
  );

  server.registerTool(
    "create-user",
    {
      description: "Create a new user",
      inputSchema: {
        email: z.string().email().describe("User email"),
        password: z.string().min(8).describe("User password (min 8 characters)"),
        name: z.string().describe("User display name"),
        role: z.enum(["user", "admin"]).optional().describe("User role (default: user)"),
      },
    },
    async (params) => {
      const { headers } = getAdminContext();
      const result = await auth(env).api.createUser({
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
      const { headers, userId: adminUserId } = getAdminContext();
      if (userId === adminUserId) {
        throw new Error("Cannot modify your own role");
      }
      const result = await auth(env).api.setRole({
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
      const { headers, userId: adminUserId } = getAdminContext();
      if (params.userId === adminUserId) {
        throw new Error("Cannot ban yourself");
      }
      const result = await auth(env).api.banUser({
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
      const { headers } = getAdminContext();
      const result = await auth(env).api.unbanUser({
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
      const { headers, userId: adminUserId } = getAdminContext();
      if (userId === adminUserId) {
        throw new Error("Cannot delete yourself");
      }
      const result = await auth(env).api.removeUser({
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
      const { headers } = getAdminContext();
      const result = await auth(env).api.revokeSession({
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
      const { headers } = getAdminContext();
      const result = await auth(env).api.revokeUserSessions({
        headers,
        body: { userId },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
