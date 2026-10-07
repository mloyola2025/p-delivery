import { NextResponse } from "next/server";
import { ensureCloudSchema, getCloudDb } from "../../../../lib/cloudDb";
import { requireAdminRole } from "../../../pushAuth";

export async function GET() {
  const session = await requireAdminRole("superadmin");
  if (!session)
    return NextResponse.json({ error: "Acceso de superadmin requerido." }, { status: 401 });
  await ensureCloudSchema();
  const sql = getCloudDb();
  const devices = await sql`
    select id, user_id, device_id, platform, browser, device_name,
      permission_status, active, last_seen_at, last_notification_sent_at,
      last_notification_opened_at, invalidated_at, invalidation_reason, created_at
    from push_subscriptions order by last_seen_at desc
  `;
  return NextResponse.json({ devices });
}

export async function DELETE(request: Request) {
  const session = await requireAdminRole("superadmin");
  if (!session)
    return NextResponse.json({ error: "Acceso de superadmin requerido." }, { status: 401 });
  const body = (await request.json()) as { id?: string };
  if (!body.id)
    return NextResponse.json({ error: "Dispositivo inválido." }, { status: 400 });
  await ensureCloudSchema();
  const sql = getCloudDb();
  await sql`
    update push_subscriptions set active = false, invalidated_at = now(),
      invalidation_reason = 'admin-revoked', updated_at = now()
    where id = ${body.id}
  `;
  return NextResponse.json({ ok: true });
}
