import { NextResponse } from "next/server";
import { ensureCloudSchema, getCloudDb } from "../../../../lib/cloudDb";
import { sendNotificationForEvent } from "../../../../lib/notificationService";
import { authorizeAudience, requireCourierUser } from "../../../pushAuth";
import { rejectCrossSiteMutation } from "../../../requestSecurity";

export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const body = (await request.json()) as { audience?: string; deviceId?: string };
    const audience = await authorizeAudience(body.audience);
    if (!audience || !body.deviceId)
      return NextResponse.json({ error: "Acceso no autorizado." }, { status: 401 });
    const courier = audience === "courier" ? await requireCourierUser() : null;
    await ensureCloudSchema();
    const sql = getCloudDb();
    const device = await sql<{ active: boolean }[]>`
      select active from push_subscriptions
      where user_id = ${audience} and device_id = ${body.deviceId} and active = true
        and (${courier?.id ?? null}::text is null or account_id = ${courier?.id ?? null})
    `;
    if (!device[0])
      return NextResponse.json({ error: "Este dispositivo no está registrado." }, { status: 400 });
    const recent = await sql<{ count: number }[]>`
      select count(*)::int as count from notifications
      where user_id = ${audience} and type = 'notification.test'
        and (${courier?.id ?? null}::text is null or account_id = ${courier?.id ?? null})
        and created_at > now() - interval '1 minute'
    `;
    if (recent[0]?.count)
      return NextResponse.json({ error: "Espera un minuto antes de otra prueba." }, { status: 429 });
    const result = await sendNotificationForEvent({
      audience,
      type: "notification.test",
      title: "P-delivery",
      message: "Las notificaciones de este dispositivo funcionan correctamente.",
      targetUrl: audience === "courier" ? "/motorizado" : `/admin?access=${audience}`,
      priority: "normal",
      recipientAccountId: courier?.id,
      idempotencyKey: `notification.test:${audience}:${body.deviceId}:${Math.floor(Date.now() / 60000)}`,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("notification-test", error);
    return NextResponse.json({ error: "No se pudo enviar la prueba." }, { status: 500 });
  }
}
