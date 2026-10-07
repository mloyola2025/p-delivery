import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { buildOrdersXlsx } from "../app/excelReport.ts";

test("el Excel exportado incluye motorizado y conserva columnas numéricas", () => {
  const workbook = buildOrdersXlsx(
    [
      {
        id: "SY-TEST01",
        deliveryDate: "2026-07-16",
        brand: "Suyai",
        client: "Cliente prueba",
        phone: "987654321",
        district: "Rímac",
        address: "Jr. Prueba 123",
        warehouse: "Rímac",
        assignedCourierName: "Luis Motorizado",
        products: [{ name: "Aceite de Orégano", quantity: 2 }],
        status: "Entregado",
        payment: "Efectivo",
        collect: 80,
        commission: 10,
        maps: "https://maps.example/1",
      },
    ],
    "2026-07-16_motorizado_Luis",
  );
  const files = unzipSync(workbook);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /dimension ref="A1:O4"/);
  assert.match(sheet, />Motorizado</);
  assert.match(sheet, />Luis Motorizado</);
  assert.match(sheet, /autoFilter ref="A2:O3"/);
  assert.match(sheet, /<c r="M3" s="4"><v>80<\/v><\/c>/);
  assert.match(sheet, /<c r="N3" s="4"><v>10<\/v><\/c>/);
});
