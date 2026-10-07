import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ensureCloudSchema, getCloudDb } from "../../../../lib/cloudDb";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "../../../adminAuth";

export async function GET() {
  try {
    const session = await readAdminSession(
      (await cookies()).get(ADMIN_SESSION_COOKIE)?.value,
    );
    if (!session)
      return NextResponse.json(
        { error: "Sesión administrativa requerida." },
        { status: 401 },
      );
    await ensureCloudSchema();
    const sql = getCloudDb();
    const users = await sql<{ id: string; full_name: string }[]>`
      select id, full_name from courier_users
      where active = true order by full_name asc
    `;
    return NextResponse.json({ users });
  } catch (error) {
    console.error("courier-assignable-list", error);
    return NextResponse.json(
      { error: "No se pudo cargar la lista de motorizados." },
      { status: 500 },
    );
  }
}
