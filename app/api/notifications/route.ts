import { NextResponse } from "next/server";
import { ensureCloudSchema, getCloudDb } from "../../../lib/cloudDb";
import { authorizeAudience, requireCourierUser } from "../../pushAuth";
import { rejectCrossSiteMutation } from "../../requestSecurity";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const audience = await authorizeAudience(url.searchParams.get("audience") ?? undefined);
    if (!audience)
      return NextResponse.json({ error: "Acceso no autorizado." }, { status: 401 });
    const courier = audience === "courier" ? await requireCourierUser() : null;
    await ensureCloudSchema();
    const sql = getCloudDb();
    const rows = await sql<
      {
        id: string;
        type: string;
        title: string;
        message: string;
        target_url: string;
        priority: string;
        status: string;
        read_at: Date | null;
        opened_at: Date | null;
        created_at: Date;
      }[]
    >`
      select id, type, title, message, target_url, priority, status,
        read_at, opened_at, created_at
      from notifications
      where user_id = ${audience}
        and (${courier?.id ?? null}::text is null or account_id = ${courier?.id ?? null})
        and (expires_at is null or expires_at > now())
      order by created_at desc limit 50
    `;
    return NextResponse.json({
      notifications: rows,
      unread: rows.filter((row) => !row.read_at).length,
    });
  } catch (error) {
    console.error("notifications-list", error);
    return NextResponse.json({ error: "No se pudieron cargar las notificaciones." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const body = (await request.json()) as {
      audience?: string;
      action?: "read" | "read-all" | "acknowledge";
      id?: string;
    };
    const audience = await authorizeAudience(body.audience);
    if (!audience)
      return NextResponse.json({ error: "Acceso no autorizado." }, { status: 401 });
    const courier = audience === "courier" ? await requireCourierUser() : null;
    await ensureCloudSchema();
    const sql = getCloudDb();
    if (body.action === "read-all") {
      await sql`
        update notifications set read_at = coalesce(read_at, now())
        where user_id = ${audience}
          and (${courier?.id ?? null}::text is null or account_id = ${courier?.id ?? null})
      `;
    } else if (body.action === "read" && body.id) {
      await sql`
        update notifications set read_at = coalesce(read_at, now()),
          opened_at = coalesce(opened_at, now()), status = 'opened'
        where id = ${body.id} and user_id = ${audience}
          and (${courier?.id ?? null}::text is null or account_id = ${courier?.id ?? null})
      `;
    } else if (body.action === "acknowledge" && body.id) {
      await sql`
        update notifications set acknowledged_at = coalesce(acknowledged_at, now())
        where id = ${body.id} and user_id = ${audience}
          and (${courier?.id ?? null}::text is null or account_id = ${courier?.id ?? null})
      `;
    } else {
      return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar la notificación." }, { status: 500 });
  }
}
