// Single-user sign-in: one password (a Worker secret) and a signed session cookie.

const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const LOCKOUT_SECONDS = 15 * 60;

const encoder = new TextEncoder();

// Workers-only API; the DOM typings this project also loads for the UI do not know it.
const constantTimeEqual = (a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array): boolean =>
  (crypto.subtle as unknown as { timingSafeEqual(a: unknown, b: unknown): boolean }).timingSafeEqual(a, b);

async function hmac(secret: string, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return crypto.subtle.sign("HMAC", key, encoder.encode(message));
}

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

function cookieName(request: Request): string {
  // The __Host- prefix needs HTTPS, which local dev does not have.
  return new URL(request.url).protocol === "https:" ? "__Host-hw_session" : "hw_session";
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function hasSession(request: Request, env: Env): Promise<boolean> {
  const value = readCookie(request, cookieName(request));
  if (!value) return false;
  const [expires, signature] = value.split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = toHex(await hmac(env.SESSION_SECRET, `session:${expires}`));
  return timingSafeEqual(signature, expected);
}

export async function sessionCookie(request: Request, env: Env): Promise<string> {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const signature = toHex(await hmac(env.SESSION_SECRET, `session:${expires}`));
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return `${cookieName(request)}=${expires}.${signature}; HttpOnly;${secure} Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return `${cookieName(request)}=; HttpOnly;${secure} Path=/; SameSite=Lax; Max-Age=0`;
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  return left.byteLength === right.byteLength && constantTimeEqual(left, right);
}

export type PasswordResult = "ok" | "wrong" | "locked";

/** Checks the password, counting failures per client address so it cannot be guessed at speed. */
export async function checkPassword(request: Request, env: Env, password: string): Promise<PasswordResult> {
  const address = request.headers.get("CF-Connecting-IP") ?? "local";
  const key = `login-failures:${address}`;
  const failures = Number((await env.OAUTH_KV.get(key)) ?? 0);
  if (failures >= MAX_FAILURES) return "locked";

  // Comparing digests keeps the comparison constant-time whatever the lengths.
  const [given, expected] = await Promise.all([
    hmac(env.SESSION_SECRET, `password:${password}`),
    hmac(env.SESSION_SECRET, `password:${env.ADMIN_PASSWORD}`),
  ]);
  if (env.ADMIN_PASSWORD && constantTimeEqual(given, expected)) {
    if (failures) await env.OAUTH_KV.delete(key);
    return "ok";
  }
  await env.OAUTH_KV.put(key, String(failures + 1), { expirationTtl: LOCKOUT_SECONDS });
  return "wrong";
}

/** Only same-site paths are followed after sign-in. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
