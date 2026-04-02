const COOKIE_NAME = "__Host-CSRF_TOKEN";

export function generateCsrfToken(): { token: string; setCookie: string } {
  const token = crypto.randomUUID();
  const setCookie = `${COOKIE_NAME}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`;
  return { token, setCookie };
}

export function validateCsrfToken(
  formData: FormData,
  request: Request
): void {
  const tokenFromForm = formData.get("csrf_token");
  const cookieHeader = request.headers.get("Cookie") || "";
  const tokenFromCookie = cookieHeader
    .split(";")
    .find((c) => c.trim().startsWith(`${COOKIE_NAME}=`))
    ?.trim()
    .slice(COOKIE_NAME.length + 1);

  if (!tokenFromForm || !tokenFromCookie || tokenFromForm !== tokenFromCookie) {
    throw new Error("CSRF token mismatch");
  }
}
