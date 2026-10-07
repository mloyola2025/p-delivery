import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { ensureCloudSchema, getCloudDb } from "../../../lib/cloudDb";
import {
  deleteEvidence,
  evidencePathFromUrl,
  isSupabaseEvidenceUrl,
  uploadEvidence,
} from "../../../lib/supabaseStorage";
import { requireOperator } from "../../pushAuth";
import { operatorCanAccessOrder } from "../../orderAccess";
import { rejectCrossSiteMutation } from "../../requestSecurity";

export async function GET(request: Request) {
  try {
    const operator = await requireOperator();
    if (!operator)
      return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
    await ensureCloudSchema();
    const orderId = new URL(request.url).searchParams.get("orderId");
    const sql = getCloudDb();
    if (orderId && !(await operatorCanAccessOrder(operator, orderId)))
      return NextResponse.json({ error: "Acceso no autorizado." }, { status: 403 });
    const rows = orderId
      ? await sql<
          { id: string; order_id: string; name: string }[]
        >`select id, order_id, name from order_photos where order_id = ${orderId} order by created_at`
      : operator.type === "courier"
        ? await sql<{ id: string; order_id: string; name: string }[]>`
            select p.id, p.order_id, p.name
            from order_photos p join orders o on o.id = p.order_id
            where o.data->>'assignedCourierId' = ${operator.user.id}
            order by p.created_at
          `
        : operator.user.role === "superadmin"
          ? await sql<{ id: string; order_id: string; name: string }[]>`
              select id, order_id, name from order_photos order by created_at
            `
          : await sql<{ id: string; order_id: string; name: string }[]>`
              select p.id, p.order_id, p.name
              from order_photos p join orders o on o.id = p.order_id
              where lower(o.brand) = ${operator.user.role}
              order by p.created_at
            `;
    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        name: row.name,
        url: `/api/photos/file?id=${encodeURIComponent(row.id)}`,
      })),
    );
  } catch (error) {
    console.error("photos-list", error);
    return NextResponse.json(
      { error: "No se pudieron consultar las fotos." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const operator = await requireOperator();
    if (!operator)
      return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
    await ensureCloudSchema();
    const form = await request.formData();
    const id = String(form.get("id") || "");
    const orderId = String(form.get("orderId") || "");
    const file = form.get("file");
    if (
      !/^[a-zA-Z0-9_-]{3,100}$/.test(id) ||
      !/^[a-zA-Z0-9_-]{3,100}$/.test(orderId) ||
      !(file instanceof File) ||
      !["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    )
      return NextResponse.json({ error: "Foto inválida." }, { status: 400 });
    if (!(await operatorCanAccessOrder(operator, orderId)))
      return NextResponse.json({ error: "Acceso no autorizado." }, { status: 403 });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
    const pathname = `evidencias/${orderId}/${id}-${safeName}`;
    const storageUrl = await uploadEvidence(pathname, file);
    const sql = getCloudDb();
    await sql`
      insert into order_photos (id, order_id, blob_url, pathname, name)
      values (${id}, ${orderId}, ${storageUrl}, ${pathname}, ${file.name})
      on conflict (id) do update set blob_url = excluded.blob_url, pathname = excluded.pathname, name = excluded.name
    `;
    return NextResponse.json({
      id,
      orderId,
      name: file.name,
      url: `/api/photos/file?id=${encodeURIComponent(id)}`,
    });
  } catch (error) {
    console.error("photos-upload", error);
    return NextResponse.json(
      { error: "No se pudo subir la foto." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const operator = await requireOperator();
    if (!operator)
      return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
    await ensureCloudSchema();
    const id = new URL(request.url).searchParams.get("id");
    if (!id)
      return NextResponse.json({ error: "Foto inválida." }, { status: 400 });
    const sql = getCloudDb();
    const existing = await sql<{ order_id: string; blob_url: string }[]>`
      select order_id, blob_url from order_photos where id = ${id}
    `;
    if (!existing[0])
      return NextResponse.json({ error: "Foto no encontrada." }, { status: 404 });
    if (!(await operatorCanAccessOrder(operator, existing[0].order_id)))
      return NextResponse.json({ error: "Acceso no autorizado." }, { status: 403 });
    const rows = await sql<{ blob_url: string }[]>`
      delete from order_photos where id = ${id} returning blob_url
    `;
    if (rows[0]?.blob_url) {
      if (isSupabaseEvidenceUrl(rows[0].blob_url))
        await deleteEvidence([evidencePathFromUrl(rows[0].blob_url)]);
      else if (process.env.BLOB_READ_WRITE_TOKEN)
        await del(rows[0].blob_url);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("photos-delete", error);
    return NextResponse.json(
      { error: "No se pudo eliminar la foto." },
      { status: 500 },
    );
  }
}
