import { strToU8, zipSync } from "fflate";

export type ExcelReportOrder = {
  id: string;
  deliveryDate?: string;
  brand: string;
  client: string;
  phone?: string;
  district: string;
  address: string;
  warehouse: string;
  assignedCourierName?: string;
  products?: { name: string; quantity: number }[];
  status: string;
  payment: string;
  collect: number;
  commission: number;
  maps?: string;
};

const xmlEscape = (value: unknown) => String(value ?? "").replace(/[<>&"']/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
const inlineCell = (reference: string, value: unknown, style = 0) => `<c r="${reference}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
const numberCell = (reference: string, value: number, style = 0) => `<c r="${reference}"${style ? ` s="${style}"` : ""}><v>${Number(value) || 0}</v></c>`;

function excelDateCell(reference: string, value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return inlineCell(reference, value ?? "");
  const [year, month, day] = value.split("-").map(Number);
  const serial = Math.floor(Date.UTC(year, month - 1, day) / 86400000) + 25569;
  return numberCell(reference, serial, 3);
}

export function buildOrdersXlsx(orders: ExcelReportOrder[], periodLabel: string) {
  const headers = ["Pedido", "Fecha", "Empresa", "Cliente", "Teléfono", "Distrito", "Dirección", "Almacén", "Motorizado", "Productos", "Estado", "Método de pago", "Monto a cobrar", "Comisión", "Google Maps"];
  const dataRows = orders.map((order, index) => {
    const row = index + 3;
    return `<row r="${row}">${[
      inlineCell(`A${row}`, order.id), excelDateCell(`B${row}`, order.deliveryDate), inlineCell(`C${row}`, order.brand),
      inlineCell(`D${row}`, order.client), inlineCell(`E${row}`, order.phone), inlineCell(`F${row}`, order.district),
      inlineCell(`G${row}`, order.address), inlineCell(`H${row}`, order.warehouse),
      inlineCell(`I${row}`, order.assignedCourierName || "Sin asignar"),
      inlineCell(`J${row}`, order.products?.map(product => `${product.quantity} x ${product.name}`).join(" | ") ?? ""),
      inlineCell(`K${row}`, order.status), inlineCell(`L${row}`, order.payment), numberCell(`M${row}`, order.collect, 4),
      numberCell(`N${row}`, order.commission, 4), inlineCell(`O${row}`, order.maps),
    ].join("")}</row>`;
  }).join("");
  const totalRow = orders.length + 3;
  const totalCollect = orders.reduce((sum, order) => sum + order.collect, 0);
  const totalCommission = orders.reduce((sum, order) => sum + order.commission, 0);
  const createdAt = new Date().toISOString();
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:O${totalRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="15" customWidth="1"/><col min="2" max="2" width="13" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/><col min="4" max="4" width="24" customWidth="1"/><col min="5" max="5" width="17" customWidth="1"/><col min="6" max="6" width="20" customWidth="1"/><col min="7" max="7" width="35" customWidth="1"/><col min="8" max="9" width="22" customWidth="1"/><col min="10" max="10" width="38" customWidth="1"/><col min="11" max="12" width="17" customWidth="1"/><col min="13" max="14" width="16" customWidth="1"/><col min="15" max="15" width="35" customWidth="1"/></cols><sheetData><row r="1" ht="30" customHeight="1">${inlineCell("A1", `Reporte de pedidos · ${periodLabel}`, 1)}</row><row r="2" ht="28" customHeight="1">${headers.map((header, index) => inlineCell(`${String.fromCharCode(65 + index)}2`, header, 2)).join("")}</row>${dataRows}<row r="${totalRow}" ht="24" customHeight="1">${inlineCell(`A${totalRow}`, `TOTALES · ${orders.length} pedidos`, 5)}${numberCell(`M${totalRow}`, totalCollect, 6)}${numberCell(`N${totalRow}`, totalCommission, 6)}${inlineCell(`O${totalRow}`, "", 5)}</row></sheetData><autoFilter ref="A2:O${Math.max(2, orders.length + 2)}"/><mergeCells count="2"><mergeCell ref="A1:O1"/><mergeCell ref="A${totalRow}:L${totalRow}"/></mergeCells><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="&quot;S/ &quot;#,##0.00"/></numFmts><fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF006C49"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17201C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE1F5ED"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="165" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Reporte de pedidos ${xmlEscape(periodLabel)}</dc:title><dc:creator>P-Delivery</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created></cp:coreProperties>`),
    "docProps/app.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>P-Delivery</Application></Properties>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pedidos" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(styles),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  };
  return zipSync(files, { level: 6 });
}

export function downloadOrdersExcel(orders: ExcelReportOrder[], periodLabel: string) {
  const workbook = buildOrdersXlsx(orders, periodLabel);
  const blob = new Blob([workbook.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `reporte_pedidos_${periodLabel.replace(/[^0-9a-z-]+/gi, "_").toLowerCase()}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
