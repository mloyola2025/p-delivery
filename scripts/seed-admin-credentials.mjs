import { createHash } from "node:crypto";
import postgres from "postgres";

const connection = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
if (!connection) throw new Error("Falta POSTGRES_URL.");

const credentials = {
  superadmin: process.env.INITIAL_SUPERADMIN_PASSWORD,
  suyai: process.env.INITIAL_SUYAI_PASSWORD,
  aura: process.env.INITIAL_AURA_PASSWORD,
};
if (Object.values(credentials).some((password) => !password))
  throw new Error("Faltan las tres contraseñas iniciales.");

const sql = postgres(connection, { max: 1, prepare: false, ssl: "require" });
for (const [role, password] of Object.entries(credentials)) {
  const hash = createHash("sha256").update(password).digest("hex");
  const username = role === "superadmin" ? "superadmin" : "admin";
  await sql`
    insert into admin_credentials (role, username, password_hash, updated_at)
    values (${role}, ${username}, ${hash}, now())
    on conflict (role) do update set username = excluded.username, password_hash = excluded.password_hash, updated_at = now()
  `;
}
const rows = await sql`select role from admin_credentials order by role`;
await sql.end();
console.log(`Credenciales administrativas preparadas: ${rows.length} roles.`);
