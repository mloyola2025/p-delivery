import { ensureCloudSchema, getCloudDb } from "../lib/cloudDb";

export const COURIER_SESSION_COOKIE = "p_delivery_courier_session";
export const COURIER_SESSION_SECONDS = 60 * 60 * 24 * 365 * 10;

export type CourierUser = {
  id: string;
  username: string;
  fullName: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
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

function safeEqual(first: string, second: string) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1)
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
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
    new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))),
  );
}

export function normalizeCourierUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validCourierUsername(value: string) {
  return /^[a-z0-9._-]{3,40}$/.test(normalizeCourierUsername(value));
}

export function validAccountPassword(value: string) {
  return value.length >= 1 && value.length <= 128;
}

export async function hashCourierPassword(password: string) {
  const iterations = 210_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return `pbkdf2_sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(derived))}`;
}

export async function verifyCourierPassword(password: string, stored: string) {
  const [algorithm, iterationsValue, saltValue, expected] = stored.split("$");
  const iterations = Number(iterationsValue);
  if (
    algorithm !== "pbkdf2_sha256" ||
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    !saltValue ||
    !expected
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromBase64Url(saltValue),
      iterations,
    },
    key,
    256,
  );
  return safeEqual(toBase64Url(new Uint8Array(derived)), expected);
}

export async function createCourierSession(courierId: string) {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ courierId })),
  );
  return `${payload}.${await signature(payload)}`;
}

async function courierIdFromSession(token?: string) {
  if (!token) return null;
  try {
    const [payload, providedSignature] = token.split(".");
    if (
      !payload ||
      !providedSignature ||
      !safeEqual(await signature(payload), providedSignature)
    )
      return null;
    const parsed = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payload)),
    ) as { courierId?: string };
    return typeof parsed.courierId === "string" ? parsed.courierId : null;
  } catch {
    return null;
  }
}

export async function readCourierSession(token?: string) {
  const courierId = await courierIdFromSession(token);
  if (!courierId) return null;
  await ensureCloudSchema();
  const sql = getCloudDb();
  const rows = await sql<
    {
      id: string;
      username: string;
      full_name: string;
      active: boolean;
      created_at: Date;
      updated_at: Date;
    }[]
  >`
    select id, username, full_name, active, created_at, updated_at
    from courier_users where id = ${courierId} and active = true
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  } satisfies CourierUser;
}
