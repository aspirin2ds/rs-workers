const COOKIE_NAME = "CSRF_TOKEN";

export function generateCsrfToken(isSecure: boolean): { token: string; setCookie: string } {
  const token = crypto.randomUUID();
  const prefix = isSecure ? "__Host-" : "";
  const secure = isSecure ? " Secure;" : "";
  const setCookie = `${prefix}${COOKIE_NAME}=${token}; HttpOnly;${secure} Path=/; SameSite=Lax; Max-Age=600`;
  return { token, setCookie };
}

function getCookieValue(request: Request, isSecure: boolean): string | undefined {
  const name = isSecure ? `__Host-${COOKIE_NAME}` : COOKIE_NAME;
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader
    .split(";")
    .find((c) => c.trim().startsWith(`${name}=`));
  return match?.trim().slice(name.length + 1);
}

export function validateCsrfToken(
  formData: FormData,
  request: Request
): void {
  const isSecure = new URL(request.url).protocol === "https:";
  const tokenFromForm = formData.get("csrf_token");
  const tokenFromCookie = getCookieValue(request, isSecure);

  if (!tokenFromForm || !tokenFromCookie || tokenFromForm !== tokenFromCookie) {
    throw new Error("CSRF token mismatch");
  }
}
