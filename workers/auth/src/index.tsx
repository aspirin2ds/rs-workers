import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, sql } from "drizzle-orm";
import { user as userTable } from "@repo/db/schema";
import { auth } from "./lib/better-auth";
import { getDb } from "./lib/db";

type AuthSession = {
  user: { id: string; email: string; name: string | null; role?: string | null };
  session: { token: string };
};

const app = new Hono<{ Bindings: CloudflareBindings }>();

function getBootstrapAdminEmail(env: CloudflareBindings): string | null {
  const value = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  return value || null;
}

async function promoteBootstrapAdminIfNeeded(
  env: CloudflareBindings,
  user: AuthSession["user"]
): Promise<AuthSession["user"]> {
  const db = getDb(env);
  const bootstrapAdminEmail = getBootstrapAdminEmail(env);

  if (!bootstrapAdminEmail || user.email.toLowerCase() !== bootstrapAdminEmail || user.role === "admin") {
    return user;
  }

  const existingAdmin = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.role, "admin"))
    .limit(1);

  if (existingAdmin.length > 0) {
    return user;
  }

  await db.run(sql`update "user" set "role" = 'admin' where "id" = ${user.id}`);

  return { ...user, role: "admin" };
}

async function withBootstrapAdminRole(
  env: CloudflareBindings,
  session: AuthSession
): Promise<AuthSession> {
  const user = await promoteBootstrapAdminIfNeeded(env, session.user);

  if (user.role === session.user.role) {
    return session;
  }

  return {
    ...session,
    user,
  };
}

function getAllowedOrigin(env: CloudflareBindings): string {
  return new URL(env.BETTER_AUTH_URL).origin;
}

app.use(
  "/api/auth/*",
  cors({
    origin: (origin, c) => {
      const allowedOrigin = getAllowedOrigin(c.env);
      return origin === allowedOrigin ? allowedOrigin : "";
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  return auth(c.env).handler(c.req.raw);
});

app.get("/api/me", async (c) => {
  const session = await auth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const hydratedSession = await withBootstrapAdminRole(c.env, session);

  return c.json({ user: hydratedSession.user });
});

app.get("/", (c) => {
  return c.text("Auth worker is running.");
});

export default app;
