export type CourierLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

export type EtaRange = {
  start: Date;
  end: Date;
  startLabel: string;
  endLabel: string;
};

export type CourierContactSettings = {
  etaBufferBeforeMinutes: number;
  etaBufferAfterMinutes: number;
  maxAccuracyMeters: number;
  reuseLocationMinutes: number;
  countryCode: string;
  allowForcedNotice: boolean;
  morningTemplates: Record<"Suyai" | "Aura", string>;
  nextDeliveryTemplates: Record<"Suyai" | "Aura", string>;
};

export const DELIVERY_COMPANY_NAME = "Pegasus Delivery";

export const DEFAULT_MORNING_TEMPLATE = `Hola, {customer_name} 👋

{courier_intro}

Hoy estaré realizando la entrega de tu pedido #{order_number}.

Te avisaré nuevamente cuando seas la siguiente entrega para que puedas estar pendiente de tu teléfono.`;

export const DEFAULT_NEXT_DELIVERY_TEMPLATE = `Hola, {customer_name} 👋

{courier_intro}

Tu pedido #{order_number} es mi siguiente entrega.

Según mi ubicación actual, estaré llegando aproximadamente entre las {eta_start} y las {eta_end}.

Por favor, mantente pendiente de tu teléfono.`;

export const DEFAULT_COURIER_CONTACT_SETTINGS: CourierContactSettings = {
  etaBufferBeforeMinutes: 2,
  etaBufferAfterMinutes: 8,
  maxAccuracyMeters: 100,
  reuseLocationMinutes: 10,
  countryCode: "51",
  allowForcedNotice: true,
  morningTemplates: {
    Suyai: DEFAULT_MORNING_TEMPLATE,
    Aura: DEFAULT_MORNING_TEMPLATE,
  },
  nextDeliveryTemplates: {
    Suyai: DEFAULT_NEXT_DELIVERY_TEMPLATE,
    Aura: DEFAULT_NEXT_DELIVERY_TEMPLATE,
  },
};

export function normalizePeruvianPhone(
  value: string,
  countryCode = "51",
) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 9) digits = `${countryCode}${digits}`;
  if (!digits.startsWith(countryCode) || digits.length !== countryCode.length + 9)
    return null;
  return digits;
}

export function buildWhatsAppUrl({
  phone,
  message,
  countryCode = "51",
}: {
  phone: string;
  message: string;
  countryCode?: string;
}) {
  const normalizedPhone = normalizePeruvianPhone(phone, countryCode);
  if (!normalizedPhone || !message.trim()) return null;
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
}

export function courierIntroduction(
  businessName: string,
  courierName?: string | null,
) {
  const name = courierName?.trim();
  return name
    ? `Somos de la empresa ${DELIVERY_COMPANY_NAME}. Mi nombre es ${name} y tenemos un pedido para usted de la empresa ${businessName}.`
    : `Somos de la empresa ${DELIVERY_COMPANY_NAME} y tenemos un pedido para usted de la empresa ${businessName}.`;
}

function applyTemplate(
  template: string,
  values: Record<string, string>,
) {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? values[key] : match,
  );
}

export function buildMorningWhatsAppMessage({
  customerName,
  orderNumber,
  businessName,
  courierName,
  template = DEFAULT_MORNING_TEMPLATE,
}: {
  customerName: string;
  orderNumber: string;
  businessName: string;
  courierName?: string | null;
  template?: string;
}) {
  return applyTemplate(template, {
    customer_name: customerName.trim() || "cliente",
    order_number: orderNumber,
    business_name: businessName,
    delivery_company: DELIVERY_COMPANY_NAME,
    courier_name: courierName?.trim() || "",
    courier_intro: courierIntroduction(businessName, courierName),
  });
}

export function buildNextDeliveryWhatsAppMessage({
  customerName,
  orderNumber,
  businessName,
  courierName,
  etaStart,
  etaEnd,
  template = DEFAULT_NEXT_DELIVERY_TEMPLATE,
}: {
  customerName: string;
  orderNumber: string;
  businessName: string;
  courierName?: string | null;
  etaStart: string;
  etaEnd: string;
  template?: string;
}) {
  return applyTemplate(template, {
    customer_name: customerName.trim() || "cliente",
    order_number: orderNumber,
    business_name: businessName,
    delivery_company: DELIVERY_COMPANY_NAME,
    courier_name: courierName?.trim() || "",
    courier_intro: courierIntroduction(businessName, courierName),
    eta_start: etaStart,
    eta_end: etaEnd,
  });
}

export function formatLimaTime(value: Date) {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(value)
    .replace(/\s+/g, " ");
}

export function buildEtaRange(
  now: Date,
  durationMinutes: number,
  beforeMinutes = 2,
  afterMinutes = 8,
): EtaRange {
  const safeDuration = Math.max(1, Math.ceil(durationMinutes));
  const centralTime = now.getTime() + safeDuration * 60_000;
  const start = new Date(
    Math.max(now.getTime(), centralTime - Math.max(0, beforeMinutes) * 60_000),
  );
  const end = new Date(
    Math.max(start.getTime() + 60_000, centralTime + Math.max(0, afterMinutes) * 60_000),
  );
  return {
    start,
    end,
    startLabel: formatLimaTime(start),
    endLabel: formatLimaTime(end),
  };
}

export function validCoordinates(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}
