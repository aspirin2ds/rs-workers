import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { eq, sql } from "drizzle-orm";
import { user as userTable } from "@repo/db/schema";
import { auth } from "./lib/better-auth";
import { generateCsrfToken, validateCsrfToken } from "./lib/csrf";
import { getDb } from "./lib/db";
import { mcpApiHandler } from "./lib/mcp";
import { renderPage, type PageProps } from "./ui/auth-page";

type Bindings = CloudflareBindings & { OAUTH_PROVIDER: OAuthHelpers };
type ClientInfo = { clientId: string; clientName?: string; clientUri?: string } | null;
type AuthSession = {
  user: { id: string; email: string; name: string | null; role?: string | null };
  session: { token: string };
};

type UserWithRole = { id: string; email: string; name: string | null; role?: string | null };

const app = new Hono<{ Bindings: Bindings }>();

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

function isTrustedClient(clientInfo: ClientInfo, env: CloudflareBindings): boolean {
  if (!clientInfo?.clientUri) {
    return false;
  }

  try {
    const trustedOrigin = getAllowedOrigin(env);
    const trustedHost = new URL(trustedOrigin).hostname;
    const clientHost = new URL(clientInfo.clientUri).hostname;
    const trustedSuffix = trustedHost.split(".").slice(-2).join(".");

    return clientHost === trustedHost || clientHost.endsWith(`.${trustedSuffix}`);
  } catch {
    return false;
  }
}

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "script-src 'unsafe-inline'",
].join("; ");

function htmlWithCsrf(c: Context, props: Record<string, unknown> & { step: string }) {
  const { token, setCookie } = generateCsrfToken();
  const body = renderPage({ ...props, csrfToken: token } as PageProps);
  return c.html(body, 200, {
    "Set-Cookie": setCookie,
    "Content-Security-Policy": CSP,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  });
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

// Better Auth routes
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  return auth(c.env).handler(c.req.raw);
});

// Example protected route
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

// OAuth authorize — show login/consent page
app.get("/authorize", async (c) => {
  const oauthReqInfo: AuthRequest =
    await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const clientInfo = await c.env.OAUTH_PROVIDER.lookupClient(
    oauthReqInfo.clientId
  );

  if (!clientInfo) {
    return c.text("Invalid client_id", 400);
  }

  const session = await auth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });

  const state = btoa(JSON.stringify(oauthReqInfo));

  if (session && isTrustedClient(clientInfo, c.env)) {
    return completeAuth(c, oauthReqInfo, await withBootstrapAdminRole(c.env, session));
  }

  return htmlWithCsrf(c, { step: "login", state, clientInfo });
});

app.get("/authorize/resume", async (c) => {
  const state = c.req.query("state");

  if (!state) {
    return c.text("Missing state parameter", 400);
  }

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(atob(state));
  } catch {
    return c.text("Invalid state parameter", 400);
  }

  const clientInfo = await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
  const session = await auth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return htmlWithCsrf(c, { step: "login", state, clientInfo, error: "Google sign-in did not complete. Please try again." });
  }

  const hydratedSession = await withBootstrapAdminRole(c.env, session);

  if (!isTrustedClient(clientInfo, c.env)) {
    return htmlWithCsrf(c, { step: "consent", state, clientInfo, user: hydratedSession.user });
  }

  return completeAuth(c, oauthReqInfo, hydratedSession);
});

