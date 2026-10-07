import type { Coordinates } from "../app/mapDistance";

export type RouteDurationResult = {
  durationMinutes: number;
  distanceMeters: number | null;
  provider: "google-routes" | "mock";
  isMock: boolean;
};

function parseDurationSeconds(value?: string) {
  const seconds = Number(value?.replace(/s$/, ""));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export async function calculateRouteDuration(
  origin: Coordinates,
  destination: Coordinates,
): Promise<RouteDurationResult> {
  const apiKey =
    process.env.GOOGLE_MAPS_ROUTES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      durationMinutes: Math.max(
        1,
        Number(process.env.ETA_MOCK_DURATION_MINUTES) || 25,
      ),
      distanceMeters: null,
      provider: "mock",
      isMock: true,
    };
  }

  const response = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: origin.latitude,
              longitude: origin.longitude,
            },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: destination.latitude,
              longitude: destination.longitude,
            },
          },
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
        trafficModel: "BEST_GUESS",
        languageCode: "es-PE",
        units: "METRIC",
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new Error(`Google Routes respondió ${response.status}.`);
  const result = (await response.json()) as {
    routes?: Array<{ duration?: string; distanceMeters?: number }>;
  };
  const route = result.routes?.[0];
  const durationSeconds = parseDurationSeconds(route?.duration);
  if (!durationSeconds) throw new Error("Google Routes no devolvió duración.");
  return {
    durationMinutes: Math.max(1, Math.ceil(durationSeconds / 60)),
    distanceMeters: route?.distanceMeters ?? null,
    provider: "google-routes",
    isMock: false,
  };
}
