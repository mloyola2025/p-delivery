import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { ensureCloudSchema, getCloudDb } from "../../../../lib/cloudDb";
import {
  downloadEvidence,
  evidencePathFromUrl,
  isSupabaseEvidenceUrl,
} from "../../../../lib/supabaseStorage";
import { requireOperator } from "../../../pushAuth";
import { operatorCanAccessOrder } from "../../../orderAccess";

export async function GET(request: Request) {
  try {
    const operator = await requireOperator();
    if (!operator)
      return new NextResponse("Sesión requerida", { status: 401 });
    await ensureCloudSchema();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return new NextResponse("Foto inválida", { status: 400 });
    const sql = getCloudDb();
    const rows = await sql<
      { order_id: string; blob_url: string }[]
    >`select order_id, blob_url from order_photos where id = ${id}`;
    if (!rows[0]) return new NextResponse("No encontrada", { status: 404 });
    if (!(await operatorCanAccessOrder(operator, rows[0].order_id)))
      return new NextResponse("Acceso no autorizado", { status: 403 });
    if (isSupabaseEvidenceUrl(rows[0].blob_url)) {
      const response = await downloadEvidence(
        evidencePathFromUrl(rows[0].blob_url),
      );
      if (!response.ok)
        return new NextResponse(null, { status: response.status });
      const etag = response.headers.get("etag");
      return new NextResponse(response.body, {
        headers: {
          "content-type":
            response.headers.get("content-type") || "application/octet-stream",
          "cache-control": "private, max-age=300",
          ...(etag ? { etag } : {}),
        },
      });
    }
    const result = await get(rows[0].blob_url, { access: "private" });
    if (!result || result.statusCode !== 200)
      return new NextResponse(null, { status: result?.statusCode ?? 404 });
    return new NextResponse(result.stream, {
      headers: {
        "content-type": result.blob.contentType,
        "cache-control": "private, max-age=300",
        etag: result.blob.etag,
      },
    });
  } catch (error) {
    console.error("photo-file", error);
    return new NextResponse("No se pudo leer la foto", { status: 500 });
  }
}
