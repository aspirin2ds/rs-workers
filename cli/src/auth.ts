import { homedir } from "node:os";
import { join } from "node:path";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const TOKEN_DIR = join(homedir(), ".maid-cli");
const TOKEN_FILE = join(TOKEN_DIR, "token.json");

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role?: string | null;
};

export type AuthClient = {
  baseUrl: string;
  origin: string;
};

export async function saveToken(token: string): Promise<void> {
  await mkdir(TOKEN_DIR, { recursive: true, mode: 0o700 });
  await chmod(TOKEN_DIR, 0o700);
  await writeFile(TOKEN_FILE, JSON.stringify({ token }), { mode: 0o600 });
  await chmod(TOKEN_FILE, 0o600);
}

export async function loadToken(): Promise<string | null> {
  try {
    const raw = await readFile(TOKEN_FILE, "utf8");
    const data = JSON.parse(raw) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  await rm(TOKEN_FILE, { force: true });
}

async function ensureOk(response: Response, action: string): Promise<void> {
  if (response.ok) return;
  const detail = await response.text().catch(() => "");
  throw new Error(
    `${action} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`
  );
}

function extractToken(response: Response): string {
  const token = response.headers.get("set-auth-token");
  if (!token) {
    throw new Error(
      "No bearer token returned. Ensure the bearer() plugin is enabled on maid-auth."
    );
  }
  return token;
}

function jsonHeaders(origin: string, extra?: Record<string, string>): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Origin: origin,
    ...extra,
  };
}

export async function signInWithPassword(
  client: AuthClient,
  email: string,
  pwd: string
): Promise<string> {
  const response = await fetch(`${client.baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: jsonHeaders(client.origin),
    body: JSON.stringify({ email, password: pwd }),
  });
  await ensureOk(response, "Sign-in");
  return extractToken(response);
}

export async function requestOtp(client: AuthClient, email: string): Promise<void> {
  const response = await fetch(
    `${client.baseUrl}/api/auth/email-otp/send-verification-otp`,
    {
      method: "POST",
      headers: jsonHeaders(client.origin),
      body: JSON.stringify({ email, type: "sign-in" }),
    }
  );
  await ensureOk(response, "OTP request");
}

export async function signInWithOtp(
  client: AuthClient,
  email: string,
  otp: string
): Promise<string> {
  const response = await fetch(`${client.baseUrl}/api/auth/sign-in/email-otp`, {
    method: "POST",
    headers: jsonHeaders(client.origin),
    body: JSON.stringify({ email, otp }),
  });
  await ensureOk(response, "OTP verification");
  return extractToken(response);
}

export async function requestPasswordResetOtp(
  client: AuthClient,
  email: string
): Promise<void> {
  const response = await fetch(
    `${client.baseUrl}/api/auth/email-otp/send-verification-otp`,
    {
      method: "POST",
      headers: jsonHeaders(client.origin),
      body: JSON.stringify({ email, type: "forget-password" }),
    }
  );
  await ensureOk(response, "Password reset OTP request");
}

export async function resetPasswordWithOtp(
  client: AuthClient,
  email: string,
  otp: string,
  newPassword: string
): Promise<void> {
  const response = await fetch(`${client.baseUrl}/api/auth/email-otp/reset-password`, {
    method: "POST",
    headers: jsonHeaders(client.origin),
    body: JSON.stringify({ email, otp, password: newPassword }),
  });
  await ensureOk(response, "Password reset");
}

export async function signOut(client: AuthClient, token: string): Promise<void> {
  await fetch(`${client.baseUrl}/api/auth/sign-out`, {
    method: "POST",
    headers: jsonHeaders(client.origin, { Authorization: `Bearer ${token}` }),
  });
}

export async function getSession(
  client: AuthClient,
  token: string
): Promise<{ user: SessionUser } | null> {
  const response = await fetch(`${client.baseUrl}/api/auth/get-session`, {
    headers: { Origin: client.origin, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { user?: SessionUser } | null;
  return body && body.user ? { user: body.user } : null;
}
