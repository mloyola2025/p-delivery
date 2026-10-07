import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildEtaRange,
  buildMorningWhatsAppMessage,
  buildNextDeliveryWhatsAppMessage,
  buildWhatsAppUrl,
  normalizePeruvianPhone,
  validCoordinates,
} from "../app/courierContact";
import {
  inventoryBalanceAfterDelivery,
  inventoryBalanceAfterEntry,
  withInventoryBalance,
} from "../app/inventoryStock";
import {
  hashCourierPassword,
  normalizeCourierUsername,
  validAccountPassword,
  validCourierUsername,
  verifyCourierPassword,
} from "../app/courierAuth";

test("normaliza teléfonos peruanos y rechaza números inválidos", () => {
  assert.equal(normalizePeruvianPhone("987 654 321"), "51987654321");
  assert.equal(normalizePeruvianPhone("+51 987-654-321"), "51987654321");
  assert.equal(normalizePeruvianPhone("123"), null);
  assert.equal(normalizePeruvianPhone("519876543210"), null);
});

test("crea URLs wa.me seguras y codifica caracteres especiales", () => {
  const url = buildWhatsAppUrl({
    phone: "987654321",
    message: "Hola José 👋\nLlegaré 10:30 a. m. & confirmaré.",
  });
  assert.ok(url?.startsWith("https://wa.me/51987654321?text="));
  assert.ok(url?.includes("%F0%9F%91%8B"));
  assert.ok(!url?.includes("José"));
});

test("presenta a Pegasus Delivery como courier y a Suyai como empresa del pedido", () => {
  const named = buildMorningWhatsAppMessage({
    customerName: "Ana",
    orderNumber: "SY-001",
    businessName: "Suyai Envíos",
    courierName: "Luis",
  });
  assert.match(named, /Somos de la empresa Pegasus Delivery/);
  assert.match(named, /Mi nombre es Luis/);
  assert.match(named, /pedido para usted de la empresa Suyai Envíos/);
  assert.doesNotMatch(named, /motorizado de Suyai/);
  assert.match(named, /pedido #SY-001/);

  const unnamed = buildMorningWhatsAppMessage({
    customerName: "",
    orderNumber: "SY-002",
    businessName: "Suyai Envíos",
  });
  assert.match(unnamed, /Hola, cliente/);
  assert.match(
    unnamed,
    /Somos de la empresa Pegasus Delivery y tenemos un pedido para usted de la empresa Suyai Envíos/,
  );
  assert.doesNotMatch(unnamed, /motorizado de Suyai/);
});

test("genera aviso Aura de próxima entrega con rango ETA", () => {
  const message = buildNextDeliveryWhatsAppMessage({
    customerName: "María",
    orderNumber: "AU-010",
    businessName: "Aura Envíos",
    etaStart: "10:23 a. m.",
    etaEnd: "10:33 a. m.",
  });
  assert.match(message, /Aura Envíos/);
  assert.match(message, /Somos de la empresa Pegasus Delivery/);
  assert.match(message, /pedido para usted de la empresa Aura Envíos/);
  assert.match(message, /10:23 a\. m\./);
  assert.match(message, /10:33 a\. m\./);
});

test("calcula el rango ETA con margen configurable y hora Lima", () => {
  const range = buildEtaRange(new Date("2026-07-16T15:00:00.000Z"), 30, 2, 8);
  assert.equal(range.start.toISOString(), "2026-07-16T15:28:00.000Z");
  assert.equal(range.end.toISOString(), "2026-07-16T15:38:00.000Z");
  assert.match(range.startLabel, /10:28/);
  assert.match(range.endLabel, /10:38/);
});

test("valida coordenadas antes de enviarlas al servidor", () => {
  assert.equal(validCoordinates(-12.0464, -77.0428), true);
  assert.equal(validCoordinates(91, -77), false);
  assert.equal(validCoordinates(Number.NaN, -77), false);
});

test("el inventario permite faltantes, suma ingresos y vuelve a cero", () => {
  assert.equal(inventoryBalanceAfterDelivery(0, 5), -5);
  assert.equal(inventoryBalanceAfterDelivery(2, 5), -3);
  assert.equal(inventoryBalanceAfterEntry(-5, 3), -2);
  assert.equal(inventoryBalanceAfterEntry(-5, 10), 5);
  assert.throws(() => inventoryBalanceAfterEntry(4, 0));
  assert.deepEqual(withInventoryBalance({ producto: -5 }, "producto", 0), {});
});

test("las contraseñas de motorizados usan hash con sal y validación segura", async () => {
  const hash = await hashCourierPassword("Motorizado2026@");
  assert.match(hash, /^pbkdf2_sha256\$210000\$/);
  assert.equal(await verifyCourierPassword("Motorizado2026@", hash), true);
  assert.equal(await verifyCourierPassword("incorrecta", hash), false);
  assert.notEqual(hash, await hashCourierPassword("Motorizado2026@"));
  assert.equal(validAccountPassword("1"), true);
  assert.equal(validAccountPassword("simple"), true);
  assert.equal(validAccountPassword(""), false);
  assert.equal(validAccountPassword("x".repeat(129)), false);
});

test("normaliza y valida usuarios de motorizados", () => {
  assert.equal(normalizeCourierUsername("  Luis.Garcia "), "luis.garcia");
  assert.equal(validCourierUsername("luis.garcia"), true);
  assert.equal(validCourierUsername("ab"), false);
  assert.equal(validCourierUsername("nombre con espacios"), false);
});

test("la administración de motorizados está restringida al superadmin", () => {
  const api = readFileSync(new URL("../app/api/couriers/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/motorizado/page.tsx", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../app/courierAuth.ts", import.meta.url), "utf8");
  assert.match(api, /session\?\.role !== "superadmin"/);
  assert.match(api, /export async function POST/);
  assert.match(api, /export async function PATCH/);
  assert.match(api, /export async function DELETE/);
  assert.match(api, /courier-disabled/);
  assert.match(page, /readCourierSession/);
  assert.match(page, /redirect\(`\/acceso-motorizado/);
  assert.match(auth, /365 \* 10/);
  assert.match(auth, /and active = true/);
});

test("el cliente GPS solicita un único punto preciso, sin seguimiento continuo", () => {
  const source = readFileSync(new URL("../app/routeEtaService.ts", import.meta.url), "utf8");
  assert.match(source, /getCurrentPosition/);
  assert.match(source, /enableHighAccuracy:\s*true/);
  assert.match(source, /maximumAge:\s*0/);
  assert.doesNotMatch(source, /watchPosition/);
});

test("el endpoint aplica estados finales, idempotencia, límite y mock explícito", () => {
  const route = readFileSync(new URL("../app/api/courier-contact/route.ts", import.meta.url), "utf8");
  const provider = readFileSync(new URL("../lib/routeEtaProvider.ts", import.meta.url), "utf8");
  assert.match(route, /FINAL_STATUSES/);
  assert.match(route, /idempotency/);
  assert.match(route, /RATE_LIMITED/);
  assert.match(route, /useLastLocation/);
  assert.match(route, /courier_location_events/);
  assert.match(provider, /TRAFFIC_AWARE_OPTIMAL/);
  assert.match(provider, /BEST_GUESS/);
  assert.match(provider, /provider:\s*"mock"/);
  assert.doesNotMatch(provider, /haversine/i);
});
