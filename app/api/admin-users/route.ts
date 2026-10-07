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

type ManagedAdminRole = "suyai" | "aura";

async function requireSuperadmin() {
  return readAdminSession(
    (await cookies()).get(ADMIN_SESSION_COOKIE)?.value,
  );
}

function cleanName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function validRole(value: unknown): value is ManagedAdminRole {
  return value === "suyai" || value === "aura";
}

async function usernameIsReserved(username: string, excludingId?: string) {
  const sql = getCloudDb();
  const primary = await sql<{ exists: boolean }[]>`
    select exists(
      select 1 from admin_credentials where lower(username) = ${username}
    ) as exists
  `;
  if (primary[0]?.exists) return true;
  const additional = await sql<{ exists: boolean }[]>`
    select exists(
      select 1 from admin_users
      where lower(username) = ${username}
        and (${excludingId ?? null}::text is null or id <> ${excludingId ?? null})
    ) as exists
  `;
  return Boolean(additional[0]?.exists);
}

export async function GET() {
  const session = await requireSuperadmin();
  if (session?.role !== "superadmin")
    return NextResponse.json(
      { error: "Acceso exclusivo de Superadmin." },
      { status: 403 },
    );
  await ensureCloudSchema();
  const sql = getCloudDb();
  const users = await sql`
    select id, username, full_name, role, active, created_at, updated_at
    from admin_users
    order by active desc, role asc, full_name asc
  `;
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const session = await requireSuperadmin();
  if (session?.role !== "superadmin")
    return NextResponse.json(
      { error: "Acceso exclusivo de Superadmin." },
      { status: 403 },
    );
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const body = (await request.json()) as {
      username?: string;
      fullName?: string;
      role?: string;
      password?: string;
    };
    const username = normalizeCourierUsername(body.username ?? "");
    const fullName = cleanName(body.fullName ?? "");
    if (!validCourierUsername(username))
      return NextResponse.json(
        {
          error:
            "El usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo.",
        },
        { status: 400 },
      );
    if (fullName.length < 2)
      return NextResponse.json(
        { error: "Ingresa el nombre del administrador." },
        { status: 400 },
      );
    if (!validRole(body.role))
      return NextResponse.json(
        { error: "Selecciona Administración Suyai o Aura." },
        { status: 400 },
      );
    if (!body.password || !validAccountPassword(body.password))
      return NextResponse.json(
        { error: "Ingresa una contraseña de hasta 128 caracteres." },
        { status: 400 },
      );
    await ensureCloudSchema();
    if (await usernameIsReserved(username))
      return NextResponse.json(
        { error: "Ese nombre de usuario ya está reservado." },
        { status: 409 },
      );
    const sql = getCloudDb();
    const id = crypto.randomUUID();
    await sql`
      insert into admin_users (
        id, username, full_name, role, password_hash
      ) values (
        ${id}, ${username}, ${fullName}, ${body.role},
        ${await hashCourierPassword(body.password)}
      )
    `;
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      return NextResponse.json(
        { error: "Ese nombre de usuario ya existe." },
        { status: 409 },
      );
    console.error("admin-user-create", error);
    return NextResponse.json(
      { error: "No se pudo crear el administrador." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const session = await requireSuperadmin();
  if (session?.role !== "superadmin")
    return NextResponse.json(
      { error: "Acceso exclusivo de Superadmin." },
      { status: 403 },
    );
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    const body = (await request.json()) as {
      id?: string;
      username?: string;
      fullName?: string;
      role?: string;
      password?: string;
      active?: boolean;
    };
    if (!body.id)
      return NextResponse.json(
        { error: "Administrador inválido." },
        { status: 400 },
      );
    await ensureCloudSchema();
    const sql = getCloudDb();
    const rows = await sql<
      {
        username: string;
        full_name: string;
        role: ManagedAdminRole;
        password_hash: string;
        active: boolean;
      }[]
    >`
      select username, full_name, role, password_hash, active
      from admin_users where id = ${body.id}
    `;
    const current = rows[0];
    if (!current)
      return NextResponse.json(
        { error: "Administrador no encontrado." },
        { status: 404 },
      );
    const username = normalizeCourierUsername(body.username ?? current.username);
    const fullName = cleanName(body.fullName ?? current.full_name);
    const role = body.role ?? current.role;
    if (!validCourierUsername(username) || fullName.length < 2 || !validRole(role))
      return NextResponse.json(
        { error: "Nombre, usuario o rango inválido." },
        { status: 400 },
      );
    if (body.password && !validAccountPassword(body.password))
      return NextResponse.json(
        { error: "Ingresa una contraseña de hasta 128 caracteres." },
        { status: 400 },
      );
    if (await usernameIsReserved(username, body.id))
      return NextResponse.json(
        { error: "Ese nombre de usuario ya está reservado." },
        { status: 409 },
      );
    const passwordHash = body.password
      ? await hashCourierPassword(body.password)
      : current.password_hash;
    const active =
      typeof body.active === "boolean" ? body.active : current.active;
    await sql`
      update admin_users
      set username = ${username}, full_name = ${fullName}, role = ${role},
        password_hash = ${passwordHash}, active = ${active}, updated_at = now()
      where id = ${body.id}
    `;
    if (!active || role !== current.role)
      await sql`
        update push_subscriptions
        set active = false, invalidated_at = now(),
          invalidation_reason = ${!active ? "admin-disabled" : "admin-role-changed"},
          updated_at = now()
        where account_id = ${body.id}
      `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      return NextResponse.json(
        { error: "Ese nombre de usuario ya existe." },
        { status: 409 },
      );
    console.error("admin-user-update", error);
    return NextResponse.json(
      { error: "No se pudo actualizar el administrador." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await requireSuperadmin();
  if (session?.role !== "superadmin")
    return NextResponse.json(
      { error: "Acceso exclusivo de Superadmin." },
      { status: 403 },
    );
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  const body = (await request.json()) as { id?: string };
  if (!body.id)
    return NextResponse.json(
      { error: "Administrador inválido." },
      { status: 400 },
    );
  const id = body.id;
  await ensureCloudSchema();
  const sql = getCloudDb();
  await sql.begin(async (transaction) => {
    await transaction`
      update push_subscriptions
      set active = false, invalidated_at = now(),
        invalidation_reason = 'admin-deleted', updated_at = now()
      where account_id = ${id}
    `;
    await transaction`delete from admin_users where id = ${id}`;
  });
  return NextResponse.json({ ok: true });
}
