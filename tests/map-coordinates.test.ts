import assert from "node:assert/strict";
import test from "node:test";
import { extractMapCoordinates } from "../app/mapDistance";
import {
  extractGoogleMapsAddress,
  extractOperationalMapCoordinates,
} from "../lib/mapCoordinates";

test("extracts coordinates from the current Google Maps center payload", () => {
  assert.deepEqual(
    extractMapCoordinates(
      "https://www.google.com/maps?q=Direccion&center=-12.0120683%2C-77.0899968",
    ),
    { latitude: -12.0120683, longitude: -77.0899968 },
  );
});

test("extracts the destination address from an expanded Google Maps link", () => {
  assert.equal(
    extractGoogleMapsAddress(
      "https://www.google.com/maps?q=C.+Jose+Bernardo+Alced+Mz.I+-+Lt.24,+San+Mart%C3%ADn+de+Porres+15108&ftid=example",
    ),
    "C. Jose Bernardo Alced Mz.I - Lt.24, San Martín de Porres 15108",
  );
});

test("ignores a Google server center outside Lima and selects the delivery point", () => {
  assert.deepEqual(
    extractOperationalMapCoordinates(
      "center=39.02679945,-77.844326 data=!3d-12.0120683!4d-77.0899968",
    ),
    { latitude: -12.0120683, longitude: -77.0899968 },
  );
});

test("extracts coordinates from Google Maps protobuf payloads", () => {
  assert.deepEqual(
    extractMapCoordinates("data=!3d-12.0120683!4d-77.0899968"),
    { latitude: -12.0120683, longitude: -77.0899968 },
  );
  assert.deepEqual(
    extractMapCoordinates("data=!2d-77.0899968!3d-12.0120683"),
    { latitude: -12.0120683, longitude: -77.0899968 },
  );
});
