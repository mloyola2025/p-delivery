export type Coordinates = { latitude: number; longitude: number };

export const RIMAC_WAREHOUSE_COORDINATES: Coordinates = {
  latitude: -12.041278,
  longitude: -77.026382,
};

export function extractMapCoordinates(value: string): Coordinates | null {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {}

  const patterns = [
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,
    /\/(?:search|dir)\/(-?\d{1,2}\.\d+),\+?(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+)(?:,|\+|%20|\s)+(-?\d{1,3}\.\d+)/,
    /(?:center|ll)=(-?\d{1,2}\.\d+)(?:,|%2C)(-?\d{1,3}\.\d+)/i,
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      return { latitude, longitude };
    }
  }

  // Some Google Maps payloads store longitude before latitude.
  const longitudeLatitudeMatch = decoded.match(
    /!2d(-?\d{1,3}\.\d+)!3d(-?\d{1,2}\.\d+)/,
  );
  if (longitudeLatitudeMatch) {
    const latitude = Number(longitudeLatitudeMatch[2]);
    const longitude = Number(longitudeLatitudeMatch[1]);
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    ) {
      return { latitude, longitude };
    }
  }

  return null;
}

export function distanceFromRimac(coordinates: Coordinates) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(coordinates.latitude - RIMAC_WAREHOUSE_COORDINATES.latitude);
  const longitudeDelta = toRadians(coordinates.longitude - RIMAC_WAREHOUSE_COORDINATES.longitude);
  const startLatitude = toRadians(RIMAC_WAREHOUSE_COORDINATES.latitude);
  const endLatitude = toRadians(coordinates.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  const distance = 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
  return Math.round(distance * 10) / 10;
}
