import {
  extractMapCoordinates,
  RIMAC_WAREHOUSE_COORDINATES,
  type Coordinates,
} from "../app/mapDistance";

const ALLOWED_MAP_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "www.google.com",
]);

export function allowedGoogleMapsUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && ALLOWED_MAP_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function extractGoogleMapsAddress(value: string) {
  try {
    const parsed = new URL(value);
    const address =
      parsed.searchParams.get("q") ||
      parsed.searchParams.get("query") ||
      parsed.searchParams.get("destination");
    if (!address || extractMapCoordinates(address)) return null;
    const normalized = address.replace(/\+/g, " ").trim();
    return normalized.length >= 5 && normalized.length <= 500
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function isInLimaOperationArea(coordinates: Coordinates) {
  return (
    coordinates.latitude >= -13.2 &&
    coordinates.latitude <= -11.5 &&
    coordinates.longitude >= -77.8 &&
    coordinates.longitude <= -76.4
  );
}

export function extractOperationalMapCoordinates(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {}

  const latitudeLongitudePatterns = [
    /(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/g,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/g,
  ];
  for (const pattern of latitudeLongitudePatterns) {
    for (const match of decoded.matchAll(pattern)) {
      const coordinates = {
        latitude: Number(match[1]),
        longitude: Number(match[2]),
      };
      if (isInLimaOperationArea(coordinates)) return coordinates;
    }
  }

  for (const match of decoded.matchAll(
    /!2d(-?\d{1,3}\.\d+)!3d(-?\d{1,2}\.\d+)/g,
  )) {
    const coordinates = {
      latitude: Number(match[2]),
      longitude: Number(match[1]),
    };
    if (isInLimaOperationArea(coordinates)) return coordinates;
  }
  return null;
}

async function geocodeAddress(address: string): Promise<Coordinates | null> {
  const apiKey =
    process.env.GOOGLE_MAPS_ROUTES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const routesResponse = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.legs.endLocation",
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: RIMAC_WAREHOUSE_COORDINATES,
          },
        },
        destination: { address },
        travelMode: "DRIVE",
        languageCode: "es-PE",
        regionCode: "PE",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (routesResponse.ok) {
    const routesPayload = (await routesResponse.json()) as {
      routes?: Array<{
        legs?: Array<{
          endLocation?: {
            latLng?: { latitude?: number; longitude?: number };
          };
        }>;
      }>;
    };
    const routeLocation =
      routesPayload.routes?.[0]?.legs?.at(-1)?.endLocation?.latLng;
    if (
      typeof routeLocation?.latitude === "number" &&
      typeof routeLocation.longitude === "number"
    ) {
      return {
        latitude: routeLocation.latitude,
        longitude: routeLocation.longitude,
      };
    }
  }

  const endpoint = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  endpoint.searchParams.set("address", address);
  endpoint.searchParams.set("region", "pe");
  endpoint.searchParams.set("language", "es");
  endpoint.searchParams.set("key", apiKey);
  const response = await fetch(endpoint, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    status?: string;
    results?: Array<{
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };
  const location = payload.results?.[0]?.geometry?.location;
  if (
    payload.status !== "OK" ||
    !Number.isFinite(location?.lat) ||
    !Number.isFinite(location?.lng)
  ) {
    return null;
  }
  return { latitude: location!.lat!, longitude: location!.lng! };
}

export async function resolveMapCoordinates(
  mapUrl: string,
): Promise<Coordinates | null> {
  if (!allowedGoogleMapsUrl(mapUrl)) return null;
  const directCoordinates = extractMapCoordinates(mapUrl);
  if (directCoordinates) return directCoordinates;
  try {
    const response = await fetch(mapUrl, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; PDeliveryLogistics/1.0)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const coordinates = extractMapCoordinates(response.url);
    if (coordinates) return coordinates;

    // Current Google short links often expand to `?q=<address>` without
    // coordinates. Geocoding that address is authoritative and avoids using
    // Google's server-region map center as if it were the delivery point.
    const address = extractGoogleMapsAddress(response.url);
    if (address) {
      const geocoded = await geocodeAddress(address);
      if (geocoded) return geocoded;
    }

    return extractOperationalMapCoordinates(await response.text());
  } catch {
    return null;
  }
}