// OAuth authorize — handle form submissions
app.post("/authorize", async (c) => {
  const formData = await c.req.formData();

  try {
    validateCsrfToken(formData, c.req.raw);
  } catch {
    return c.text("Invalid or missing CSRF token", 403);
  }

  const state = formData.get("state") as string;
  const action = formData.get("action") as string;

  if (!state) {
    return c.text("Missing state parameter", 400);
  }

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(atob(state));
  } catch {
    return c.text("Invalid state parameter", 400);
  }

  const clientInfo = await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);

  // --- Action: Show sign-up page ---
  if (action === "show-signup") {
    return htmlWithCsrf(c, { step: "signup", state, clientInfo });
  }

  // --- Action: Show login page ---
  if (action === "show-login") {
    return htmlWithCsrf(c, { step: "login", state, clientInfo });
  }

  // --- Action: Send OTP (sign-in) ---
  if (action === "send-otp") {
    const email = (formData.get("email") as string)?.trim();
    if (!email) {
      return htmlWithCsrf(c, { step: "login", state, clientInfo, error: "Email is required" });
    }

    try {
      await auth(c.env).api.sendVerificationOTP({
        body: { email, type: "sign-in" },
      });
    } catch {
      return htmlWithCsrf(c, { step: "login", state, clientInfo, error: "Failed to send OTP. Please try again." });
    }

    return htmlWithCsrf(c, { step: "otp", state, clientInfo, email });
  }

  // --- Action: Google sign-in ---
  if (action === "google") {
    const baseURL = new URL(c.req.url);
    const resumeURL = new URL("/authorize/resume", baseURL);
    resumeURL.searchParams.set("state", state);

    const result = await auth(c.env).api.signInSocial({
      body: {
        provider: "google",
        callbackURL: resumeURL.toString(),
        errorCallbackURL: resumeURL.toString(),
      },
      returnHeaders: true,
    });

    const redirectURL = result.response?.url;

    if (!redirectURL) {
      return htmlWithCsrf(c, { step: "login", state, clientInfo, error: "Unable to start Google sign-in. Please try again." });
    }

    const headers = new Headers(result.headers);
    headers.set("Location", redirectURL);

    return new Response(null, {
      status: 302,
      headers,
    });
  }

  // --- Action: Send OTP (sign-up) ---
  if (action === "send-otp-signup") {
    const email = (formData.get("email") as string)?.trim();
    const name = (formData.get("name") as string)?.trim();

    if (!email || !name) {
      return htmlWithCsrf(c, { step: "signup", state, clientInfo, error: "Name and email are required" });
    }

    try {
      await auth(c.env).api.sendVerificationOTP({
        body: { email, type: "sign-in" },
      });
    } catch {
      return htmlWithCsrf(c, { step: "signup", state, clientInfo, error: "Failed to send OTP. Please try again." });
    }

    return htmlWithCsrf(c, { step: "otp", state, clientInfo, email, name });
  }

  // --- Action: Verify OTP ---
  if (action === "verify-otp") {
    const email = formData.get("email") as string;
    const otp = formData.get("otp") as string;
    const name = (formData.get("name") as string) || undefined;

    if (!email || !otp) {
      return htmlWithCsrf(c, { step: "otp", state, clientInfo, email: email ?? "", name, error: "Please enter the code" });
    }

    try {
      const result = await auth(c.env).api.signInEmailOTP({
        body: { email, otp, ...(name ? { name } : {}) },
      });

      if (!result?.token) {
        return htmlWithCsrf(c, { step: "otp", state, clientInfo, email, name, error: "Invalid or expired code" });
      }

      // signInEmailOTP returns { token, user } directly — use it without a separate getSession call
      return completeAuth(c, oauthReqInfo, await withBootstrapAdminRole(c.env, {
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: (result.user as UserWithRole).role ?? "user",
        },
        session: { token: result.token },
      }));
    } catch {
      return htmlWithCsrf(c, { step: "otp", state, clientInfo, email, name, error: "Invalid or expired code" });
    }
  }

  // --- Action: Password sign-in ---
  if (action === "password") {
    const email = (formData.get("email") as string)?.trim();
    const password = formData.get("password") as string;

    if (!email || !password) {
      return htmlWithCsrf(c, { step: "login", state, clientInfo, error: "Email and password are required" });
    }

    try {
      const result = await auth(c.env).api.signInEmail({
        body: { email, password },
      });

      if (!result?.token) {
        return htmlWithCsrf(c, { step: "login", state, clientInfo, error: "Invalid email or password" });
      }

      return completeAuth(c, oauthReqInfo, await withBootstrapAdminRole(c.env, {
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: (result.user as UserWithRole).role ?? "user",
        },
        session: { token: result.token },
      }));
    } catch {
      return htmlWithCsrf(c, { step: "login", state, clientInfo, error: "Invalid email or password" });
    }
  }

  // --- Action: Approve consent (already logged in) ---
  if (action === "approve") {
    const session = await auth(c.env).api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return htmlWithCsrf(c, { step: "login", state, clientInfo, error: "Session expired. Please sign in again." });
    }

    return completeAuth(c, oauthReqInfo, await withBootstrapAdminRole(c.env, session));
  }

  return c.text("Invalid action", 400);
});

async function completeAuth(
  c: Context<{ Bindings: Bindings }>,
  oauthReqInfo: AuthRequest,
  session: AuthSession
) {
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: session.user.id,
    metadata: {
      label: `${session.user.name || session.user.email} — MCP Access`,
    },
    scope: oauthReqInfo.scope,
    props: {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role ?? "user",
      sessionToken: session.session.token,
    },
  });

  return c.redirect(redirectTo, 302);
}

app.get("/", (c) => {
  return c.text("Auth worker is running.");
});

// Wrap with OAuthProvider
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: mcpApiHandler,
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
});
