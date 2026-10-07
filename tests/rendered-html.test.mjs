import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders separate administration and courier portals", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>P-delivery \| Suyai \+ Aura<\/title>/i);
  assert.match(html, /brands%2Fp-delivery\.png|brands\/p-delivery\.png/i);
  assert.match(html, /P-Delivery/);
  assert.match(html, /¿Cómo deseas ingresar\?/);
  assert.match(html, /🕒/);
  assert.match(html, /🛵/);
  assert.match(html, /Administración/);
  assert.match(html, /Motorizado/);
  assert.match(html, /href="\/acceso-admin"/);
  assert.match(html, /href="\/acceso-motorizado"/);
  assert.doesNotMatch(html, /Superadministrador/);
  assert.doesNotMatch(html, /<option value="motorizado"/);

  const adminAccess = await (await render("/acceso-admin")).text();
  assert.match(adminAccess, /Ingresa a tu administración/);
  assert.match(adminAccess, /reconocerá automáticamente los permisos/);
  assert.doesNotMatch(adminAccess, /Tipo de acceso administrativo|<select/);
  assert.match(adminAccess, /Ingresar a Administración/);
  const adminAccessPage = await readFile(
    new URL("../app/acceso-admin/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(adminAccessPage, /readAdminSession/);
  assert.match(
    adminAccessPage,
    /redirect\(`\/admin\?access=\$\{session\.role\}`\)/,
  );
});

test("renders the admin management page", async () => {
  const response = await render("/admin");
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /\/acceso-admin(?:\?|$)/);
  const component = await readFile(
    new URL("../app/LogisticsApp.tsx", import.meta.url),
    "utf8",
  );
  const limaDate = await readFile(
    new URL("../app/limaDate.ts", import.meta.url),
    "utf8",
  );
  assert.match(component, /Resumen de pedidos del día/);
  assert.match(component, /Pedidos programados/);
  assert.match(component, /Gestiones del sistema/);
  assert.match(component, /Cambiar contraseñas/);
  assert.match(component, /Eliminar registros/);
  assert.match(component, /Mensajes push/);
  assert.match(component, /superadminOnly: true/);
  assert.match(component, /Reprogramados/);
  assert.match(component, /Cancelados/);
  assert.match(component, /Devoluciones/);
  assert.match(component, /Descargar rótulo/);
  assert.match(component, /Editar pedido/);
  assert.match(component, /edit=\$\{encodeURIComponent\(order\.id\)\}/);
  assert.match(component, /downloadOrderLabelPdf/);
  assert.match(limaDate, /America\/Lima/);
  assert.match(component, /Reportes/);
  assert.match(component, /Todos los motorizados/);
  assert.match(component, /assignedCourierName/);
  assert.match(component, /Jr\. Libertad 366/);
  assert.match(component, /Calle Héroes de la Libertad 177/);
  assert.match(component, /Ca\. Toulon 226/);
  assert.doesNotMatch(
    component,
    /Operación logística|Aún no hay una ruta activa|Sin actividad registrada/,
  );
  assert.doesNotMatch(
    component,
    /Ruta inteligente|PLANIFICACIÓN|label: "Rutas"/,
  );
  assert.doesNotMatch(
    component,
    /María González|Luciana Torres|Carlos Mendoza|4,222\.50/,
  );
  assert.doesNotMatch(component, /codex-preview|react-loading-skeleton/);
});

