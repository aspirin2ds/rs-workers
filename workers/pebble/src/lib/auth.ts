import { getMcpAuthContext } from "agents/mcp";

interface ValidatedPlayer {
  userId: string;
  email: string;
  name: string;
}

export async function requirePlayer(
  env: CloudflareBindings,
): Promise<ValidatedPlayer> {
  const ctx = getMcpAuthContext();
  const userId = ctx?.props?.userId;
  const sessionToken = ctx?.props?.sessionToken;

  if (typeof userId !== "string" || !userId) {
    throw new Error("Not authenticated");
  }
  if (typeof sessionToken !== "string" || !sessionToken) {
    throw new Error("Missing session token");
  }

  const response = await env.AUTH_WORKER.fetch(
    new Request("https://auth/api/auth/get-session", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    }),
  );

  if (!response.ok) {
    throw new Error("Session expired — please re-authenticate");
  }

  const body = (await response.json()) as {
    user?: { id?: string; banned?: boolean };
  };

  if (!body.user || body.user.id !== userId) {
    throw new Error("Session expired — please re-authenticate");
  }

  if (body.user.banned) {
    throw new Error("Account suspended");
  }

  return {
    userId,
    email: (ctx?.props?.email as string) ?? "",
    name: (ctx?.props?.name as string) ?? "",
  };
}
