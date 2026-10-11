// Sign-in: the owner uses the ADMIN_PASSWORD secret, invited members their own password. Sessions are signed cookies.
import { constantTimeEqual, toHex, Users, verifyPassword, type UserRecord } from "./users";

const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const LOCKOUT_SECONDS = 15 * 60;

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return crypto.subtle.sign("HMAC", key, encoder.encode(message));
}

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

const sign = async (env: Env, userId: string, version: number | string, expires: number | string) =>
  toHex(await hmac(env.SESSION_SECRET, `session:${userId}:${version}:${expires}`));

/** The signed-in user, or null. Removing someone or resetting their password ends their sessions. */
export async function currentUser(request: Request, env: Env): Promise<UserRecord | null> {
  const value = readCookie(request, cookieName(request));
  if (!value) return null;
  const [userId, version, expires, signature] = value.split(".");
  if (!userId || !version || !expires || !signature || Number(expires) < Date.now()) return null;
  if (!timingSafeEqual(signature, await sign(env, userId, version, expires))) return null;
  const user = await new Users(env.DB).get(userId);
  return user && String(user.session_version) === version ? user : null;
}

export async function sessionCookie(request: Request, env: Env, user: UserRecord): Promise<string> {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const signature = await sign(env, user.id, user.session_version, expires);
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return `${cookieName(request)}=${user.id}.${user.session_version}.${expires}.${signature}; HttpOnly;${secure} Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
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

async function isAdminPassword(env: Env, password: string): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  // Comparing digests keeps the comparison constant-time whatever the lengths.
  const [given, expected] = await Promise.all([
    hmac(env.SESSION_SECRET, `password:${password}`),
    hmac(env.SESSION_SECRET, `password:${env.ADMIN_PASSWORD}`),
  ]);
  return constantTimeEqual(given, expected);
}

export type SignInResult = { status: "ok"; user: UserRecord } | { status: "wrong" } | { status: "locked" };

/**
 * Checks an email and password, counting failures per client address so they cannot be guessed at speed.
 * The owner signs in with the admin password, with the email left blank or set to their own.
 */
export async function signIn(request: Request, env: Env, email: string, password: string): Promise<SignInResult> {
  const address = request.headers.get("CF-Connecting-IP") ?? "local";
  const key = `login-failures:${address}`;
  const failures = Number((await env.OAUTH_KV.get(key)) ?? 0);
  if (failures >= MAX_FAILURES) return { status: "locked" };

  const users = new Users(env.DB);
  const named = email.trim() ? await users.byEmail(email) : null;
  let user: UserRecord | null = null;
  if (named?.password_hash) {
    if (await verifyPassword(password, named.password_hash)) user = named;
  } else if ((named?.role === "owner" || !email.trim()) && (await isAdminPassword(env, password))) {
    user = named ?? (await users.get("owner"));
  }

  if (user) {
    if (failures) await env.OAUTH_KV.delete(key);
    return { status: "ok", user };
  }
  await env.OAUTH_KV.put(key, String(failures + 1), { expirationTtl: LOCKOUT_SECONDS });
  return { status: "wrong" };
}

/** Only same-site paths are followed after sign-in. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