test("renders the courier control page", async () => {
  const response = await render("/motorizado");
  assert.equal(response.status, 307);
  assert.match(
    response.headers.get("location") ?? "",
    /\/acceso-motorizado(?:\?|$)/,
  );
  const component = await readFile(
    new URL("../app/LogisticsApp.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /Panel del motorizado/);
  assert.match(component, /No hay pedidos con estos filtros/);
  assert.match(component, /Todos los distritos/);
  assert.match(component, /courier-label-download/);
  assert.match(component, /Descargar rótulo/);
  assert.doesNotMatch(component, /María González|Carlos Mendoza|450\.00/);
});

test("renders the protected standalone order form", async () => {
  const response = await render("/admin/pedidos/nuevo");
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /\/acceso-admin$/);
  const formSource = await readFile(
    new URL("../app/admin/pedidos/nuevo/NewOrderForm.tsx", import.meta.url),
    "utf8",
  );
  const productCatalog = await readFile(
    new URL("../app/products.ts", import.meta.url),
    "utf8",
  );
  const clientId = await readFile(
    new URL("../app/clientId.ts", import.meta.url),
    "utf8",
  );
  assert.match(formSource, /Crear nuevo pedido/);
  assert.match(formSource, /Borrador protegido/);
  assert.match(formSource, /Enlace de Google Maps/);
  assert.match(formSource, /maps\.app\.goo\.gl/);
  assert.match(formSource, /Selecciona un distrito/);
  assert.match(productCatalog, /Aceite de Orégano/);
  assert.match(productCatalog, /Aceite de Coco 100% Virgen \(500 ml\)/);
  assert.match(productCatalog, /Mood Magic \(Microdosis de Hongos\)/);
  assert.match(productCatalog, /Oregano 1 lt/);
  assert.match(productCatalog, /Pets 5%/);
  assert.match(productCatalog, /Oregano 1 lt aura/);
  assert.match(productCatalog, /Relax/);
  assert.match(formSource, /Escribe para buscar o agregar/);
  assert.match(formSource, /Agregar otro producto/);
  assert.match(formSource, /product-dropdown-toggle/);
  assert.match(formSource, /product-options-menu/);
  assert.match(formSource, /Abrir lista de productos/);
  assert.match(formSource, /role="combobox"/);
  assert.match(formSource, /inputMode="numeric"/);
  assert.match(formSource, /Confirmar y crear pedido/);
  assert.match(formSource, /Guardar cambios del pedido/);
  assert.match(formSource, /action: isEditing \? "update-order" : "create-order"/);
  assert.match(formSource, /draftFromOrder/);
  assert.match(formSource, /Volver a revisar/);
  assert.match(formSource, /createClientId\(\)/);
  assert.doesNotMatch(formSource, /crypto\.randomUUID/);
  assert.match(
    clientId,
    /typeof browserCrypto\.getRandomValues === "function"/,
  );
  assert.match(clientId, /Math\.random\(\)/);
});

test("renders distinct Suyai and Aura administration scopes", async () => {
  assert.equal((await render("/admin?access=suyai")).status, 307);
  assert.equal((await render("/admin?access=aura")).status, 307);
  const component = await readFile(
    new URL("../app/LogisticsApp.tsx", import.meta.url),
    "utf8",
  );
  const adminPage = await readFile(
    new URL("../app/admin/page.tsx", import.meta.url),
    "utf8",
  );
  const auth = await readFile(
    new URL("../app/adminAuth.ts", import.meta.url),
    "utf8",
  );
  const selector = await readFile(
    new URL("../app/AccessSelector.tsx", import.meta.url),
    "utf8",
  );
  const adminLogin = await readFile(
    new URL("../app/api/admin-login/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(component, /Administración Suyai/);
  assert.match(component, /Administración Aura/);
  assert.match(component, /access-theme-\$\{initialAccess\}/);
  assert.match(component, /Cerrar sesión/);
  assert.match(adminPage, /readAdminSession/);
  assert.match(adminPage, /canAccessAdmin/);
  assert.match(auth, /httpOnly|ADMIN_SESSION_COOKIE/);
  assert.match(auth, /crypto\.subtle\.sign/);
  assert.match(auth, /60 \* 60 \* 24 \* 365 \* 10/);
  assert.doesNotMatch(auth, /expiresAt/);
  assert.doesNotMatch(selector, /Suyai2026|Aura2026/);
  assert.match(selector, /type="password"/);
  assert.match(selector, /\/api\/admin-login/);
  assert.doesNotMatch(selector, /admin-access-type|Tipo de acceso administrativo/);
  assert.match(selector, /JSON\.stringify\(\{ username, password \}\)/);
  assert.match(selector, /reconocerá automáticamente los permisos/);
  assert.match(auth, /superadmin:\s*"superadmin"/);
  assert.match(auth, /identifyAdminAccount/);
  assert.match(adminLogin, /identifyAdminAccount/);
  assert.doesNotMatch(adminLogin, /body\.access/);
  assert.match(
    component,
    /fixedBrand[\s\S]{0,180}order\.brand\.toLowerCase\(\) === fixedBrand/,
  );
  assert.match(component, /Acceso limitado a \{scopedBrandName\}/);
  assert.match(component, /Reporte de pedidos \$\{scopedBrandName\}/);
  assert.match(
    component,
    /excluyen automáticamente[\s\S]{0,80}pedidos de otras empresas/,
  );
  assert.match(component, /status: adminStatusLabel\(order\.status\)/);
  assert.match(component, /Anular envío/);
  assert.match(component, /onCancelOrder\(order\)/);
  assert.match(component, /status: "Cancelado"/);
  assert.match(component, /El pedido se conservará en el historial/);
  assert.match(component, /label="ACTIVOS"/);
  assert.match(component, /status === "En ruta" \? "Activo" : status/);
});

test("superadmin manages additional Suyai and Aura administrators", async () => {
  const component = await readFile(
    new URL("../app/LogisticsApp.tsx", import.meta.url),
    "utf8",
  );
  const manager = await readFile(
    new URL("../app/AdminUsersAdmin.tsx", import.meta.url),
    "utf8",
  );
  const api = await readFile(
    new URL("../app/api/admin-users/route.ts", import.meta.url),
    "utf8",
  );
  const auth = await readFile(
    new URL("../app/adminAuth.ts", import.meta.url),
    "utf8",
  );
  const schema = await readFile(
    new URL("../db/migrations/006_admin_users.sql", import.meta.url),
    "utf8",
  );
  assert.match(component, /Administradores/);
  assert.match(component, /<AdminUsersAdmin \/>/);
  assert.match(manager, /Crear administrador/);
  assert.match(manager, /Administración Suyai/);
  assert.match(manager, /Administración Aura/);
  assert.match(manager, /Dar de baja/);
  assert.match(manager, /Eliminar/);
  assert.match(api, /session\?\.role !== "superadmin"/);
  assert.match(api, /export async function POST/);
  assert.match(api, /export async function PATCH/);
  assert.match(api, /export async function DELETE/);
  assert.match(api, /role in \('suyai', 'aura'\)|validRole/);
  assert.match(api, /admin-disabled/);
  assert.match(auth, /from admin_users/);
  assert.match(auth, /verifyCourierPassword/);
  assert.match(auth, /accountId/);
  assert.match(schema, /create table if not exists admin_users/);
  assert.match(schema, /enable row level security/);
});

test("colors courier order cards by company", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const component = await readFile(
    new URL("../app/LogisticsApp.tsx", import.meta.url),
    "utf8",
  );
  const excelReport = await readFile(
    new URL("../app/excelReport.ts", import.meta.url),
    "utf8",
  );
  const distances = await readFile(
    new URL("../app/rimacDistances.ts", import.meta.url),
    "utf8",
  );
  const mapDistance = await readFile(
    new URL("../app/mapDistance.ts", import.meta.url),
    "utf8",
  );
  const coordinatesRoute = await readFile(
    new URL("../app/api/maps/coordinates/route.ts", import.meta.url),
    "utf8",
  );
  const photosRoute = await readFile(
    new URL("../app/api/photos/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(css, /next-stop:has\(\.brand-badge\.suyai\)/);
  assert.match(css, /next-stop:has\(\.brand-badge\.aura\)/);
  assert.match(css, /#006c49/);
  assert.match(css, /#007b91/);
  assert.match(css, /height:calc\(86px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /courier-nav button\{min-height:72px/);
  assert.match(css, /courier-nav button span\{font-size:11px/);
  assert.match(css, /courier-filter-group>\.courier-district-filter\{grid-column:1\}/);
  assert.match(css, /courier-filter-group>\.courier-sort-filter\{grid-column:2\}/);
  assert.match(
    component,
    /visibleOrders\.filter\([\s\S]{0,100}activeStatuses\.includes\(order\.status\)/,
  );
  assert.match(component, /orderedAssigned\.map/);
  assert.match(component, /href={`tel:\+\$\{contact\.digits\}`}/);
  assert.match(component, /registerCustomerNotification/);
  assert.match(component, /"Avisar pedido"/);
  assert.match(component, /"Próxima entrega"/);
  assert.match(component, /changeStatus\(order, "Entregado"\)/);
  assert.match(component, /function deductOrderFromInventory/);
  assert.match(component, /inventoryBalanceAfterDelivery\(available, quantity\)/);
  assert.match(
    component,
    /order\.status !== "Entregado"[\s\S]{0,40}order\.inventoryDeducted/,
  );
  assert.match(
    component,
    /inventoryDeducted:[\s\S]{0,80}status === "Entregado" \? true/,
  );
  assert.match(component, /Stock actualizado:/);
  assert.match(component, /changeStatus\(order, "Cancelado"\)/);
  assert.match(component, /changeStatus\(order, "Devolución"\)/);
  assert.match(component, /changeStatus\(order, "Reprogramado"\)/);
  assert.match(component, /changeStatus\(order, "En ruta"\)/);
  assert.match(component, />\s*▶ En ruta\s*<\/button>/);
  assert.match(component, /route-cancel/);
  assert.match(component, />\s*↶ Cancelar ruta\s*<\/button>/);
  assert.match(component, /function cancelRoute/);
  assert.match(component, /devolverlo a pendiente/);
  assert.match(component, /is-en-ruta/);
  assert.match(component, /Filtrar todos los pedidos por fecha/);
  assert.match(component, /Filtrar pedidos por fecha/);
  assert.match(
    component,
    /<details[\s\S]{0,120}className={`next-stop courier-order-card/,
  );
  assert.match(css, /next-stop\.is-en-ruta\.is-en-ruta/);
  assert.match(css, /#c58a0b/);
  assert.match(css, /\.product-search-field\{grid-column:1\/-1\}/);
  assert.match(
    css,
    /\.product-entry-row\{grid-template-columns:minmax\(0,1fr\) 44px/,
  );
  assert.match(css, /@media\(max-width:1180px\) and \(min-width:801px\)/);
  assert.match(
    css,
    /\.order-form-layout\{grid-template-columns:minmax\(0,1fr\)\}/,
  );
  assert.match(css, /Formulario de pedidos siempre en una columna/);
  assert.match(
    css,
    /\.order-page-form\{width:min\(1000px,calc\(100% - 40px\)\)\}/,
  );
  assert.match(css, /\.order-form-summary\{position:static;top:auto/);
  assert.match(component, /Evidencia fotográfica/);
  assert.match(component, /accept="image\/\*"/);
  assert.match(component, /fetch\("\/api\/photos"/);
  assert.match(photosRoute, /pathname = `evidencias\//);
  assert.match(photosRoute, /uploadEvidence\(pathname, file\)/);
  assert.match(component, /compressPhoto/);
  assert.match(component, /createClientId\(\)/);
  assert.doesNotMatch(component, /crypto\.randomUUID/);
  assert.match(component, /setCourierTab\("historial"\)/);
  assert.match(component, />Historial<\/span>/);
  assert.match(component, /setCourierTab\("reportes"\)/);
  assert.match(component, />Reportes<\/span>/);
  assert.doesNotMatch(component, /setCourierTab\("pedidos"\)/);
  assert.match(component, /Histórico del motorizado/);
  assert.match(component, /Rango de fechas/);
  assert.match(component, /downloadOrdersReport\(reportOrders/);
  assert.doesNotMatch(component, />Perfil<\/span>/);
  assert.match(
    css,
    /\.courier-nav\{[^}]*grid-template-columns:repeat\(3,1fr\)/,
  );
  assert.match(css, /Evita el zoom automático de Safari/);
  assert.match(css, /textarea\{font-size:16px!important\}/);
  assert.match(component, /Todos los pedidos procesados/);
  assert.match(component, /historyOrders/);
  assert.match(component, /reactivateOrder/);
  assert.match(component, />\s*↻ Reactivar\s*<\/button>/);
  assert.match(component, /changeStatus\(order, "Pendiente"\)/);
  assert.match(component, /status === "Entregado"[\s\S]{0,60}!window\.confirm/);
  assert.match(component, /cobraste \$\{money\(order\.collect\)\}/);
  assert.match(component, /OrderProducts/);
  assert.match(component, /src="\/whatsapp-icon\.png"/);
  assert.match(component, /whatsapp:\/\/send\?phone=/);
  assert.match(component, /p-delivery-courier-return-order/);
  assert.match(component, /localStorage\.setItem/);
  assert.match(component, /morning-notice-action/);
  assert.match(component, /next-delivery-action/);
  assert.match(component, /PRODUCTOS DEL PEDIDO/);
  assert.match(component, /Reporte de pedidos/);
  assert.match(component, /Inventario por almacén/);
  assert.match(component, /Agregar stock/);
  assert.match(component, /Volver a cero/);
  assert.match(component, /stock-movement.*is-negative/);
  assert.match(component, /PRODUCT_CATALOG\[brand\]/);
  assert.match(component, /p-delivery-inventory-v1/);
  assert.match(component, /initialAccess === "superadmin"/);
  assert.match(component, /Saldo y entrada/);
  assert.match(component, /Fecha exacta/);
  assert.match(component, /Rango de fechas/);
  assert.match(component, /Descargar Excel \(\.xlsx\)/);
  assert.match(
    excelReport,
    /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
  );
  assert.match(excelReport, /reporte_pedidos_/);
  assert.match(excelReport, /\.xlsx/);
  assert.match(excelReport, /zipSync/);
  assert.match(component, /Más cercanos/);
  assert.match(component, /Más lejanos/);
  assert.match(component, /orderedAssigned/);
  assert.match(component, /distanceForOrder\(order\)[\s\S]{0,120}gpsDistances/);
  assert.match(component, /distanceForOrder/);
  assert.match(component, /GPS aprox\./);
  assert.match(component, /distrito aprox\./);
  assert.match(component, /\/api\/maps\/coordinates/);
  assert.match(mapDistance, /RIMAC_WAREHOUSE_COORDINATES/);
  assert.match(mapDistance, /distanceFromRimac/);
  assert.match(coordinatesRoute, /resolveMapCoordinates/);
  assert.match(distances, /Lima \(Cercado de Lima\)/);
});

test("implements persistent push subscriptions and internal notifications", async () => {
  const [schema, service, subscriptions] = await Promise.all([
    readFile(new URL("../db/migrations/001_notifications.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/notificationService.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/push/subscriptions/route.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(schema, /create table if not exists push_subscriptions/);
  assert.match(schema, /create table if not exists notifications/);
  assert.match(schema, /notification_delivery_attempts/);
  assert.match(schema, /notification_preferences/);
  assert.match(service, /idempotency_key/);
  assert.match(service, /registration-token-not-registered/);
  assert.match(service, /partially_sent/);
  assert.match(subscriptions, /unique \(user_id, device_id\)|on conflict \(user_id, device_id\)/);
  assert.match(subscriptions, /where device_id = \$\{deviceId\.slice/);
  assert.match(subscriptions, /set token = \$\{token\},[\s\S]{0,80}active = case/);
});

test("targets each order and push to its assigned courier only", async () => {
  const [form, state, service, notifications, assignable, schema, runtimeDb] =
    await Promise.all([
      readFile(
        new URL("../app/admin/pedidos/nuevo/NewOrderForm.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/notificationService.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/notifications/route.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/api/couriers/assignable/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../db/migrations/005_targeted_courier_notifications.sql", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../lib/cloudDb.ts", import.meta.url), "utf8"),
    ]);
  assert.match(form, /Motorizado asignado/);
  assert.match(form, /assignedCourierId/);
  assert.match(form, /\/api\/couriers\/assignable/);
  assert.match(assignable, /where active = true/);
  assert.match(assignable, /readAdminSession/);
  assert.match(assignable, /courier-assignable-list/);
  assert.match(state, /data->>'assignedCourierId' = \$\{activeCourierSession\?\.id/);
  assert.match(state, /requestedScope === "admin" \|\| requestedScope === "courier"/);
  assert.match(state, /recipientAccountId: order\.assignedCourierId/);
  assert.match(state, /Este pedido no está asignado a tu cuenta/);
  assert.match(service, /account_id = \$\{event\.recipientAccountId/);
  assert.match(service, /recipientAccountId/);
  assert.match(notifications, /account_id = \$\{courier\?\.id/);
  assert.match(schema, /alter table notifications add column if not exists account_id/);
  assert.match(runtimeDb, /to_regclass\('public\.orders'\)/);
  assert.doesNotMatch(runtimeDb, /pg_advisory_lock/);
  assert.doesNotMatch(runtimeDb, /create table if not exists/);
});

test("implements background push, safe deep links, and device diagnostics", async () => {
  const [worker, center, access] = await Promise.all([
    readFile(
      new URL("../app/firebase-messaging-sw.js/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/NotificationCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AccessSelector.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /onBackgroundMessage/);
  assert.match(worker, /notificationclick/);
  assert.match(worker, /clients\.matchAll/);
  assert.match(worker, /targetUrl\.startsWith\("\/"\)/);
  assert.match(center, /Activar \/ actualizar/);
  assert.match(center, /Enviar prueba/);
  assert.match(center, /Cerrar sesión y desactivar/);
  assert.match(center, /✓ Leer todas/);
  assert.match(center, /notification-bell-icon/);
  assert.match(center, /🔔/);
  assert.match(center, /action: "read-all"/);
  assert.match(center, /setUnread\(0\)/);
  assert.match(center, /document\.addEventListener\("pointerdown", closeOutside\)/);
  assert.match(center, /!centerRef\.current\.contains\(event\.target\)/);
  assert.match(center, /event\.key === "Escape"/);
  assert.match(center, /Service worker/);
  assert.match(access, /returnTo\.startsWith\("\/"\)/);
});

test("stores new evidence in Supabase without Vercel Blob advanced operations", async () => {
  const [photos, storage] = await Promise.all([
    readFile(new URL("../app/api/photos/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabaseStorage.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(photos, /import\s*\{[^}]*\bput\b[^}]*\}\s*from\s*["']@vercel\/blob/);
  assert.doesNotMatch(photos, /\bput\s*\(/);
  assert.doesNotMatch(photos, /\blist\s*\(/);
  assert.match(photos, /uploadEvidence/);
  assert.match(storage, /order-evidence/);
  assert.match(storage, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("lets administrators inspect courier delivery evidence on demand", async () => {
  const [component, photosRoute] = await Promise.all([
    readFile(new URL("../app/LogisticsApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/photos/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(component, /function AdminPhotoEvidence/);
  assert.match(component, /Ver fotos de entrega/);
  assert.match(component, /\/api\/photos\?orderId=/);
  assert.match(component, /<AdminPhotoEvidence order=\{order\}/);
  assert.match(photosRoute, /operatorCanAccessOrder\(operator, orderId\)/);
});

test("lets only the superadmin manage the shared product catalog", async () => {
  const [component, stateRoute, orderForm, cloudData] = await Promise.all([
    readFile(new URL("../app/LogisticsApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/admin/pedidos/nuevo/NewOrderForm.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/cloudData.ts", import.meta.url), "utf8"),
  ]);
  assert.match(component, /Administrar catálogo/);
  assert.match(component, /initialAccess === "superadmin"/);
  assert.match(component, /save-product-catalog/);
  assert.match(component, /× Quitar/);
  assert.match(component, /✎ Editar/);
  assert.match(component, /renameCatalogProduct/);
  assert.match(component, /El stock fue conservado/);
  assert.match(stateRoute, /session\?\.role !== "superadmin"/);
  assert.match(stateRoute, /key = 'product-catalog'/);
  assert.match(stateRoute, /greatest\(inventory\.quantity, excluded\.quantity\)/);
  assert.match(orderForm, /cloud\.productCatalog/);
  assert.match(orderForm, /productCatalog\[draft\.brand\]/);
  assert.match(cloudData, /productCatalog: ProductCatalog/);
});
