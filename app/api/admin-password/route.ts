import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  hashAdminPassword,
  readAdminSession,
  saveCloudPassword,
  type AdminRole,
} from "../../adminAuth";
import { validAccountPassword } from "../../courierAuth";
import { rejectCrossSiteMutation } from "../../requestSecurity";

export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const cookieStore = await cookies();
    const session = await readAdminSession(
      cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
    );
    if (session?.role !== "superadmin")
      return NextResponse.json(
        { error: "Acceso exclusivo de Superadmin." },
        { status: 403 },
      );
    const body = (await request.json()) as {
      role?: AdminRole;
      password?: string;
    };
    if (!body.role || !["superadmin", "suyai", "aura"].includes(body.role))
      return NextResponse.json({ error: "Cuenta inválida." }, { status: 400 });
    if (!body.password || !validAccountPassword(body.password))
      return NextResponse.json(
        { error: "Ingresa una contraseña de hasta 128 caracteres." },
        { status: 400 },
      );
    await saveCloudPassword(body.role, await hashAdminPassword(body.password));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "No se pudo actualizar la contraseña." },
      { status: 500 },
    );
  }
}
