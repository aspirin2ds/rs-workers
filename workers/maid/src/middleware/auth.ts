import type { Context, MiddlewareHandler } from "hono";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  role?: string | null;
};

export type AuthSession = {
  user: AuthUser;
  session: { token: string };
};

type Variables = {
  user: AuthUser;
  session: AuthSession["session"];
};

export type AuthEnv = {
  Bindings: CloudflareBindings;
  Variables: Variables;
};

async function fetchSession(c: Context<AuthEnv>): Promise<AuthSession | null> {
  const headers = new Headers();
  const authorization = c.req.header("authorization");
  const origin = c.req.header("origin");
  if (authorization) {
    headers.set("authorization", authorization);
  }
  headers.set("accept", "application/json");
  if (origin) {
    headers.set("origin", origin);
  }

  const request = new Request("https://auth.internal/api/auth/get-session", {
    method: "GET",
    headers,
  });

  const response = await c.env.AUTH.fetch(request);

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as AuthSession | null;
  return body && body.user ? body : null;
}

export const authMiddleware: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const session = await fetchSession(c);

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", session.user);
  c.set("session", session.session);

  await next();
};
