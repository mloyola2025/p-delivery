import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ensureCloudSchema, getCloudDb } from "../../../lib/cloudDb";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "../../adminAuth";
import {
  hashCourierPassword,
  normalizeCourierUsername,
  validAccountPassword,
  validCourierUsername,
} from "../../courierAuth";
import { rejectCrossSiteMutation } from "../../requestSecurity";

async function requireSuperadmin() {
  return readAdminSession(
    (await cookies()).get(ADMIN_SESSION_COOKIE)?.value,
  );
}

function cleanName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

export async function GET() {
  const session = await requireSuperadmin();
  if (session?.role !== "superadmin")
    return NextResponse.json({ error: "Acceso exclusivo de Superadmin." }, { status: 403 });
  await ensureCloudSchema();
  const sql = getCloudDb();
  const users = await sql`
    select id, username, full_name, active, created_at, updated_at
    from courier_users order by active desc, full_name asc
  `;
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const session = await requireSuperadmin();
  if (session?.role !== "superadmin")
    return NextResponse.json({ error: "Acceso exclusivo de Superadmin." }, { status: 403 });
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const body = (await request.json()) as {
      username?: string;
      fullName?: string;
      password?: string;
    };
    const username = normalizeCourierUsername(body.username ?? "");
    const fullName = cleanName(body.fullName ?? "");
    if (!validCourierUsername(username))
      return NextResponse.json(
        { error: "El usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo." },
        { status: 400 },
      );
    if (fullName.length < 2)
      return NextResponse.json({ error: "Ingresa el nombre del motorizado." }, { status: 400 });
    if (!body.password || !validAccountPassword(body.password))
      return NextResponse.json({ error: "Ingresa una contraseña de hasta 128 caracteres." }, { status: 400 });
    await ensureCloudSchema();
    const sql = getCloudDb();
    const id = crypto.randomUUID();
    await sql`
      insert into courier_users (id, username, full_name, password_hash)
      values (${id}, ${username}, ${fullName}, ${await hashCourierPassword(body.password)})
    `;
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      return NextResponse.json({ error: "Ese nombre de usuario ya existe." }, { status: 409 });
    console.error("courier-create", error);
    return NextResponse.json({ error: "No se pudo crear el motorizado." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await requireSuperadmin();
  if (session?.role !== "superadmin")
    return NextResponse.json({ error: "Acceso exclusivo de Superadmin." }, { status: 403 });
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const body = (await request.json()) as {
      id?: string;
      username?: string;
      fullName?: string;
      password?: string;
      active?: boolean;
    };
    if (!body.id)
      return NextResponse.json({ error: "Motorizado inválido." }, { status: 400 });
    await ensureCloudSchema();
    const sql = getCloudDb();
    const rows = await sql<
      { username: string; full_name: string; password_hash: string; active: boolean }[]
    >`select username, full_name, password_hash, active from courier_users where id = ${body.id}`;
    const current = rows[0];
    if (!current)
      return NextResponse.json({ error: "Motorizado no encontrado." }, { status: 404 });
    const username = normalizeCourierUsername(body.username ?? current.username);
    const fullName = cleanName(body.fullName ?? current.full_name);
    if (!validCourierUsername(username) || fullName.length < 2)
      return NextResponse.json({ error: "Nombre o usuario inválido." }, { status: 400 });
    if (body.password && !validAccountPassword(body.password))
      return NextResponse.json({ error: "Ingresa una contraseña de hasta 128 caracteres." }, { status: 400 });
    const passwordHash = body.password
      ? await hashCourierPassword(body.password)
      : current.password_hash;
    const active = typeof body.active === "boolean" ? body.active : current.active;
    await sql`
      update courier_users set username = ${username}, full_name = ${fullName},
        password_hash = ${passwordHash}, active = ${active}, updated_at = now()
      where id = ${body.id}
    `;
    if (!active)
      await sql`
        update push_subscriptions set active = false, invalidated_at = now(),
          invalidation_reason = 'courier-disabled', updated_at = now()
        where account_id = ${body.id}
      `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      return NextResponse.json({ error: "Ese nombre de usuario ya existe." }, { status: 409 });
    console.error("courier-update", error);
    return NextResponse.json({ error: "No se pudo actualizar el motorizado." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireSuperadmin();
  if (session?.role !== "superadmin")
    return NextResponse.json({ error: "Acceso exclusivo de Superadmin." }, { status: 403 });
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  const body = (await request.json()) as { id?: string };
  if (!body.id)
    return NextResponse.json({ error: "Motorizado inválido." }, { status: 400 });
  const id = body.id;
  await ensureCloudSchema();
  const sql = getCloudDb();
  await sql.begin(async (transaction) => {
    await transaction`
      update push_subscriptions set active = false, invalidated_at = now(),
        invalidation_reason = 'courier-deleted', updated_at = now()
      where account_id = ${id}
    `;
    await transaction`delete from courier_users where id = ${id}`;
  });
  return NextResponse.json({ ok: true });
}
