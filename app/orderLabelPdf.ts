import { jsPDF } from "jspdf";

export type OrderLabelInput = {
  id: string;
  brand: "Suyai" | "Aura";
  client: string;
  phone?: string;
  address: string;
  district: string;
  collect: number;
  deliveryDate?: string;
};

export type OrderLabelData = {
  orderCode: string;
  company: string;
  client: string;
  phone: string;
  destination: string;
  amount: string;
  shippingDate: string;
};

function formatShippingDate(value?: string) {
  if (!value) return "Sin fecha";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function completeDestination(address: string, district: string) {
  const cleanAddress = address.trim();
  const cleanDistrict = district.trim();
  if (!cleanAddress) return cleanDistrict || "Sin dirección registrada";
  if (
    cleanDistrict &&
    !cleanAddress.toLocaleLowerCase("es-PE").includes(
      cleanDistrict.toLocaleLowerCase("es-PE"),
    )
  ) {
    return `${cleanAddress}, ${cleanDistrict}`;
  }
  return cleanAddress;
}

export function getOrderLabelData(order: OrderLabelInput): OrderLabelData {
  return {
    orderCode: order.id.startsWith("#") ? order.id : `#${order.id}`,
    company: order.brand,
    client: order.client.trim() || "Sin nombre",
    phone: order.phone?.trim() || "Sin teléfono",
    destination: completeDestination(order.address, order.district),
    amount: `S/ ${order.collect.toFixed(2)}`,
    shippingDate: formatShippingDate(order.deliveryDate),
  };
}

function safeFilePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function createOrderLabelPdf(order: OrderLabelInput) {
  const data = getOrderLabelData(order);
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [60, 90],
    compress: true,
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const accent: [number, number, number] =
    order.brand === "Aura" ? [0, 117, 153] : [0, 112, 75];
  const dark: [number, number, number] = [16, 22, 19];
  const gold: [number, number, number] = [211, 174, 76];
  const margin = 4;

  function fitSingleLine(
    value: string,
    maxWidth: number,
    preferredSize: number,
    minimumSize: number,
  ) {
    let size = preferredSize;
    doc.setFontSize(size);
    while (size > minimumSize && doc.getTextWidth(value) > maxWidth) {
      size -= 0.25;
      doc.setFontSize(size);
    }
    return size;
  }

  doc.setFillColor(...dark);
  doc.rect(0, 0, pageWidth, 10.5, "F");
  doc.setFillColor(...gold);
  doc.rect(0, 10.5, pageWidth, 0.8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("P.", margin, 7.3);
  doc.setFontSize(7.5);
  doc.text("P-DELIVERY", margin + 8, 5.8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(4);
  doc.text("RÓTULO DE ENTREGA", margin + 8, 8.3);
  doc.setFont("helvetica", "bold");
  fitSingleLine(data.orderCode, 25, 6, 4.5);
  doc.text(data.orderCode, pageWidth - margin, 6.7, { align: "right" });

  doc.setFillColor(...accent);
  doc.roundedRect(margin, 13, 20, 7, 1.5, 1.5, "F");
  doc.setFontSize(6);
  doc.text(data.company.toUpperCase(), margin + 10, 17.5, { align: "center" });
  doc.setFillColor(...accent);
  doc.roundedRect(pageWidth - 38, 13, 34, 12, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(4.1);
  doc.text("MONTO A COBRAR", pageWidth - 21, 16.6, { align: "center" });
  doc.setFontSize(10);
  doc.text(data.amount, pageWidth - 21, 22, { align: "center" });

  doc.setTextColor(...dark);
  doc.setFontSize(4.2);
  doc.text("DESTINATARIO", margin, 24.5);
  doc.setFont("helvetica", "bold");
  fitSingleLine(data.client, 44, 9.5, 5.5);
  doc.text(data.client, margin, 30.2);

  const rows = [
    ["TELÉFONO", data.phone],
    ["DIRECCIÓN DE ENTREGA", data.destination],
    ["FECHA DE ENVÍO", data.shippingDate],
  ] as const;
  const labelWidth = 22;
  let y = 33;
  doc.setDrawColor(194, 204, 198);
  doc.setLineWidth(0.25);
  rows.forEach(([label, value], index) => {
    const rowHeight = index === 1 ? 11 : 7;
    const shade = index % 2 === 0 ? 247 : 255;
    doc.setFillColor(shade, shade, shade);
    doc.rect(margin, y, pageWidth - margin * 2, rowHeight, "FD");
    doc.line(margin + labelWidth, y, margin + labelWidth, y + rowHeight);
    doc.setTextColor(75, 88, 81);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(4.1);
    doc.text(label, margin + 2, y + (index === 1 ? 5.8 : 4.5));
    doc.setTextColor(...dark);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(index === 1 ? 5.4 : 6.1);
    const valueLines = doc.splitTextToSize(
      value,
      pageWidth - margin * 2 - labelWidth - 4,
    );
    doc.text(
      valueLines.slice(0, index === 1 ? 2 : 1),
      margin + labelWidth + 2,
      y + (index === 1 ? 4.8 : 4.6),
    );
    y += rowHeight;
  });
  return doc;
}

export function downloadOrderLabelPdf(order: OrderLabelInput) {
  const filename = `rotulo-${safeFilePart(order.brand)}-${safeFilePart(order.id)}.pdf`;
  createOrderLabelPdf(order).save(filename);
}
