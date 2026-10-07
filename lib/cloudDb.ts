import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;
let schemaReady: Promise<void> | null = null;

export function getCloudDb() {
  const connection =
    process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!connection) throw new Error("Supabase no está configurado.");
  client ??= postgres(connection, {
    max: 3,
    prepare: false,
    ssl: "require",
    connect_timeout: 10,
    idle_timeout: 20,
  });
  return client;
}

/**
 * Runtime readiness check only.
 *
 * Database DDL belongs to `npm run db:migrate:cloud`. Running the complete
 * migration from every cold serverless instance caused requests to queue on a
 * global advisory lock, which could stall login and order creation.
 */
export function ensureCloudSchema() {
  schemaReady ??= (async () => {
    const sql = getCloudDb();
    const rows = await sql<
      { orders: string | null; couriers: string | null; credentials: string | null }[]
    >`
      select
        to_regclass('public.orders')::text as orders,
        to_regclass('public.courier_users')::text as couriers,
        to_regclass('public.admin_credentials')::text as credentials
    `;
    if (!rows[0]?.orders || !rows[0]?.couriers || !rows[0]?.credentials) {
      throw new Error(
        "El esquema de Supabase no está preparado. Ejecuta npm run db:migrate:cloud.",
      );
    }
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}
