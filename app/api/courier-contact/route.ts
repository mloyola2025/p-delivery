import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type postgres from "postgres";
import {
  buildEtaRange,
  buildMorningWhatsAppMessage,
  buildNextDeliveryWhatsAppMessage,
  buildWhatsAppUrl,
  DEFAULT_MORNING_TEMPLATE,
  DEFAULT_NEXT_DELIVERY_TEMPLATE,
  normalizePeruvianPhone,
  validCoordinates,
} from "../../courierContact";
import { getCloudDb, ensureCloudSchema } from "../../../lib/cloudDb";
import { resolveMapCoordinates } from "../../../lib/mapCoordinates";
import { calculateRouteDuration } from "../../../lib/routeEtaProvider";
import {
  COURIER_SESSION_COOKIE,
  readCourierSession,
} from "../../courierAuth";
import { bodyTooLarge, rejectCrossSiteMutation } from "../../requestSecurity";

type StoredOrder = {
  id: string;
  brand: string;
  client: string;
  phone?: string;
  maps?: string;
  status: string;
  deliveryDate?: string;
  [key: string]: unknown;
};

type ContactSettings = {
  etaBufferBeforeMinutes: number;
  etaBufferAfterMinutes: number;
  maxAccuracyMeters: number;
  reuseLocationMinutes: number;
  countryCode: string;
  allowForcedNotice: boolean;
  morningTemplates?: Record<string, string>;
  nextDeliveryTemplates?: Record<string, string>;
};

const FINAL_STATUSES = new Set(["Entregado", "Cancelado", "Devolución"]);

function integerSetting(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.round(parsed)))
    : fallback;
}

async function contactSettings() {
  const sql = getCloudDb();
  const rows = await sql<{ value: Partial<ContactSettings> }[]>`
    select value from app_settings where key = 'courier-contact-settings'
  `;
  const value = rows[0]?.value ?? {};
  return {
    etaBufferBeforeMinutes: integerSetting(
      process.env.ETA_BUFFER_BEFORE_MINUTES ?? value.etaBufferBeforeMinutes,
      2,
      0,
      30,
    ),
    etaBufferAfterMinutes: integerSetting(
      process.env.ETA_BUFFER_AFTER_MINUTES ?? value.etaBufferAfterMinutes,
      8,
      1,
      60,
    ),
    maxAccuracyMeters: integerSetting(
      process.env.ETA_MAX_ACCURACY_METERS ?? value.maxAccuracyMeters,
      100,
      20,
      1000,
    ),
    reuseLocationMinutes: integerSetting(
      process.env.ETA_REUSE_LOCATION_MINUTES ?? value.reuseLocationMinutes,
      10,
      1,
      60,
    ),
    countryCode: String(value.countryCode || process.env.DEFAULT_COUNTRY_CODE || "51")
      .replace(/\D/g, "")
      .slice(0, 4) || "51",
    allowForcedNotice: value.allowForcedNotice !== false,
    morningTemplates: value.morningTemplates ?? {},
    nextDeliveryTemplates: value.nextDeliveryTemplates ?? {},
  } satisfies ContactSettings;
}

function validTemplate(
  value: string | undefined,
  requiredVariables: string[],
  fallback: string,
) {
  return value && requiredVariables.every((variable) => value.includes(`{${variable}}`))
    ? value
    : fallback;
}

async function storedOrder(orderId: string) {
  const sql = getCloudDb();
  const rows = await sql<{ data: StoredOrder }[]>`
    select data from orders where id = ${orderId}
  `;
  return rows[0]?.data ?? null;
}

async function rateLimit(courierId: string) {
  const sql = getCloudDb();
  const rows = await sql<{ count: number }[]>`
    select count(*)::int as count from customer_contact_events
    where courier_id = ${courierId} and created_at > now() - interval '5 minutes'
  `;
  return (rows[0]?.count ?? 0) < 12;
}

