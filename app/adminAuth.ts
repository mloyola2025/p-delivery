export type AdminRole = "superadmin" | "suyai" | "aura";

import { ensureCloudSchema, getCloudDb } from "../lib/cloudDb";
import { hashCourierPassword, verifyCourierPassword } from "./courierAuth";

export type AdminSession = { role: AdminRole; accountId?: string };
export type IdentifiedAdmin = { role: AdminRole; accountId?: string };

export const ADMIN_SESSION_COOKIE = "p_delivery_admin_session";
export const ADMIN_PASSWORDS_COOKIE = "p_delivery_admin_passwords";
// Persiste entre cierres del navegador; el cierre explícito borra la cookie.
export const ADMIN_SESSION_SECONDS = 60 * 60 * 24 * 365 * 10;

export const DEFAULT_ADMIN_USERNAMES: Record<AdminRole, string> = {
  superadmin: "superadmin",
  suyai: "admin",
  aura: "admin",
};

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function hashAdminPassword(value: string) {
  return hashCourierPassword(value);
}

async function verifyAdminPassword(value: string, stored: string) {
  return stored.startsWith("pbkdf2_sha256$")
    ? verifyCourierPassword(value, stored)
    : safeEqual(await sha256(value), stored.toLowerCase());
}

function safeEqual(first: string, second: string) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1)
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}

function passwordHashFor(role: AdminRole) {
  const key = `P_DELIVERY_${role.toUpperCase()}_PASSWORD_HASH`;
  return process.env[key] ?? "";
}

export function adminUsernameFor(role: AdminRole) {
  return DEFAULT_ADMIN_USERNAMES[role];
}

