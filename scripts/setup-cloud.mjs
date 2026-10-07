import postgres from "postgres";
import { readFile } from "node:fs/promises";

const connection = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
if (!connection)
  throw new Error("Falta POSTGRES_URL. Ejecuta vercel env pull .env.local.");

const sql = postgres(connection, { max: 1, prepare: false, ssl: "require" });
await sql`create table if not exists admin_credentials (role text primary key check (role in ('superadmin','suyai','aura')), username text not null default 'admin', password_hash text not null, updated_at timestamptz not null default now())`;
await sql`update admin_credentials set username = case when role = 'superadmin' then 'superadmin' else 'admin' end, updated_at = now() where username <> case when role = 'superadmin' then 'superadmin' else 'admin' end`;
await sql`create table if not exists orders (id text primary key, brand text not null, delivery_date date, status text not null, data jsonb not null, updated_at timestamptz not null default now())`;
await sql`create index if not exists orders_delivery_date_idx on orders (delivery_date)`;
await sql`create index if not exists orders_brand_idx on orders (brand)`;
await sql`create table if not exists inventory (key text primary key, quantity integer not null, updated_at timestamptz not null default now())`;
await sql`create table if not exists app_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now())`;
await sql`create table if not exists order_photos (id text primary key, order_id text not null, blob_url text not null, pathname text not null, name text not null, created_at timestamptz not null default now())`;
await sql`create index if not exists order_photos_order_idx on order_photos (order_id)`;
const notificationsMigration = await readFile(
  new URL("../db/migrations/001_notifications.sql", import.meta.url),
  "utf8",
);
await sql.unsafe(notificationsMigration);
const courierContactMigration = await readFile(
  new URL("../db/migrations/002_courier_customer_contact.sql", import.meta.url),
  "utf8",
);
await sql.unsafe(courierContactMigration);
const negativeInventoryMigration = await readFile(
  new URL("../db/migrations/003_inventory_negative_balance.sql", import.meta.url),
  "utf8",
);
await sql.unsafe(negativeInventoryMigration);
const courierUsersMigration = await readFile(
  new URL("../db/migrations/004_courier_users.sql", import.meta.url),
  "utf8",
);
await sql.unsafe(courierUsersMigration);
const targetedCourierNotificationsMigration = await readFile(
  new URL("../db/migrations/005_targeted_courier_notifications.sql", import.meta.url),
  "utf8",
);
await sql.unsafe(targetedCourierNotificationsMigration);
const adminUsersMigration = await readFile(
  new URL("../db/migrations/006_admin_users.sql", import.meta.url),
  "utf8",
);
await sql.unsafe(adminUsersMigration);
const securityHardeningMigration = await readFile(
  new URL("../db/migrations/007_security_hardening.sql", import.meta.url),
  "utf8",
);
await sql.unsafe(securityHardeningMigration);
const sharedDevicePushMigration = await readFile(
  new URL("../db/migrations/008_shared_device_push.sql", import.meta.url),
  "utf8",
);
await sql.unsafe(sharedDevicePushMigration);
for (const role of ["superadmin", "suyai", "aura"]) {
  const hash = process.env[`P_DELIVERY_${role.toUpperCase()}_PASSWORD_HASH`];
  if (hash) {
    await sql`
      insert into admin_credentials (role, username, password_hash)
      values (${role}, ${role === "superadmin" ? "superadmin" : "admin"}, ${hash})
      on conflict (role) do nothing
    `;
  }
}
const credentialRoles =
  await sql`select role from admin_credentials order by role`;
const cloudTables =
  await sql`select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_name in ('orders', 'inventory', 'app_settings', 'order_photos', 'admin_credentials', 'admin_users', 'push_subscriptions', 'notifications', 'notification_delivery_attempts', 'notification_preferences', 'notification_audit', 'courier_location_events', 'customer_contact_events', 'courier_users', 'auth_rate_limits')`;
await sql.end();
console.log(
  `Supabase preparado: ${cloudTables[0].count} tablas y ${credentialRoles.length} credenciales.`,
);