type ExistingEvent = {
  id: string;
  order_id: string;
  event_type: "morning_notice" | "next_delivery_notice";
  phone: string;
  message_snapshot: string;
  eta_start: Date | null;
  eta_end: Date | null;
  calculated_duration_minutes: number | null;
  route_provider: string | null;
  forced: boolean;
  created_at: Date;
};

function eventResponse(
  event: ExistingEvent,
  countryCode: string,
  extra: Record<string, unknown> = {},
) {
  const whatsappUrl = buildWhatsAppUrl({
    phone: event.phone,
    message: event.message_snapshot,
    countryCode,
  });
  if (!whatsappUrl) throw new Error("No se pudo reconstruir WhatsApp.");
  return {
    eventId: event.id,
    orderId: event.order_id,
    eventType: event.event_type,
    whatsappUrl,
    message: event.message_snapshot,
    preparedAt: event.created_at.toISOString(),
    etaStart: event.eta_start?.toISOString(),
    etaEnd: event.eta_end?.toISOString(),
    etaStartLabel: event.eta_start
      ? new Intl.DateTimeFormat("es-PE", {
          timeZone: "America/Lima",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).format(event.eta_start)
      : undefined,
    etaEndLabel: event.eta_end
      ? new Intl.DateTimeFormat("es-PE", {
          timeZone: "America/Lima",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).format(event.eta_end)
      : undefined,
    durationMinutes: event.calculated_duration_minutes ?? undefined,
    provider: event.route_provider ?? undefined,
    isMock: event.route_provider === "mock",
    forced: event.forced,
    ...extra,
  };
}

async function recentDuplicate(
  orderId: string,
  courierId: string,
  eventType: string,
) {
  const sql = getCloudDb();
  const rows = await sql<ExistingEvent[]>`
    select id, order_id, event_type, phone, message_snapshot, eta_start, eta_end,
      calculated_duration_minutes, route_provider, forced, created_at
    from customer_contact_events
    where order_id = ${orderId} and courier_id = ${courierId}
      and event_type = ${eventType}
      and created_at > now() - interval '20 seconds'
    order by created_at desc limit 1
  `;
  return rows[0] ?? null;
}

function errorResponse(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status });
}

export async function GET(request: Request) {
  try {
    await ensureCloudSchema();
    void request;
    const courier = await readCourierSession(
      (await cookies()).get(COURIER_SESSION_COOKIE)?.value,
    );
    if (!courier)
      return errorResponse("Sesión de motorizado requerida.", "UNAUTHORIZED", 401);
    const sql = getCloudDb();
    const events = await sql`
      select id, order_id, event_type, status, eta_start, eta_end,
        route_provider, forced, created_at
      from customer_contact_events
      where courier_id = ${courier.id}
      order by created_at desc limit 100
    `;
    return NextResponse.json({ events });
  } catch (error) {
    console.error("courier-contact-history", error);
    return errorResponse("No se pudo consultar el historial de avisos.", "HISTORY_ERROR", 500);
  }
}