function normalizeAdminUsername(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

async function signature(value: string) {
  const secret = process.env.P_DELIVERY_AUTH_SECRET;
  if (!secret) throw new Error("P_DELIVERY_AUTH_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
  );
}

export async function validateAdminCredentials(
  role: AdminRole,
  username: string,
  password: string,
  overrideHash?: string,
) {
  if (!safeEqual(normalizeAdminUsername(username), adminUsernameFor(role)))
    return false;
  const expectedHash = overrideHash || passwordHashFor(role);
  if (!expectedHash) return false;
  return verifyAdminPassword(password, expectedHash);
}

export async function identifyAdminAccount(
  username: string,
  password: string,
): Promise<IdentifiedAdmin | null> {
  await ensureCloudSchema();
  const sql = getCloudDb();
  for (const role of ["superadmin", "suyai", "aura"] as const) {
    const initialHash = passwordHashFor(role);
    if (initialHash) {
      await sql`
        insert into admin_credentials (role, username, password_hash)
        values (${role}, ${adminUsernameFor(role)}, ${initialHash})
        on conflict (role) do nothing
      `;
    }
  }
  const normalizedUsername = normalizeAdminUsername(username);
  if (!normalizedUsername || !password) return null;
  const primaryRows = await sql<
    { role: AdminRole; username: string; password_hash: string }[]
  >`
    select role, username, password_hash
    from admin_credentials
    where lower(username) = ${normalizedUsername}
    order by role
  `;
  const additionalRows = await sql<
    { id: string; role: "suyai" | "aura"; username: string; password_hash: string }[]
  >`
    select id, role, username, password_hash
    from admin_users
    where lower(username) = ${normalizedUsername} and active = true
    order by role, id
  `;
  let matchedAccount: IdentifiedAdmin | null = null;
  for (const row of primaryRows) {
    const usernameMatches = safeEqual(
      normalizeAdminUsername(row.username),
      normalizedUsername,
    );
    const passwordMatches = await verifyAdminPassword(password, row.password_hash);
    if (usernameMatches && passwordMatches) {
      if (matchedAccount) return null;
      matchedAccount = { role: row.role };
      if (!row.password_hash.startsWith("pbkdf2_sha256$"))
        await sql`
          update admin_credentials
          set password_hash = ${await hashCourierPassword(password)}, updated_at = now()
          where role = ${row.role} and password_hash = ${row.password_hash}
        `;
    }
  }
  for (const row of additionalRows) {
    const usernameMatches = safeEqual(
      normalizeAdminUsername(row.username),
      normalizedUsername,
    );
    const passwordMatches = await verifyCourierPassword(
      password,
      row.password_hash,
    );
    if (usernameMatches && passwordMatches) {
      if (matchedAccount) return null;
      matchedAccount = { role: row.role, accountId: row.id };
    }
  }
  return matchedAccount;
}

export async function identifyAdminRole(
  username: string,
  password: string,
): Promise<AdminRole | null> {
  return (await identifyAdminAccount(username, password))?.role ?? null;
}

export async function cloudPasswordHashFor(role: AdminRole) {
  await ensureCloudSchema();
  const sql = getCloudDb();
  const rows = await sql<
    { password_hash: string }[]
  >`select password_hash from admin_credentials where role = ${role}`;
  if (rows[0]?.password_hash) return rows[0].password_hash;
  const initialHash = passwordHashFor(role);
  if (initialHash) {
    await sql`
      insert into admin_credentials (role, username, password_hash)
      values (${role}, ${adminUsernameFor(role)}, ${initialHash})
      on conflict (role) do nothing
    `;
  }
  return initialHash;
}

export async function saveCloudPassword(role: AdminRole, passwordHash: string) {
  await ensureCloudSchema();
  const sql = getCloudDb();
  await sql`
    insert into admin_credentials (role, username, password_hash, updated_at)
    values (${role}, ${adminUsernameFor(role)}, ${passwordHash}, now())
    on conflict (role) do update set password_hash = excluded.password_hash, updated_at = now()
  `;
}

export async function createAdminPasswordSettings(
  settings: Partial<Record<AdminRole, string>>,
) {
  const payload = toBase64Url(encoder.encode(JSON.stringify(settings)));
  return `${payload}.${await signature(payload)}`;
}

export async function readAdminPasswordSettings(token?: string) {
  if (!token) return {} as Partial<Record<AdminRole, string>>;
  try {
    const [payload, providedSignature] = token.split(".");
    if (
      !payload ||
      !providedSignature ||
      !safeEqual(await signature(payload), providedSignature)
    )
      return {};
    const settings = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payload)),
    ) as Partial<Record<AdminRole, string>>;
    return Object.fromEntries(
      Object.entries(settings).filter(
        ([role, hash]) =>
          ["superadmin", "suyai", "aura"].includes(role) &&
          typeof hash === "string",
      ),
    ) as Partial<Record<AdminRole, string>>;
  } catch {
    return {};
  }
}

export async function createAdminSession(role: AdminRole, accountId?: string) {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ role, ...(accountId ? { accountId } : {}) })),
  );
  return `${payload}.${await signature(payload)}`;
}

export async function readAdminSession(token?: string) {
  if (!token) return null;
  try {
    const [payload, providedSignature] = token.split(".");
    if (
      !payload ||
      !providedSignature ||
      !safeEqual(await signature(payload), providedSignature)
    )
      return null;
    const session = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payload)),
    ) as { role?: AdminRole; accountId?: string };
    if (
      !session.role ||
      !["superadmin", "suyai", "aura"].includes(session.role)
    )
      return null;
    if (session.accountId) {
      await ensureCloudSchema();
      const sql = getCloudDb();
      const rows = await sql<{ role: AdminRole }[]>`
        select role from admin_users
        where id = ${session.accountId} and active = true
      `;
      if (!rows[0] || rows[0].role !== session.role) return null;
      return { role: session.role, accountId: session.accountId };
    }
    return { role: session.role };
  } catch {
    return null;
  }
}

export function canAccessAdmin(
  sessionRole: AdminRole,
  requestedRole: AdminRole,
) {
  return sessionRole === "superadmin" || sessionRole === requestedRole;
}
