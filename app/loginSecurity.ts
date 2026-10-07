import { ensureCloudSchema, getCloudDb } from "../lib/cloudDb";

const MAX_ATTEMPTS = 8;

async function fingerprint(request: Request, scope: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${scope}:${address}`),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function loginIsBlocked(request: Request, scope: string) {
  await ensureCloudSchema();
  const sql = getCloudDb();
  const key = await fingerprint(request, scope);
  const rows = await sql<{ blocked: boolean }[]>`
    select coalesce(blocked_until > now(), false) as blocked
    from auth_rate_limits where key = ${key}
  `;
  return { key, blocked: Boolean(rows[0]?.blocked) };
}

export async function recordLoginFailure(key: string) {
  const sql = getCloudDb();
  await sql`
    insert into auth_rate_limits (key, attempts, window_started_at, updated_at)
    values (${key}, 1, now(), now())
    on conflict (key) do update set
      attempts = case
        when auth_rate_limits.window_started_at < now() - interval '15 minutes'
          then 1
        else auth_rate_limits.attempts + 1
      end,
      window_started_at = case
        when auth_rate_limits.window_started_at < now() - interval '15 minutes'
          then now()
        else auth_rate_limits.window_started_at
      end,
      blocked_until = case
        when (case
          when auth_rate_limits.window_started_at < now() - interval '15 minutes'
            then 1
          else auth_rate_limits.attempts + 1
        end) >= ${MAX_ATTEMPTS}
          then now() + interval '15 minutes'
        else auth_rate_limits.blocked_until
      end,
      updated_at = now()
  `;
}

export async function clearLoginFailures(key: string) {
  const sql = getCloudDb();
  await sql`delete from auth_rate_limits where key = ${key}`;
}