export async function POST(request: Request) {
  try {
    const rejected = rejectCrossSiteMutation(request);
    if (rejected) return rejected;
    if (bodyTooLarge(request, 64_000))
      return errorResponse("Solicitud demasiado grande.", "PAYLOAD_TOO_LARGE", 413);
    await ensureCloudSchema();
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "");
    const courier = await readCourierSession(
      (await cookies()).get(COURIER_SESSION_COOKIE)?.value,
    );
    if (!courier)
      return errorResponse("Sesión de motorizado requerida.", "UNAUTHORIZED", 401);
    const courierId = courier.id;
    const sql = getCloudDb();

    if (action === "opened") {
      const eventId = typeof body.eventId === "string" ? body.eventId : "";
      await sql`
        update customer_contact_events set status = 'opened_whatsapp'
        where id = ${eventId} and courier_id = ${courierId}
      `;
      return NextResponse.json({ ok: true });
    }

    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const order = orderId ? await storedOrder(orderId) : null;
    if (!order) return errorResponse("Pedido no encontrado.", "ORDER_NOT_FOUND", 404);
    if (FINAL_STATUSES.has(order.status))
      return errorResponse(
        "Este pedido ya está finalizado y no puede generar avisos.",
        "ORDER_FINALIZED",
        409,
      );
    const settings = await contactSettings();
    const phone = normalizePeruvianPhone(order.phone ?? "", settings.countryCode);
    if (!phone)
      return errorResponse(
        "El pedido no tiene un teléfono válido.",
        "INVALID_PHONE",
      );
    if (!(await rateLimit(courierId)))
      return errorResponse(
        "Has preparado varios avisos. Espera unos minutos.",
        "RATE_LIMITED",
        429,
      );

    const eventType =
      action === "morning"
        ? "morning_notice"
        : action === "next-delivery"
          ? "next_delivery_notice"
          : "";
    if (!eventType)
      return errorResponse("Acción inválida.", "INVALID_ACTION");
    const duplicate = await recentDuplicate(orderId, courierId, eventType);
    if (duplicate)
      return NextResponse.json(
        eventResponse(duplicate, settings.countryCode, { duplicate: true }),
      );

    const businessName = order.brand.trim() || "P-delivery";
    const courierName = courier.fullName;
    const now = new Date();

    if (eventType === "morning_notice") {
      const template = validTemplate(
        settings.morningTemplates?.[businessName],
        ["customer_name", "order_number", "courier_intro"],
        DEFAULT_MORNING_TEMPLATE,
      );
      const message = buildMorningWhatsAppMessage({
        customerName: order.client,
        orderNumber: order.id,
        businessName,
        courierName,
        template,
      });
      const eventId = crypto.randomUUID();
      const idempotencyKey = `morning:${order.id}:${courierId}:${Math.floor(now.getTime() / 20_000)}`;
      const rows = await sql<ExistingEvent[]>`
        insert into customer_contact_events (
          id, order_id, courier_id, business_id, event_type, phone,
          message_snapshot, status, idempotency_key
        ) values (
          ${eventId}, ${order.id}, ${courierId}, ${businessName.toLowerCase()},
          'morning_notice', ${phone}, ${message}, 'prepared', ${idempotencyKey}
        ) on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
        returning id, order_id, event_type, phone, message_snapshot, eta_start,
          eta_end, calculated_duration_minutes, route_provider, forced, created_at
      `;
      return NextResponse.json(eventResponse(rows[0], settings.countryCode));
    }

    const forced = Boolean(body.forced);
    if (forced && !settings.allowForcedNotice)
      return errorResponse(
        "Los avisos forzados están desactivados.",
        "FORCED_NOTICE_DISABLED",
        403,
      );
    const destination = order.maps
      ? await resolveMapCoordinates(order.maps)
      : null;
    if (!destination)
      return errorResponse(
        "El pedido no tiene coordenadas válidas en Google Maps.",
        "DESTINATION_COORDINATES_MISSING",
      );

    let location:
      | { latitude: number; longitude: number; accuracy: number; timestamp: number }
      | undefined;
    let usedPreviousLocation = false;
    let previousLocationAgeMinutes: number | undefined;
    if (body.location && typeof body.location === "object") {
      const source = body.location as Record<string, unknown>;
      location = {
        latitude: Number(source.latitude),
        longitude: Number(source.longitude),
        accuracy: Number(source.accuracy),
        timestamp: Number(source.timestamp),
      };
      if (
        !validCoordinates(location.latitude, location.longitude) ||
        !Number.isFinite(location.accuracy) ||
        location.accuracy < 0 ||
        !Number.isFinite(location.timestamp)
      )
        return errorResponse("Ubicación inválida.", "INVALID_LOCATION");
      if (
        location.accuracy > settings.maxAccuracyMeters &&
        body.allowLowAccuracy !== true
      )
        return errorResponse(
          "La ubicación tiene baja precisión.",
          "LOW_ACCURACY",
          422,
        );
      await sql`
        insert into courier_location_events (
          id, courier_id, order_id, latitude, longitude, accuracy_meters,
          source, captured_at
        ) values (
          ${crypto.randomUUID()}, ${courierId}, ${order.id}, ${location.latitude},
          ${location.longitude}, ${location.accuracy}, 'next_delivery_whatsapp',
          ${new Date(location.timestamp)}
        )
      `;
    } else if (body.useLastLocation === true) {
      const rows = await sql<
        {
          latitude: number;
          longitude: number;
          accuracy_meters: number;
          captured_at: Date;
        }[]
      >`
        select latitude, longitude, accuracy_meters, captured_at
        from courier_location_events
        where courier_id = ${courierId}
          and accuracy_meters <= ${settings.maxAccuracyMeters}
          and captured_at > now() - (${settings.reuseLocationMinutes} * interval '1 minute')
        order by captured_at desc limit 1
      `;
      const recent = rows[0];
      if (!recent)
        return errorResponse(
          "No existe una ubicación reciente que pueda reutilizarse.",
          "NO_RECENT_LOCATION",
        );
      location = {
        latitude: recent.latitude,
        longitude: recent.longitude,
        accuracy: recent.accuracy_meters,
        timestamp: recent.captured_at.getTime(),
      };
      usedPreviousLocation = true;
      previousLocationAgeMinutes = Math.max(
        0,
        Math.round((Date.now() - recent.captured_at.getTime()) / 60_000),
      );
    } else {
      return errorResponse(
        "Necesitamos tu ubicación puntual para calcular la llegada.",
        "LOCATION_REQUIRED",
      );
    }

    const route = await calculateRouteDuration(location, destination);
    const eta = buildEtaRange(
      now,
      route.durationMinutes,
      settings.etaBufferBeforeMinutes,
      settings.etaBufferAfterMinutes,
    );
    const template = validTemplate(
      settings.nextDeliveryTemplates?.[businessName],
      ["customer_name", "order_number", "courier_intro", "eta_start", "eta_end"],
      DEFAULT_NEXT_DELIVERY_TEMPLATE,
    );
    const message = buildNextDeliveryWhatsAppMessage({
      customerName: order.client,
      orderNumber: order.id,
      businessName,
      courierName,
      etaStart: eta.startLabel,
      etaEnd: eta.endLabel,
      template,
    });
    const eventId = crypto.randomUUID();
    const idempotencyKey = `next:${order.id}:${courierId}:${Math.floor(now.getTime() / 20_000)}`;
    const rows = await sql<ExistingEvent[]>`
      insert into customer_contact_events (
        id, order_id, courier_id, business_id, event_type, phone,
        message_snapshot, gps_latitude, gps_longitude, gps_accuracy_meters,
        calculated_duration_minutes, eta_start, eta_end, route_provider,
        forced, status, idempotency_key
      ) values (
        ${eventId}, ${order.id}, ${courierId}, ${businessName.toLowerCase()},
        'next_delivery_notice', ${phone}, ${message}, ${location.latitude},
        ${location.longitude}, ${location.accuracy}, ${route.durationMinutes},
        ${eta.start}, ${eta.end}, ${route.provider}, ${forced}, 'prepared',
        ${idempotencyKey}
      ) on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
      returning id, order_id, event_type, phone, message_snapshot, eta_start,
        eta_end, calculated_duration_minutes, route_provider, forced, created_at
    `;
    await sql`
      update orders set data = data || ${sql.json({ lastCustomerNoticeAt: now.toISOString() } as postgres.JSONValue)},
        updated_at = now()
      where id = ${order.id}
    `;
    return NextResponse.json(
      eventResponse(rows[0], settings.countryCode, {
        isMock: route.isMock,
        usedPreviousLocation,
        previousLocationAgeMinutes,
      }),
    );
  } catch (error) {
    console.error("courier-contact", error);
    return errorResponse(
      "No se pudo preparar el aviso. Intenta nuevamente.",
      "CONTACT_ERROR",
      500,
    );
  }
}
