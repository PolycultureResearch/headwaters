// The people who can sign in: accounts, invite links and password hashes.
import type { User } from "../shared/types";
import { UserError } from "./store";

const INVITE_DAYS = 7;
// The most the Workers runtime allows for PBKDF2.
const PBKDF2_ITERATIONS = 100_000;
export const MIN_PASSWORD_LENGTH = 10;

const encoder = new TextEncoder();

export const toHex = (buffer: ArrayBuffer | Uint8Array) =>
  Array.from(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((byte) => parseInt(byte, 16)));

// Workers-only API; the DOM typings this project also loads for the UI do not know it.
export const constantTimeEqual = (a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array): boolean =>
  (crypto.subtle as unknown as { timingSafeEqual(a: unknown, b: unknown): boolean }).timingSafeEqual(a, b);

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2-sha256" || !Number(iterations) || !salt || !hash) return false;
  const expected = fromHex(hash);
  const given = await pbkdf2(password, fromHex(salt), Number(iterations));
  return given.byteLength === expected.byteLength && constantTimeEqual(given, expected);
}

const sha256 = async (value: string) => toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

/** A user row as stored, including what must never leave the server. */
export interface UserRecord {
  id: string;
  name: string;
  email: string | null;
  role: "owner" | "member";
  password_hash: string | null;
  invite_hash: string | null;
  invite_expires_at: string | null;
  session_version: number;
  created_at: string;
}

const nowIso = () => new Date().toISOString();

export function toUser(record: UserRecord): User {
  const invited = record.invite_hash !== null && (record.invite_expires_at ?? "") > nowIso();
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
    status: record.role === "owner" || record.password_hash ? "active" : invited ? "invited" : "expired",
    invite_expires_at: invited ? record.invite_expires_at : null,
  };
}

export class Users {
  constructor(private db: D1Database) {}

  get(id: string): Promise<UserRecord | null> {
    return this.db.prepare("SELECT * FROM users WHERE id = ? AND removed_at IS NULL").bind(id).first<UserRecord>();
  }

  byEmail(email: string): Promise<UserRecord | null> {
    return this.db
      .prepare("SELECT * FROM users WHERE email = ? AND removed_at IS NULL")
      .bind(email.trim().toLowerCase())
      .first<UserRecord>();
  }

  async list(): Promise<User[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM users WHERE removed_at IS NULL ORDER BY role = 'owner' DESC, created_at")
      .all<UserRecord>();
    return results.map(toUser);
  }

  private async require(id: string): Promise<UserRecord> {
    const user = await this.get(id);
    if (!user) throw new UserError("That person no longer has access.");
    return user;
  }

  private async assertEmailFree(email: string, exceptId = ""): Promise<void> {
    const existing = await this.byEmail(email);
    if (existing && existing.id !== exceptId) throw new UserError(`${existing.name} already uses ${existing.email}.`);
  }

  /** Makes a fresh one-time link token for a user, replacing any earlier one. */
  private async issueInvite(id: string): Promise<string> {
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    await this.db
      .prepare("UPDATE users SET invite_hash = ?, invite_expires_at = ? WHERE id = ?")
      .bind(await sha256(token), new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(), id)
      .run();
    return token;
  }

  /** Adds a member. The returned token goes in the link they use to set a password; it is not stored. */
  async create(name: string, email: string): Promise<{ user: User; token: string }> {
    await this.assertEmailFree(email);
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    await this.db
      .prepare("INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, 'member', ?)")
      .bind(id, name.trim(), email.trim().toLowerCase(), nowIso())
      .run();
    const token = await this.issueInvite(id);
    return { user: toUser(await this.require(id)), token };
  }

  /** A new link for someone who lost theirs or forgot their password. Their old password works until they use it. */
  async renewInvite(id: string): Promise<{ user: User; token: string }> {
    const user = await this.require(id);
    if (user.role === "owner") throw new UserError("The owner signs in with the admin password, not an invite link.");
    const token = await this.issueInvite(id);
    return { user: toUser(await this.require(id)), token };
  }

  async update(id: string, fields: { name?: string; email?: string | null }): Promise<User> {
    const user = await this.require(id);
    const email = fields.email === undefined ? user.email : fields.email?.trim().toLowerCase() || null;
    if (email) await this.assertEmailFree(email, id);
    if (!email && user.role !== "owner") throw new UserError("A member needs an email address to sign in with.");
    await this.db
      .prepare("UPDATE users SET name = ?, email = ? WHERE id = ?")
      .bind(fields.name?.trim() || user.name, email, id)
      .run();
    return toUser(await this.require(id));
  }

  /** Takes away someone's access at once. The row stays so their notes keep their name. */
  async remove(id: string): Promise<void> {
    const user = await this.require(id);
    if (user.role === "owner") throw new UserError("The owner cannot be removed.");
    await this.db
      .prepare(
        "UPDATE users SET removed_at = ?, password_hash = NULL, invite_hash = NULL, invite_expires_at = NULL, session_version = session_version + 1 WHERE id = ?",
      )
      .bind(nowIso(), id)
      .run();
  }

  async findInvite(token: string): Promise<UserRecord | null> {
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    return this.db
      .prepare("SELECT * FROM users WHERE invite_hash = ? AND invite_expires_at > ? AND removed_at IS NULL")
      .bind(await sha256(token), nowIso())
      .first<UserRecord>();
  }

  /** Sets the password from an invite link, uses the link up, and signs out any older sessions. */
  async acceptInvite(token: string, password: string): Promise<UserRecord | null> {
    const user = await this.findInvite(token);
    if (!user) return null;
    await this.db
      .prepare(
        "UPDATE users SET password_hash = ?, invite_hash = NULL, invite_expires_at = NULL, session_version = session_version + 1 WHERE id = ? AND invite_hash = ?",
      )
      .bind(await hashPassword(password), user.id, user.invite_hash)
      .run();
    return this.get(user.id);
  }
}
