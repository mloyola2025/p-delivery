import assert from "node:assert/strict";
import test from "node:test";
import {
  createOrderLabelPdf,
  getOrderLabelData,
} from "../app/orderLabelPdf.ts";

const sampleOrder = {
  id: "AU-6046FE",
  brand: "Aura" as const,
  client: "Bryan Chávez",
  phone: "987 654 321",
  address: "Av. General Mendiburu 1203",
  district: "Miraflores",
  collect: 60,
  deliveryDate: "2026-07-16",
};

test("prepara todos los datos del rótulo", () => {
  assert.deepEqual(getOrderLabelData(sampleOrder), {
    orderCode: "#AU-6046FE",
    company: "Aura",
    client: "Bryan Chávez",
    phone: "987 654 321",
    destination: "Av. General Mendiburu 1203, Miraflores",
    amount: "S/ 60.00",
    shippingDate: "16/07/2026",
  });
});

test("no duplica el distrito cuando ya forma parte de la dirección", () => {
  const label = getOrderLabelData({
    ...sampleOrder,
    address: "Calle Los Cedros 220, Miraflores",
  });
  assert.equal(label.destination, "Calle Los Cedros 220, Miraflores");
});

test("genera un documento PDF válido", () => {
  const pdf = createOrderLabelPdf(sampleOrder);
  assert.ok(Math.abs(pdf.internal.pageSize.getWidth() - 90) < 0.1);
  assert.ok(Math.abs(pdf.internal.pageSize.getHeight() - 60) < 0.1);
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert.ok(bytes.length > 2_000);
});
