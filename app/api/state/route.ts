import { del } from "@vercel/blob";
import { after, NextResponse } from "next/server";
import { cookies } from "next/headers";
import type postgres from "postgres";
import { ensureCloudSchema, getCloudDb } from "../../../lib/cloudDb";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "../../adminAuth";
import {
  COURIER_SESSION_COOKIE,
  readCourierSession,
} from "../../courierAuth";
import { sendNotificationForEvent } from "../../../lib/notificationService";
import {
  deleteEvidence,
  evidencePathFromUrl,
  isSupabaseEvidenceUrl,
} from "../../../lib/supabaseStorage";
import { PRODUCT_CATALOG, type ProductCatalog } from "../../products";
import {
  DEFAULT_COURIER_CONTACT_SETTINGS,
  type CourierContactSettings,
} from "../../courierContact";
import { bodyTooLarge, rejectCrossSiteMutation } from "../../requestSecurity";

type StoredOrder = {
  id: string;
  brand: string;
  deliveryDate?: string;
  status: string;
  assignedCourierId?: string;
  assignedCourierName?: string;
  [key: string]: unknown;
};

function validOrder(value: unknown): value is StoredOrder {
  if (!value || typeof value !== "object") return false;
  const order = value as Partial<StoredOrder>;
  return Boolean(
    typeof order.id === "string" &&
      /^[a-zA-Z0-9_-]{3,64}$/.test(order.id) &&
      (order.brand === "Suyai" || order.brand === "Aura") &&
      typeof order.status === "string" &&
      ["Pendiente", "En ruta", "Entregado", "Reprogramado", "Cancelado", "Devolución"].includes(order.status),
  );
}

function cleanProductName(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/\|/g, "-").slice(0, 100);
}

function cleanProductCatalog(value: unknown): ProductCatalog {
  const source = value && typeof value === "object" ? value as Partial<ProductCatalog> : {};
  const cleanBrand = (brand: keyof ProductCatalog) => {
    if (!Array.isArray(source[brand])) return [...PRODUCT_CATALOG[brand]];
    const seen = new Set<string>();
    return source[brand]
      .filter((item): item is string => typeof item === "string")
      .map(cleanProductName)
      .filter((item) => {
        const key = item.toLocaleLowerCase("es");
        if (!item || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 250);
  };
  return { Suyai: cleanBrand("Suyai"), Aura: cleanBrand("Aura") };
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, Math.round(number)))
    : fallback;
}

function cleanContactSettings(value: unknown): CourierContactSettings {
  const source = value && typeof value === "object"
    ? value as Partial<CourierContactSettings>
    : {};
  const cleanTemplates = (
    templates: Partial<Record<"Suyai" | "Aura", string>> | undefined,
    defaults: Record<"Suyai" | "Aura", string>,
  ) => ({
    Suyai: typeof templates?.Suyai === "string" && templates.Suyai.trim()
      ? templates.Suyai.trim().slice(0, 3000)
      : defaults.Suyai,
    Aura: typeof templates?.Aura === "string" && templates.Aura.trim()
      ? templates.Aura.trim().slice(0, 3000)
      : defaults.Aura,
  });
  const countryCode = String(source.countryCode ?? DEFAULT_COURIER_CONTACT_SETTINGS.countryCode)
    .replace(/\D/g, "")
    .slice(0, 4) || "51";
  return {
    etaBufferBeforeMinutes: boundedInteger(source.etaBufferBeforeMinutes, 2, 0, 30),
    etaBufferAfterMinutes: boundedInteger(source.etaBufferAfterMinutes, 8, 1, 60),
    maxAccuracyMeters: boundedInteger(source.maxAccuracyMeters, 100, 20, 1000),
    reuseLocationMinutes: boundedInteger(source.reuseLocationMinutes, 10, 1, 60),
    countryCode,
    allowForcedNotice: source.allowForcedNotice !== false,
    morningTemplates: cleanTemplates(
      source.morningTemplates,
      DEFAULT_COURIER_CONTACT_SETTINGS.morningTemplates,
    ),
    nextDeliveryTemplates: cleanTemplates(
      source.nextDeliveryTemplates,
      DEFAULT_COURIER_CONTACT_SETTINGS.nextDeliveryTemplates,
    ),
  };
}

