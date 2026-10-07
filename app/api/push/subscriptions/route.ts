import { NextResponse } from "next/server";
import { ensureCloudSchema, getCloudDb } from "../../../../lib/cloudDb";
import {
  authorizeAudience,
  requireAdminRole,
  requireCourierUser,
} from "../../../pushAuth";
import { rejectCrossSiteMutation } from "../../../requestSecurity";

type SubscriptionInput = {
  audience?: string;
  deviceId?: string;
  token?: string;
  platform?: string;
  browser?: string;
  deviceName?: string;
  userAgent?: string;
  permissionStatus?: string;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const audience = await authorizeAudience(url.searchParams.get("audience") ?? undefined);
    const deviceId = url.searchParams.get("deviceId");
    if (!audience || !deviceId)
      return NextResponse.json({ error: "Acceso no autorizado." }, { status: 401 });
    const courier = audience === "courier" ? await requireCourierUser() : null;
    const admin = audience === "courier" ? null : await requireAdminRole();
    const accountId = courier?.id ?? admin?.accountId ?? null;
    await ensureCloudSchema();
    const sql = getCloudDb();
    const rows = await sql<
      {
        active: boolean;
        permission_status: string;
        platform: string | null;
        browser: string | null;
        device_name: string | null;
        last_seen_at: Date;
        last_notification_sent_at: Date | null;
        last_notification_opened_at: Date | null;
        invalidation_reason: string | null;
      }[]
    >`
      select active, permission_status, platform, browser, device_name,
        last_seen_at, last_notification_sent_at, last_notification_opened_at,
        invalidation_reason
      from push_subscriptions
      where user_id = ${audience} and device_id = ${deviceId}
        and (${accountId}::text is null or account_id = ${accountId})
    `;
    return NextResponse.json({ subscription: rows[0] ?? null });
  } catch {
    return NextResponse.json({ error: "No se pudo consultar el dispositivo." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const body = (await request.json()) as SubscriptionInput;
    const audience = await authorizeAudience(body.audience);
    if (!audience)
      return NextResponse.json({ error: "Acceso no autorizado." }, { status: 401 });
    if (!body.deviceId || !body.token)
      return NextResponse.json({ error: "Dispositivo o token inválido." }, { status: 400 });
    const deviceId = body.deviceId;
    const token = body.token;
    const courier = audience === "courier" ? await requireCourierUser() : null;
    const admin = audience === "courier" ? null : await requireAdminRole();
    const accountId = courier?.id ?? admin?.accountId ?? null;
    await ensureCloudSchema();
    const sql = getCloudDb();
    const id = crypto.randomUUID();
    await sql.begin(async (transaction) => {
      await transaction`
        update push_subscriptions
        set token = ${token},
          active = case
            when active or invalidation_reason in (
              'token-reassigned',
              'messaging/registration-token-not-registered',
              'messaging/invalid-registration-token',
              'messaging/invalid-argument'
            ) then true
            else active end,
          invalidated_at = case
            when active or invalidation_reason in (
              'token-reassigned',
              'messaging/registration-token-not-registered',
              'messaging/invalid-registration-token',
              'messaging/invalid-argument'
            ) then null
            else invalidated_at end,
          invalidation_reason = case
            when active or invalidation_reason in (
              'token-reassigned',
              'messaging/registration-token-not-registered',
              'messaging/invalid-registration-token',
              'messaging/invalid-argument'
            ) then null
            else invalidation_reason end,
          last_token_refresh_at = case
            when token <> ${token} then now()
            else last_token_refresh_at end,
          updated_at = now()
        where device_id = ${deviceId.slice(0, 120)}
      `;
      await transaction`
        insert into push_subscriptions (
          id, user_id, device_id, provider, token, platform, browser,
          device_name, user_agent, permission_status, active, account_id,
          last_seen_at, last_token_refresh_at, updated_at
        ) values (
          ${id}, ${audience}, ${deviceId.slice(0, 120)}, 'fcm', ${token},
          ${body.platform?.slice(0, 60) ?? null}, ${body.browser?.slice(0, 80) ?? null},
          ${body.deviceName?.slice(0, 120) ?? null}, ${body.userAgent?.slice(0, 500) ?? null},
          ${body.permissionStatus?.slice(0, 30) ?? "granted"}, true,
          ${accountId}, now(), now(), now()
        ) on conflict (user_id, device_id) do update set
          token = excluded.token, platform = excluded.platform,
          browser = excluded.browser, device_name = excluded.device_name,
          user_agent = excluded.user_agent,
          permission_status = excluded.permission_status, active = true,
          account_id = excluded.account_id,
          invalidated_at = null, invalidation_reason = null,
          last_seen_at = now(),
          last_token_refresh_at = case
            when push_subscriptions.token <> excluded.token then now()
            else push_subscriptions.last_token_refresh_at end,
          updated_at = now()
      `;
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("push-subscription-register", error);
    return NextResponse.json({ error: "No se pudo registrar el dispositivo." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const body = (await request.json()) as { audience?: string; deviceId?: string };
    const audience = await authorizeAudience(body.audience);
    if (!audience || !body.deviceId)
      return NextResponse.json({ error: "Acceso no autorizado." }, { status: 401 });
    await ensureCloudSchema();
    const sql = getCloudDb();
    const courier = audience === "courier" ? await requireCourierUser() : null;
    const admin = audience === "courier" ? null : await requireAdminRole();
    const accountId = courier?.id ?? admin?.accountId ?? null;
    await sql`
      update push_subscriptions set active = false, invalidated_at = now(),
        invalidation_reason = 'user-unlinked', updated_at = now()
      where user_id = ${audience} and device_id = ${body.deviceId}
        and (${accountId}::text is null or account_id = ${accountId})
    `;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No se pudo desvincular el dispositivo." }, { status: 500 });
  }
}
