import { NextResponse } from "next/server";
import { ensureCloudSchema, getCloudDb } from "../../../../lib/cloudDb";
import { requireOperator } from "../../../pushAuth";
import { rejectCrossSiteMutation } from "../../../requestSecurity";

export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const operator = await requireOperator();
    if (!operator)
      return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
    const body = (await request.json()) as { notificationId?: string };
    if (!body.notificationId)
      return NextResponse.json({ error: "Notificación inválida." }, { status: 400 });
    await ensureCloudSchema();
    const sql = getCloudDb();
    const notifications = await sql<{ user_id: string; account_id: string | null }[]>`
      select user_id, account_id from notifications where id = ${body.notificationId}
    `;
    const notification = notifications[0];
    const allowed = notification && (
      operator.type === "courier"
        ? notification.user_id === "courier" && notification.account_id === operator.user.id
        : operator.user.role === "superadmin" ||
          (notification.user_id === operator.user.role &&
            (!notification.account_id || notification.account_id === operator.user.accountId))
    );
    if (!allowed)
      return NextResponse.json({ error: "Acceso no autorizado." }, { status: 403 });
    await sql`
      update notifications set opened_at = coalesce(opened_at, now()), status = 'opened'
      where id = ${body.notificationId}
    `;
    await sql`
      update push_subscriptions set last_notification_opened_at = now(), updated_at = now()
      where user_id = (select user_id from notifications where id = ${body.notificationId})
        and (
          (select account_id from notifications where id = ${body.notificationId}) is null
          or account_id = (select account_id from notifications where id = ${body.notificationId})
        )
        and active = true
    `;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No se pudo registrar la apertura." }, { status: 500 });
  }
}