async function replaceInventory(
  inventory: Record<string, unknown>,
  brand?: "Suyai" | "Aura",
) {
  const sql = getCloudDb();
  const entries = Object.entries(inventory)
    .map(
      ([key, value]) =>
        [key, Math.trunc(Number(value) || 0)] as const,
    )
    .filter(([key, quantity]) =>
      quantity !== 0 && (!brand || key.startsWith(`${brand}|`)),
    );
  await sql.begin(async (transaction) => {
    if (brand)
      await transaction`delete from inventory where key like ${`${brand}|%`}`;
    else await transaction`delete from inventory`;
    for (const [key, quantity] of entries) {
      await transaction`insert into inventory (key, quantity) values (${key}, ${quantity})`;
    }
  });
}

async function upsertOrder(order: StoredOrder) {
  const sql = getCloudDb();
  await sql`
    insert into orders (id, brand, delivery_date, status, data, updated_at)
    values (${order.id}, ${order.brand}, ${order.deliveryDate || null}, ${order.status}, ${sql.json(order as unknown as postgres.JSONValue)}, now())
    on conflict (id) do update set
      brand = excluded.brand,
      delivery_date = excluded.delivery_date,
      status = excluded.status,
      data = excluded.data,
      updated_at = now()
  `;
}

function normalizedInventoryValue(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function deductDeliveredOrderInventory(
  previous: StoredOrder | undefined,
  order: StoredOrder,
) {
  if (
    order.status !== "Entregado" ||
    previous?.status === "Entregado" ||
    previous?.inventoryDeducted === true
  )
    return;
  const warehouseName = normalizedInventoryValue(order.warehouse);
  const warehouseCode = warehouseName.includes("molina")
    ? "MOL"
    : warehouseName.includes("martin") || warehouseName === "smp"
      ? "SMP"
      : "RIM";
  const products = Array.isArray(order.products) ? order.products : [];
  const sql = getCloudDb();
  await sql.begin(async (transaction) => {
    for (const value of products) {
      if (!value || typeof value !== "object") continue;
      const product = value as { name?: unknown; quantity?: unknown };
      const name = cleanProductName(String(product.name ?? ""));
      const quantity = Math.min(
        10_000,
        Math.max(0, Math.trunc(Number(product.quantity) || 0)),
      );
      if (!name || !quantity) continue;
      const key = `${order.brand}|${warehouseCode}|${name}`;
      await transaction`
        insert into inventory (key, quantity, updated_at)
        values (${key}, ${-quantity}, now())
        on conflict (key) do update
        set quantity = inventory.quantity + excluded.quantity,
          updated_at = now()
      `;
    }
  });
  order.inventoryDeducted = true;
}

function deliveryDateLabel(value?: string) {
  if (!value) return "una próxima fecha";
  return new Date(`${value}T12:00:00-05:00`).toLocaleDateString("es-PE", {
    timeZone: "America/Lima",
    day: "numeric",
    month: "long",
  });
}

async function notifyOrderEvent(
  action: unknown,
  order: StoredOrder,
  previousStatus?: string,
) {
  try {
    const brand = order.brand.toLowerCase() === "aura" ? "aura" : "suyai";
    if (action === "create-order" && !previousStatus) {
      if (!order.assignedCourierId) return;
      await sendNotificationForEvent({
        audience: "courier",
        type: "order.assigned",
        title: `${order.brand} Envíos`,
        message: `Se agregó un nuevo pedido para el ${deliveryDateLabel(order.deliveryDate)}.`,
        entityType: "order",
        entityId: order.id,
        targetUrl: `/motorizado?order=${encodeURIComponent(order.id)}`,
        priority: "high",
        businessId: brand,
        recipientAccountId: order.assignedCourierId,
        idempotencyKey: `order.assigned:${order.id}:${order.assignedCourierId}:v2`,
      });
      return;
    }
    if (action !== "update-order" || !previousStatus || previousStatus === order.status)
      return;
    const client = typeof order.client === "string" ? order.client : "El pedido";
    const messages: Record<string, { type: string; message: string; priority?: "high" }> = {
      "En ruta": { type: "order.route_started", message: `${client}: el motorizado inició la entrega.` },
      Entregado: { type: "order.delivered", message: `El pedido de ${client} fue entregado.` },
      Reprogramado: { type: "order.rescheduled", message: `El pedido de ${client} fue reprogramado.`, priority: "high" },
      Cancelado: { type: "order.cancelled", message: `El pedido de ${client} fue cancelado.`, priority: "high" },
      Devolución: { type: "order.returned", message: `El pedido de ${client} fue marcado como devolución.`, priority: "high" },
    };
    const event = messages[order.status];
    if (!event) return;
    await sendNotificationForEvent({
      audience: brand,
      type: event.type,
      title: `${order.brand} · Pedido actualizado`,
      message: event.message,
      entityType: "order",
      entityId: order.id,
      targetUrl: `/admin?access=${brand}&order=${encodeURIComponent(order.id)}`,
      priority: event.priority ?? "normal",
      businessId: brand,
      idempotencyKey: `${event.type}:${order.id}:${order.status}`,
    });
  } catch (error) {
    console.error("order-notification", error);
  }
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const cookieStore = await cookies();
    const [adminSession, courierSession] = await Promise.all([
      readAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value),
      readCourierSession(cookieStore.get(COURIER_SESSION_COOKIE)?.value),
    ]);
    const requestedScope = new URL(request.url).searchParams.get("scope");
    const scope =
      requestedScope === "admin" || requestedScope === "courier"
        ? requestedScope
        : adminSession
          ? "admin"
          : "courier";
    const activeAdminSession = scope === "admin" ? adminSession : null;
    const activeCourierSession = scope === "courier" ? courierSession : null;
    if (
      (scope === "admin" && !activeAdminSession) ||
      (scope === "courier" && !activeCourierSession)
    )
      return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
    await ensureCloudSchema();
    const sql = getCloudDb();
    const requestedBrand =
      activeAdminSession && activeAdminSession.role !== "superadmin"
        ? activeAdminSession.role === "aura"
          ? "Aura"
          : "Suyai"
        : null;
    const orders = await sql<
      { data: StoredOrder }[]
    >`
      select data from orders
      where (${requestedBrand}::text is null or brand = ${requestedBrand})
        and (${activeCourierSession?.id ?? null}::text is null or data->>'assignedCourierId' = ${activeCourierSession?.id ?? null})
      order by updated_at desc
    `;
    const inventoryRows = activeCourierSession
      ? []
      : requestedBrand
        ? await sql<{ key: string; quantity: number }[]>`
            select key, quantity from inventory where key like ${`${requestedBrand}|%`}
          `
        : await sql<{ key: string; quantity: number }[]>`
            select key, quantity from inventory
          `;
    const settings = await sql<
      { value: { suyai?: boolean; aura?: boolean; courier?: boolean } }[]
    >`select value from app_settings where key = 'push-settings'`;
    const catalogSettings = await sql<{ value: ProductCatalog }[]>`
      select value from app_settings where key = 'product-catalog'
    `;
    const contactSettings = await sql<{ value: CourierContactSettings }[]>`
      select value from app_settings where key = 'courier-contact-settings'
    `;
    const response = NextResponse.json({
      orders: orders.map((row) => row.data),
      inventory: Object.fromEntries(
        inventoryRows.map((row) => [row.key, row.quantity]),
      ),
      pushSettings: {
        suyai: false,
        aura: false,
        courier: false,
        ...(settings[0]?.value ?? {}),
      },
      productCatalog: cleanProductCatalog(catalogSettings[0]?.value),
      courierContactSettings: cleanContactSettings(contactSettings[0]?.value),
    });
    const durationMs = Date.now() - startedAt;
    if (durationMs >= 1_000)
      console.warn(JSON.stringify({
        level: "warning",
        message: "slow-state-read",
        durationMs,
        operator: activeCourierSession ? "courier" : activeAdminSession?.role,
      }));
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      message: "cloud-state-get-failed",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
    return NextResponse.json(
      { error: "No se pudo consultar Supabase." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let action = "unknown";
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    if (bodyTooLarge(request, 1_500_000))
      return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413 });
    await ensureCloudSchema();
    const body = (await request.json()) as Record<string, unknown>;
    action = String(body.action ?? "unknown");
    const sql = getCloudDb();
    const cookieStore = await cookies();
    const [adminSession, courierSession] = await Promise.all([
      readAdminSession(cookieStore.get(ADMIN_SESSION_COOKIE)?.value),
      readCourierSession(cookieStore.get(COURIER_SESSION_COOKIE)?.value),
    ]);
    const requestedScope = new URL(request.url).searchParams.get("scope");
    const mutationScope =
      requestedScope === "admin" || requestedScope === "courier"
        ? requestedScope
        : adminSession
          ? "admin"
          : "courier";
    const courierActor = mutationScope === "courier" ? courierSession : null;
    let session = null;
    if (
      [
        "create-order",
        "save-inventory",
        "delete-orders",
        "save-push-settings",
        "save-product-catalog",
        "save-courier-contact-settings",
        "bootstrap",
      ].includes(String(action))
    ) {
      session = adminSession;
      if (!session)
        return NextResponse.json(
          { error: "Sesión administrativa requerida." },
          { status: 401 },
        );
    }

    if (
      action === "update-order" &&
      mutationScope === "courier" &&
      !courierActor
    )
      return NextResponse.json(
        { error: "Sesión de motorizado requerida." },
        { status: 401 },
      );

    if (action === "update-order" && mutationScope === "admin") {
      session ??= adminSession;
      if (!session)
        return NextResponse.json(
          { error: "Sesión requerida para actualizar pedidos." },
          { status: 401 },
        );
    }

    if (action === "save-product-catalog" && session?.role !== "superadmin")
      return NextResponse.json(
        { error: "Solo el superadmin puede modificar productos." },
        { status: 403 },
      );
    if (action === "save-courier-contact-settings" && session?.role !== "superadmin")
      return NextResponse.json(
        { error: "Solo el superadmin puede configurar los avisos." },
        { status: 403 },
      );
    if (
      ["delete-orders", "save-push-settings", "bootstrap"].includes(String(action)) &&
      session?.role !== "superadmin"
    )
      return NextResponse.json(
        { error: "Acceso exclusivo de Superadmin." },
        { status: 403 },
      );

    if (action === "create-order" || action === "update-order") {
      if (!validOrder(body.order))
        return NextResponse.json(
          { error: "Pedido inválido." },
          { status: 400 },
        );
      const previous = await sql<{ status: string; data: StoredOrder }[]>`
        select status, data from orders where id = ${body.order.id}
      `;
      if (action === "create-order" && previous[0])
        return NextResponse.json(
          { error: "Ya existe un pedido con ese código." },
          { status: 409 },
        );
      if (
        session &&
        session.role !== "superadmin" &&
        body.order.brand.toLowerCase() !== session.role
      )
        return NextResponse.json(
          { error: "No puedes modificar pedidos de otra empresa." },
          { status: 403 },
        );
      if (
        session &&
        session.role !== "superadmin" &&
        previous[0] &&
        previous[0].data.brand.toLowerCase() !== session.role
      )
        return NextResponse.json(
          { error: "No puedes modificar pedidos de otra empresa." },
          { status: 403 },
        );
      if (action === "create-order" || (action === "update-order" && !courierActor)) {
        if (!body.order.assignedCourierId)
          return NextResponse.json(
            { error: "Selecciona un motorizado para el pedido." },
            { status: 400 },
          );
        const assignmentChanged =
          action === "create-order" ||
          previous[0]?.data.assignedCourierId !== body.order.assignedCourierId;
        if (assignmentChanged) {
          const assignedCourier = await sql<{ id: string; full_name: string }[]>`
            select id, full_name from courier_users
            where id = ${body.order.assignedCourierId} and active = true
          `;
          if (!assignedCourier[0])
            return NextResponse.json(
              { error: "El motorizado seleccionado no está activo." },
              { status: 400 },
            );
          body.order.assignedCourierName = assignedCourier[0].full_name;
        } else if (previous[0]?.data.assignedCourierName) {
          body.order.assignedCourierName = previous[0].data.assignedCourierName;
        }
      }
      if (action === "update-order" && courierActor) {
        const storedOrder = previous[0]?.data;
        if (
          !storedOrder ||
          storedOrder.assignedCourierId !== courierActor.id ||
          body.order.assignedCourierId !== courierActor.id
        )
          return NextResponse.json(
            { error: "Este pedido no está asignado a tu cuenta." },
            { status: 403 },
          );
        body.order = {
          ...storedOrder,
          status: body.order.status,
          inventoryDeducted:
            body.order.status === "Entregado"
              ? true
              : storedOrder.inventoryDeducted,
        };
      }
      const storedOrder = body.order as StoredOrder;
      await deductDeliveredOrderInventory(previous[0]?.data, storedOrder);
      await upsertOrder(storedOrder);
      after(async () => {
        await notifyOrderEvent(action, storedOrder, previous[0]?.status);
      });
    } else if (action === "save-inventory") {
      if (!body.inventory || typeof body.inventory !== "object")
        return NextResponse.json(
          { error: "Inventario inválido." },
          { status: 400 },
        );
      const inventoryBrand =
        session?.role === "suyai"
          ? "Suyai"
          : session?.role === "aura"
            ? "Aura"
            : undefined;
      await replaceInventory(
        body.inventory as Record<string, unknown>,
        inventoryBrand,
      );
    } else if (action === "delete-orders") {
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id): id is string => typeof id === "string")
        : [];
      if (ids.length) {
        const photos = await sql<
          { blob_url: string }[]
        >`select blob_url from order_photos where order_id = any(${ids})`;
        await sql.begin(async (transaction) => {
          await transaction`delete from order_photos where order_id = any(${ids})`;
          await transaction`delete from orders where id = any(${ids})`;
        });
        const supabasePhotos = photos
          .map((photo) => photo.blob_url)
          .filter(isSupabaseEvidenceUrl)
          .map(evidencePathFromUrl);
        const legacyBlobPhotos = photos
          .map((photo) => photo.blob_url)
          .filter((url) => !isSupabaseEvidenceUrl(url));
        if (supabasePhotos.length) await deleteEvidence(supabasePhotos);
        if (legacyBlobPhotos.length && process.env.BLOB_READ_WRITE_TOKEN)
          await del(legacyBlobPhotos);
      }
    } else if (action === "save-push-settings") {
      const value =
        body.value && typeof body.value === "object" ? body.value : {};
      await sql`
        insert into app_settings (key, value, updated_at) values ('push-settings', ${sql.json(value as postgres.JSONValue)}, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()
      `;
    } else if (action === "save-product-catalog") {
      const catalog = cleanProductCatalog(body.catalog);
      const renameSource =
        body.rename && typeof body.rename === "object"
          ? (body.rename as Record<string, unknown>)
          : null;
      const rename = renameSource
        ? {
            brand:
              renameSource.brand === "Aura" ? ("Aura" as const) : ("Suyai" as const),
            oldName:
              typeof renameSource.oldName === "string"
                ? cleanProductName(renameSource.oldName)
                : "",
            newName:
              typeof renameSource.newName === "string"
                ? cleanProductName(renameSource.newName)
                : "",
          }
        : null;
      if (renameSource && (!rename?.oldName || !rename.newName))
        return NextResponse.json(
          { error: "Cambio de nombre inválido." },
          { status: 400 },
        );
      await sql.begin(async (transaction) => {
        await transaction`
          insert into app_settings (key, value, updated_at)
          values ('product-catalog', ${sql.json(catalog as unknown as postgres.JSONValue)}, now())
          on conflict (key) do update set value = excluded.value, updated_at = now()
        `;
        if (!rename) return;
        const rows = await transaction<{ key: string; quantity: number }[]>`
          select key, quantity from inventory where key like ${`${rename.brand}|%`}
        `;
        for (const row of rows) {
          const prefix = `${rename.brand}|`;
          const separator = row.key.indexOf("|", prefix.length);
          if (separator < 0 || row.key.slice(separator + 1) !== rename.oldName)
            continue;
          const nextKey = `${row.key.slice(0, separator + 1)}${rename.newName}`;
          await transaction`delete from inventory where key = ${row.key}`;
          await transaction`
            insert into inventory (key, quantity) values (${nextKey}, ${row.quantity})
            on conflict (key) do update set quantity = greatest(inventory.quantity, excluded.quantity)
          `;
        }
      });
    } else if (action === "save-courier-contact-settings") {
      const value = cleanContactSettings(body.value);
      await sql`
        insert into app_settings (key, value, updated_at)
        values ('courier-contact-settings', ${sql.json(value as unknown as postgres.JSONValue)}, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()
      `;
    } else if (action === "bootstrap") {
      const orders = Array.isArray(body.orders)
        ? body.orders.filter(validOrder)
        : [];
      for (const order of orders) {
        await sql`
          insert into orders (id, brand, delivery_date, status, data)
          values (${order.id}, ${order.brand}, ${order.deliveryDate || null}, ${order.status}, ${sql.json(order as unknown as postgres.JSONValue)})
          on conflict (id) do nothing
        `;
      }
      const count = await sql<
        { count: number }[]
      >`select count(*)::int as count from inventory`;
      if (
        !count[0]?.count &&
        body.inventory &&
        typeof body.inventory === "object"
      )
        await replaceInventory(body.inventory as Record<string, unknown>);
    } else {
      return NextResponse.json(
        { error: "Acción desconocida." },
        { status: 400 },
      );
    }
    const durationMs = Date.now() - startedAt;
    if (action === "create-order" || durationMs >= 1_000)
      console.info(JSON.stringify({
        level: "info",
        message: "cloud-state-mutation-complete",
        action,
        durationMs,
      }));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      message: "cloud-state-mutation-failed",
      action,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
    return NextResponse.json(
      { error: "No se pudo guardar en Supabase." },
      { status: 500 },
    );
  }
}
