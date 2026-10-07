import type { CourierLocation } from "./courierContact";

export type CustomerContactResult = {
  eventId: string;
  orderId: string;
  eventType: "morning_notice" | "next_delivery_notice";
  whatsappUrl: string;
  message: string;
  preparedAt: string;
  etaStart?: string;
  etaEnd?: string;
  etaStartLabel?: string;
  etaEndLabel?: string;
  durationMinutes?: number;
  provider?: string;
  isMock?: boolean;
  forced?: boolean;
  usedPreviousLocation?: boolean;
  previousLocationAgeMinutes?: number;
};

export type CustomerContactHistoryItem = {
  id: string;
  order_id: string;
  event_type: "morning_notice" | "next_delivery_notice";
  status: string;
  eta_start: string | null;
  eta_end: string | null;
  route_provider: string | null;
  forced: boolean;
  created_at: string;
};

export function getCurrentCourierLocation(timeout = 12_000) {
  return new Promise<CourierLocation>((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("GPS_UNAVAILABLE"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED)
          reject(new Error("GPS_PERMISSION_DENIED"));
        else if (error.code === error.TIMEOUT)
          reject(new Error("GPS_TIMEOUT"));
        else reject(new Error("GPS_UNAVAILABLE"));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

async function postContact(payload: Record<string, unknown>) {
  const response = await fetch("/api/courier-contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => ({}))) as
    | CustomerContactResult
    | { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(
      "error" in result && result.error ? result.error : "No se pudo preparar el aviso.",
    );
    Object.assign(error, { code: "code" in result ? result.code : undefined });
    throw error;
  }
  return result as CustomerContactResult;
}

export function registerCustomerNotification({
  orderId,
  courierName,
}: {
  orderId: string;
  courierName?: string;
}) {
  return postContact({ action: "morning", orderId, courierName });
}

export function calculateTravelDuration({
  orderId,
  location,
  forced = false,
  useLastLocation = false,
  allowLowAccuracy = false,
  courierName,
}: {
  orderId: string;
  location?: CourierLocation;
  forced?: boolean;
  useLastLocation?: boolean;
  allowLowAccuracy?: boolean;
  courierName?: string;
}) {
  return postContact({
    action: "next-delivery",
    orderId,
    location,
    forced,
    useLastLocation,
    allowLowAccuracy,
    courierName,
  });
}

export function markCustomerContactOpened(eventId: string) {
  return fetch("/api/courier-contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "opened", eventId }),
    keepalive: true,
  });
}

export async function getCustomerContactHistory() {
  const response = await fetch("/api/courier-contact", { cache: "no-store" });
  if (!response.ok) return [];
  const result = (await response.json()) as {
    events?: CustomerContactHistoryItem[];
  };
  return result.events ?? [];
}
