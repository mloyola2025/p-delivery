"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { LIMA_DISTRICTS } from "./districts";
import {
  PRODUCT_CATALOG,
  normalizedProductCatalog,
  type OrderProduct,
  type ProductCatalog,
} from "./products";
import { getRimacDistance } from "./rimacDistances";
import {
  distanceFromRimac,
  extractMapCoordinates,
  type Coordinates,
} from "./mapDistance";
import { createClientId } from "./clientId";
import { mutateCloudState, readCloudState } from "./cloudData";
import { DateInput } from "./DateInput";
import { BrandLogo, type BrandLogoName } from "./BrandLogo";
import { currentLimaDate } from "./limaDate";
import { NotificationCenter } from "./NotificationCenter";
import { PushDeviceManager } from "./PushDeviceManager";
import {
  DEFAULT_COURIER_CONTACT_SETTINGS,
  normalizePeruvianPhone,
  type CourierContactSettings,
} from "./courierContact";
import { unlinkPushDevice } from "./pushClient";
import {
  calculateTravelDuration,
  getCurrentCourierLocation,
  getCustomerContactHistory,
  markCustomerContactOpened,
  registerCustomerNotification,
  type CustomerContactHistoryItem,
  type CustomerContactResult,
} from "./routeEtaService";
import {
  inventoryBalanceAfterDelivery,
  inventoryBalanceAfterEntry,
  withInventoryBalance,
} from "./inventoryStock";
const CourierUsersAdmin = dynamic(() => import("./CourierUsersAdmin"));
const AdminUsersAdmin = dynamic(() => import("./AdminUsersAdmin"));

async function downloadOrderLabel(order: Order) {
  const { downloadOrderLabelPdf } = await import("./orderLabelPdf");
  downloadOrderLabelPdf(order);
}

async function downloadOrdersReport(
  orders: Parameters<typeof import("./excelReport").downloadOrdersExcel>[0],
  filename: string,
) {
  const { downloadOrdersExcel } = await import("./excelReport");
  downloadOrdersExcel(orders, filename);
}

type View =
  | "resumen"
  | "pedidos"
  | "gestiones"
  | "administradores"
  | "motorizados"
  | "almacenes"
  | "inventario"
  | "rendiciones";
export type AdminAccess = "superadmin" | "suyai" | "aura";
type Order = {
  id: string;
  brand: "Suyai" | "Aura";
  client: string;
  district: string;
  warehouse: string;
  collect: number;
  commission: number;
  status:
    | "Pendiente"
    | "En ruta"
    | "Entregado"
    | "Reprogramado"
    | "Cancelado"
    | "Devolución";
  address: string;
  payment: string;
  maps?: string;
  phone?: string;
  deliveryDate?: string;
  assignedCourierId?: string;
  assignedCourierName?: string;
  products?: OrderProduct[];
  inventoryDeducted?: boolean;
};

const ORDERS_KEY = "suyai-orders-v2";
const INVENTORY_KEY = "p-delivery-inventory-v1";
const PUSH_SETTINGS_KEY = "p-delivery-push-settings-v1";
type InventoryStock = Record<string, number>;
type ProductRename = {
  brand: keyof ProductCatalog;
  oldName: string;
  newName: string;
};
type ContactProgress = {
  label: string;
  kind?: "morning" | "next";
  busy?: boolean;
  error?: boolean;
  canUseLastLocation?: boolean;
  permissionHelp?: boolean;
};
type PhotoView = { id: string; url: string; name: string };
const COURIER_RETURN_ORDER_KEY = "p-delivery-courier-return-order";

async function compressPhoto(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.78),
    );
  } catch {
    return file;
  }
}
const warehouses = [
  {
    name: "Rímac",
    address: "Jr. Libertad 366, Rímac",
    maps: "https://maps.app.goo.gl/dhEnSWySU3AnJu2p6",
    code: "RIM",
    tone: "emerald",
  },
  {
    name: "San Martín de Porres",
    address: "Calle Héroes de la Libertad 177, SMP",
    maps: "https://maps.app.goo.gl/FeoPRyAmKonEPNVs5",
    code: "SMP",
    tone: "cyan",
  },
  {
    name: "La Molina",
    address: "Ca. Toulon 226, Lima 15024",
    maps: "https://maps.app.goo.gl/cZn3tNPz6cns4y6H6",
    code: "MOL",
    tone: "violet",
  },
];

function normalizedInventoryName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function warehouseCodeForOrder(warehouseName: string) {
  return (
    warehouses.find(
      (item) =>
        normalizedInventoryName(item.name) ===
        normalizedInventoryName(warehouseName),
    )?.code ?? "RIM"
  );
}

function catalogProductForOrder(brand: "Suyai" | "Aura", productName: string) {
  const normalizedProduct = normalizedInventoryName(productName);
  const directMatch = PRODUCT_CATALOG[brand].find(
    (product) => normalizedInventoryName(product) === normalizedProduct,
  );
  if (directMatch) return directMatch;
  const legacyAliases: Record<string, string> =
    brand === "Suyai"
      ? {
          "oregano 30 ml": "Aceite de Orégano",
          "ricino 30 ml": "Aceite de Ricino",
        }
      : {
          "oregano 30 ml": "Oregano aura",
          "relax 30 ml": "Relax",
        };
  return legacyAliases[normalizedProduct] ?? productName.trim();
}

function deductOrderFromInventory(
  currentInventory: InventoryStock,
  order: Order,
) {
  let nextInventory = { ...currentInventory };
  const warehouseCode = warehouseCodeForOrder(order.warehouse);
  let requested = 0;
  let deducted = 0;
  for (const orderProduct of order.products ?? []) {
    const quantity = Math.max(
      0,
      Math.floor(Number(orderProduct.quantity) || 0),
    );
    requested += quantity;
    const catalogProduct = catalogProductForOrder(
      order.brand,
      orderProduct.name,
    );
    if (!catalogProduct || !quantity) continue;
    const key = inventoryKey(order.brand, warehouseCode, catalogProduct);
    const available = Number(nextInventory[key]) || 0;
    const remaining = inventoryBalanceAfterDelivery(available, quantity);
    nextInventory = withInventoryBalance(nextInventory, key, remaining);
    deducted += quantity;
  }
  return { inventory: nextInventory, requested, deducted };
}
const nav: {
  id: View;
  label: string;
  icon: string;
  superadminOnly?: boolean;
}[] = [
  { id: "resumen", label: "Resumen", icon: "⌂" },
  { id: "pedidos", label: "Reportes", icon: "▣" },
  { id: "gestiones", label: "Gestiones", icon: "⚙", superadminOnly: true },
  { id: "administradores", label: "Administradores", icon: "◆", superadminOnly: true },
  { id: "motorizados", label: "Motorizados", icon: "●", superadminOnly: true },
  { id: "almacenes", label: "Almacenes", icon: "▥" },
  { id: "inventario", label: "Inventario", icon: "◫" },
  { id: "rendiciones", label: "Rendiciones", icon: "S/" },
];
const money = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2 })}`;
const adminStatusLabel = (status: Order["status"]) =>
  status === "En ruta" ? "Activo" : status;
const assignedCourierKey = (order: Order) =>
  order.assignedCourierId ||
  (order.assignedCourierName
    ? `historico:${order.assignedCourierName}`
    : "Sin asignar");

const accessLabels = {
  superadmin: {
    title: "Superadmin",
    subtitle: "Todas las marcas",
    initials: "SA",
    logo: "general" as BrandLogoName,
  },
  suyai: {
    title: "Administración Suyai",
    subtitle: "Acceso exclusivo Suyai",
    initials: "S",
    logo: "suyai" as BrandLogoName,
  },
  aura: {
    title: "Administración Aura",
    subtitle: "Acceso exclusivo Aura",
    initials: "A",
    logo: "aura" as BrandLogoName,
  },
};

export default function LogisticsApp({
  initialCourier = false,
  initialAccess = "superadmin",
  initialOrderId = "",
  initialDate = "",
  initialCourierId = "",
  initialCourierName = "",
}: {
  initialCourier?: boolean;
  initialAccess?: AdminAccess;
  initialOrderId?: string;
  initialDate?: string;
  initialCourierId?: string;
  initialCourierName?: string;
}) {
  const [view, setView] = useState<View>(
    initialOrderId && !initialCourier ? "pedidos" : "resumen",
  );
  const [orders, setOrders] = useState<Order[]>([]);
  const [inventory, setInventory] = useState<InventoryStock>({});
  const [productCatalog, setProductCatalog] = useState<ProductCatalog>(() =>
    normalizedProductCatalog(),
  );
  const [search, setSearch] = useState(initialOrderId);
  const [dateFilter, setDateFilter] = useState(
    initialDate || currentLimaDate(),
  );
  const [brand, setBrand] = useState("Todas");
  const [cancellingOrderId, setCancellingOrderId] = useState("");
  const access = accessLabels[initialAccess];
  const newOrderHref = `/admin/pedidos/nuevo?access=${initialAccess}`;

  useEffect(() => {
    let active = true;
    async function loadCloudState(allowBootstrap: boolean) {
      try {
        localStorage.removeItem("suyai-created-orders");
        localStorage.removeItem("suyai-new-order-draft");
        const localOrders = JSON.parse(
          localStorage.getItem(ORDERS_KEY) ?? "[]",
        ) as Order[];
        const localInventory = JSON.parse(
          localStorage.getItem(INVENTORY_KEY) ?? "{}",
        ) as InventoryStock;
        const stateScope = initialCourier ? "courier" : "admin";
        let cloud = await readCloudState<Order>(stateScope);
        if (
          allowBootstrap &&
          !initialCourier &&
          !cloud.orders.length &&
          localOrders.length
        ) {
          await mutateCloudState({
            action: "bootstrap",
            orders: localOrders,
            inventory: localInventory,
          });
          cloud = await readCloudState<Order>(stateScope);
        }
        let cloudInventory = cloud.inventory;
        const reconciledOrders = cloud.orders.map((order) => {
          if (order.status !== "Entregado" || order.inventoryDeducted)
            return order;
          cloudInventory = deductOrderFromInventory(
            cloudInventory,
            order,
          ).inventory;
          const reconciledOrder = { ...order, inventoryDeducted: true };
          void mutateCloudState({
            action: "update-order",
            order: reconciledOrder,
            inventory: cloudInventory,
          }, stateScope);
          return reconciledOrder;
        });
        if (!active) return;
        setOrders(reconciledOrders);
        setInventory(cloudInventory);
        setProductCatalog(normalizedProductCatalog(cloud.productCatalog));
        localStorage.setItem(ORDERS_KEY, JSON.stringify(reconciledOrders));
        localStorage.setItem(INVENTORY_KEY, JSON.stringify(cloudInventory));
      } catch {
        if (!active) return;
        try {
          const fallbackOrders = JSON.parse(
            localStorage.getItem(ORDERS_KEY) ?? "[]",
          ) as Order[];
          setOrders(
            initialCourier
              ? fallbackOrders.filter(
                  (order) => order.assignedCourierId === initialCourierId,
                )
              : fallbackOrders,
          );
          setInventory(
            JSON.parse(
              localStorage.getItem(INVENTORY_KEY) ?? "{}",
            ) as InventoryStock,
          );
        } catch {}
      }
    }
    void loadCloudState(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadCloudState(false);
    };
    const poller = window.setInterval(refreshWhenVisible, 15_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(poller);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [initialCourier, initialCourierId]);

  const brandOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          initialAccess === "superadmin" ||
          order.brand.toLowerCase() === initialAccess,
      ),
    [orders, initialAccess],
  );
  const scopedOrders = useMemo(
    () =>
      brandOrders.filter(
        (order) => !dateFilter || order.deliveryDate === dateFilter,
      ),
    [brandOrders, dateFilter],
  );
  const dashboardDate = dateFilter || currentLimaDate();
  const dashboardOrders = useMemo(
    () => brandOrders.filter((order) => order.deliveryDate === dashboardDate),
    [brandOrders, dashboardDate],
  );

  async function logout() {
    await fetch("/api/admin-logout", { method: "POST" });
    window.location.assign("/");
  }

  function saveInventory(nextInventory: InventoryStock) {
    setInventory(nextInventory);
    localStorage.setItem(INVENTORY_KEY, JSON.stringify(nextInventory));
    void mutateCloudState({
      action: "save-inventory",
      inventory: nextInventory,
    });
  }

  async function saveProductCatalog(
    nextCatalog: ProductCatalog,
    rename?: ProductRename,
  ) {
    await mutateCloudState({
      action: "save-product-catalog",
      catalog: nextCatalog,
      ...(rename ? { rename } : {}),
    });
    setProductCatalog(normalizedProductCatalog(nextCatalog));
    if (rename) {
      const nextInventory = renamedInventoryRecord(inventory, rename);
      setInventory(nextInventory);
      localStorage.setItem(INVENTORY_KEY, JSON.stringify(nextInventory));
    }
  }

  async function cancelOrder(order: Order) {
    if (["Entregado", "Cancelado", "Devolución"].includes(order.status))
      return;
    if (
      !window.confirm(
        `¿Confirmas que deseas anular el envío #${order.id} de ${order.client}? El pedido se conservará en el historial con estado Cancelado.`,
      )
    )
      return;

    const cancelledOrder: Order = { ...order, status: "Cancelado" };
    setCancellingOrderId(order.id);
    setOrders((current) => {
      const updated = current.map((item) =>
        item.id === order.id ? cancelledOrder : item,
      );
      localStorage.setItem(ORDERS_KEY, JSON.stringify(updated));
      return updated;
    });

    try {
      await mutateCloudState({
        action: "update-order",
        order: cancelledOrder,
      });
    } catch (error) {
      setOrders((current) => {
        const restored = current.map((item) =>
          item.id === order.id && item.status === "Cancelado" ? order : item,
        );
        localStorage.setItem(ORDERS_KEY, JSON.stringify(restored));
        return restored;
      });
      window.alert(
        error instanceof Error
          ? error.message
          : "No se pudo anular el envío. Intenta nuevamente.",
      );
    } finally {
      setCancellingOrderId("");
    }
  }

  if (initialCourier)
    return (
      <CourierView
        orders={orders}
        setOrders={setOrders}
        inventory={inventory}
        setInventory={setInventory}
        initialOrderId={initialOrderId}
        courierId={initialCourierId}
        courierName={initialCourierName}
      />
    );

  return (
    <div className={`app-shell access-theme-${initialAccess}`}>
      <aside className="sidebar">
        <Link className="brand-lockup" href="/">
          <BrandLogo brand={access.logo} priority />
          <div>
            <strong>{access.title}</strong>
            <small>Logistics OS</small>
          </div>
        </Link>
        <Link className="primary wide create-order-link" href={newOrderHref}>
          ＋ Nuevo pedido
        </Link>
        <nav>
          {nav
            .filter(
              (item) => !item.superadminOnly || initialAccess === "superadmin",
            )
            .map((item) => (
              <button
                key={item.id}
                className={view === item.id ? "active" : ""}
                onClick={() => setView(item.id)}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <Link className="portal-link" href="/acceso-motorizado">
            <span>◉</span>Vista motorizado
          </Link>
          <div className="profile">
            <BrandLogo brand={access.logo} />
            <div>
              <strong>{access.title}</strong>
              <small>{access.subtitle}</small>
            </div>
          </div>
          <button
            className="sidebar-logout logout-button"
            type="button"
            onClick={() => {
              void logout();
            }}
          >
            <span aria-hidden="true">⏻</span>
            Cerrar sesión
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <Link className="mobile-brand" href="/">
            <BrandLogo brand={access.logo} />
            <strong>{access.title}</strong>
          </Link>
          {view !== "pedidos" && (
            <label className="search">
              <span>⌕</span>
              <input
                aria-label="Buscar"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar pedido, cliente o distrito…"
              />
            </label>
          )}
          {view !== "pedidos" && (
            <label className="global-date-filter">
              <span>Fecha</span>
              <DateInput
                aria-label="Filtrar todos los pedidos por fecha"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
              />
            </label>
          )}
          {initialAccess !== "superadmin" && (
            <NotificationCenter audience={initialAccess} onLogout={logout} />
          )}
          <div className="top-actions">
            <span className="current-access">{access.title}</span>
            <button
              className="mobile-logout logout-button"
              type="button"
              aria-label="Cerrar sesión"
              onClick={() => {
                void logout();
              }}
            >
              <span aria-hidden="true">⏻</span>
              <span className="mobile-logout-label">Cerrar sesión</span>
            </button>
          </div>
        </header>
        <section className="content">
          {view === "resumen" && (
            <Dashboard
              orders={dashboardOrders}
              selectedDate={dashboardDate}
              newOrderHref={newOrderHref}
              initialAccess={initialAccess}
              accessTitle={access.title}
              cancellingOrderId={cancellingOrderId}
              onCancelOrder={cancelOrder}
            />
          )}
          {view === "pedidos" && (
            <ReportsView
              orders={brandOrders}
              brand={brand}
              setBrand={setBrand}
              fixedBrand={
                initialAccess === "superadmin" ? undefined : initialAccess
              }
            />
          )}
          {view === "gestiones" && initialAccess === "superadmin" && (
            <ManagementView orders={orders} setOrders={setOrders} />
          )}
          {view === "administradores" && initialAccess === "superadmin" && (
            <AdminUsersAdmin />
          )}
          {view === "motorizados" && initialAccess === "superadmin" && (
            <CourierUsersAdmin />
          )}
          {view === "almacenes" && (
            <WarehousesView
              inventory={inventory}
              initialAccess={initialAccess}
              productCatalog={productCatalog}
            />
          )}
          {view === "inventario" && (
            <InventoryView
              inventory={inventory}
              initialAccess={initialAccess}
              productCatalog={productCatalog}
              onSave={saveInventory}
              onCatalogChange={saveProductCatalog}
            />
          )}
          {view === "rendiciones" && <SettlementsView orders={scopedOrders} />}
        </section>
      </main>
      <Link className="mobile-new-order primary" href={newOrderHref}>
        ＋ Nuevo pedido
      </Link>
      <nav className="bottom-nav">
        {nav
          .filter((item) => !item.superadminOnly || initialAccess === "superadmin")
          .slice(0, 5)
          .map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => setView(item.id)}
          >
            <span>{item.icon}</span>
            {item.label}
          </button>
          ))}
      </nav>
    </div>
  );
}

function PageTitle({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: string;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="clean-empty">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

function Dashboard({
  orders,
  selectedDate,
  newOrderHref,
  initialAccess,
  accessTitle,
  cancellingOrderId,
  onCancelOrder,
}: {
  orders: Order[];
  selectedDate: string;
  newOrderHref: string;
  initialAccess: AdminAccess;
  accessTitle: string;
  cancellingOrderId: string;
  onCancelOrder: (order: Order) => Promise<void>;
}) {
  const count = (status: Order["status"]) =>
    orders.filter((order) => order.status === status).length;
  const pending = count("Pendiente");
  const active = count("En ruta");
  const delivered = count("Entregado");
  const collected = orders
    .filter((order) => order.status === "Entregado")
    .reduce((sum, order) => sum + order.collect, 0);
  const displaySelectedDate = new Date(
    `${selectedDate}T12:00:00`,
  ).toLocaleDateString("es-PE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const statusTotals = [
    { label: "Reprogramados", value: count("Reprogramado") },
    { label: "Cancelados", value: count("Cancelado") },
    { label: "Devoluciones", value: count("Devolución") },
  ];

  return (
    <>
      <PageTitle
        eyebrow={accessTitle.toUpperCase()}
        title="Resumen de pedidos del día"
        subtitle={`Estado actualizado para el ${displaySelectedDate}.`}
        action={
          <Link className="primary page-link" href={newOrderHref}>
            ＋ Crear pedido
          </Link>
        }
      />
      <div className="metrics daily-metrics">
        <Metric
          icon="▣"
          tone="green"
          label="PEDIDOS DEL DÍA"
          value={String(orders.length)}
          note="Total programado"
        />
        <Metric
          icon="○"
          tone="amber"
          label="PENDIENTES"
          value={String(pending)}
          note="Por iniciar entrega"
        />
        <Metric
          icon="⌁"
          tone="cyan"
          label="ACTIVOS"
          value={String(active)}
          note="Entregas activas"
        />
        <Metric
          icon="✓"
          tone="violet"
          label="ENTREGADOS"
          value={String(delivered)}
          note={`${money(collected)} cobrado`}
        />
      </div>
      <section className="panel daily-orders-panel">
        <div className="panel-head daily-orders-head">
          <div>
            <h2>Pedidos programados</h2>
            <p>{displaySelectedDate}</p>
          </div>
          <div className="daily-status-breakdown">
            {statusTotals.map((item) => (
              <span key={item.label}>
                {item.label}
                <b>{item.value}</b>
              </span>
            ))}
          </div>
        </div>
        {orders.length ? (
          <div className="daily-order-list">
            {orders.map((order) => (
              <article className="daily-order-row" key={order.id}>
                <div className="daily-order-identity">
                  <span className={`brand-badge ${order.brand.toLowerCase()}`}>
                    {order.brand}
                  </span>
                  <div>
                    <strong>{order.client}</strong>
                    <small>#{order.id}</small>
                    <small>
                      Motorizado: {order.assignedCourierName || "Sin asignar"}
                    </small>
                  </div>
                </div>
                <div className="daily-order-destination">
                  <small>DESTINO</small>
                  <strong>{order.district}</strong>
                  <span>{order.address}</span>
                </div>
                <div className="daily-order-amount">
                  <small>COBRAR</small>
                  <strong>{money(order.collect)}</strong>
                </div>
                <div className="daily-order-actions">
                  <span
                    className={`status ${order.status.toLowerCase().replace(" ", "-")}`}
                  >
                    {adminStatusLabel(order.status)}
                  </span>
                  <Link
                    className="edit-order-button"
                    href={`/admin/pedidos/nuevo?access=${initialAccess}&edit=${encodeURIComponent(order.id)}`}
                    aria-label={`Editar pedido ${order.id}`}
                  >
                    <span aria-hidden="true">✎</span>
                    Editar pedido
                  </Link>
                  {!["Entregado", "Cancelado", "Devolución"].includes(
                    order.status,
                  ) && (
                    <button
                      className="cancel-order-button"
                      type="button"
                      disabled={cancellingOrderId === order.id}
                      onClick={() => void onCancelOrder(order)}
                      aria-label={`Anular envío ${order.id}`}
                    >
                      <span aria-hidden="true">×</span>
                      {cancellingOrderId === order.id
                        ? "Anulando…"
                        : "Anular envío"}
                    </button>
                  )}
                  <button
                    className="label-download-button"
                    type="button"
                    onClick={() => void downloadOrderLabel(order)}
                    aria-label={`Descargar rótulo del pedido ${order.id}`}
                  >
                    <span aria-hidden="true">↓</span>
                    Descargar rótulo
                  </button>
                </div>
                <AdminPhotoEvidence order={order} />
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="▣"
            title="No hay pedidos para esta fecha"
            text="Crea un pedido o selecciona otra fecha en el filtro superior."
          />
        )}
      </section>
    </>
  );
}

function Metric({
  icon,
  tone,
  label,
  value,
  note,
}: {
  icon: string;
  tone: string;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article>
      <span className={`metric-icon ${tone}`}>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{note}</em>
      </div>
    </article>
  );
}

function ReportsView({
  orders,
  brand,
  setBrand,
  fixedBrand,
}: {
  orders: Order[];
  brand: string;
  setBrand: (brand: string) => void;
  fixedBrand?: "suyai" | "aura";
}) {
  const [mode, setMode] = useState<"exacta" | "rango">("exacta");
  const [exactDate, setExactDate] = useState(currentLimaDate);
  const [fromDate, setFromDate] = useState(currentLimaDate);
  const [toDate, setToDate] = useState(currentLimaDate);
  const [status, setStatus] = useState("Todos");
  const [courier, setCourier] = useState("Todos");
  const courierOptions = useMemo(() => {
    const options = new Map<string, string>();
    orders.forEach((order) => {
      options.set(
        assignedCourierKey(order),
        order.assignedCourierName || "Sin asignar",
      );
    });
    return [...options.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((first, second) =>
        first.name.localeCompare(second.name, "es-PE"),
      );
  }, [orders]);
  const dateReady =
    mode === "exacta"
      ? Boolean(exactDate)
      : Boolean(fromDate && toDate && fromDate <= toDate);
  const invalidRange =
    mode === "rango" && Boolean(fromDate && toDate && fromDate > toDate);
  const reportOrders = orders
    .filter((order) => {
      const matchesDate =
        mode === "exacta"
          ? order.deliveryDate === exactDate
          : Boolean(
              order.deliveryDate &&
                order.deliveryDate >= fromDate &&
                order.deliveryDate <= toDate,
            );
      const matchesBrand = fixedBrand
        ? order.brand.toLowerCase() === fixedBrand
        : brand === "Todas" || order.brand === brand;
      return (
        dateReady &&
        matchesDate &&
        matchesBrand &&
        (status === "Todos" || order.status === status) &&
        (courier === "Todos" || assignedCourierKey(order) === courier)
      );
    })
    .sort((first, second) =>
      `${second.deliveryDate ?? ""}|${second.id}`.localeCompare(
        `${first.deliveryDate ?? ""}|${first.id}`,
      ),
    );
  const periodLabel = mode === "exacta" ? exactDate : fromDate + "_a_" + toDate;
  const totalCollect = reportOrders.reduce(
    (sum, order) => sum + order.collect,
    0,
  );
  const totalCommission = reportOrders.reduce(
    (sum, order) => sum + order.commission,
    0,
  );

  const scopedBrandName =
    fixedBrand === "suyai" ? "Suyai" : fixedBrand === "aura" ? "Aura" : "";
  const reportTitle = scopedBrandName
    ? `Reporte de pedidos ${scopedBrandName}`
    : "Reporte general de pedidos";
  const exportPeriodLabel = scopedBrandName
    ? `${scopedBrandName}_${periodLabel}`
    : periodLabel;
  const selectedCourierName =
    courier === "Todos"
      ? "Todos"
      : courierOptions.find((option) => option.id === courier)?.name ??
        "Motorizado";
  const exportLabel = `${exportPeriodLabel}_motorizado_${selectedCourierName}`;

  return (
    <>
      <PageTitle
        eyebrow="ANÁLISIS Y EXPORTACIÓN"
        title={reportTitle}
        subtitle={
          scopedBrandName
            ? `Consulta y descarga únicamente los pedidos de ${scopedBrandName}.`
            : "Consulta todas las empresas por fecha, rango y estado."
        }
      />
      {scopedBrandName && (
        <div className="report-scope-notice">
          <span>◆</span>
          <div>
            <b>Acceso limitado a {scopedBrandName}</b>
            <small>
              Este reporte y su archivo Excel excluyen automáticamente los
              pedidos de otras empresas.
            </small>
          </div>
        </div>
      )}
      <section className="report-controls">
        <div className="report-mode">
          <button
            className={mode === "exacta" ? "active" : ""}
            onClick={() => setMode("exacta")}
          >
            Fecha exacta
          </button>
          <button
            className={mode === "rango" ? "active" : ""}
            onClick={() => setMode("rango")}
          >
            Rango de fechas
          </button>
        </div>
        <div className="report-filter-fields">
          {mode === "exacta" ? (
            <label>
              <span>Fecha del reporte</span>
              <DateInput
                value={exactDate}
                onChange={(event) => setExactDate(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label>
                <span>Desde</span>
                <DateInput
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </label>
              <label>
                <span>Hasta</span>
                <DateInput
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(event) => setToDate(event.target.value)}
                />
              </label>
            </>
          )}
          {fixedBrand ? (
            <div className="report-fixed-brand">
              <span>Empresa</span>
              <b className={"brand-badge " + fixedBrand}>
                {fixedBrand === "suyai" ? "Suyai" : "Aura"}
              </b>
            </div>
          ) : (
            <label>
              <span>Empresa</span>
              <select
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
              >
                <option>Todas</option>
                <option>Suyai</option>
                <option>Aura</option>
              </select>
            </label>
          )}
          <label>
            <span>Estado</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option>Todos</option>
              <option>Pendiente</option>
              <option value="En ruta">Activos</option>
              <option>Reprogramado</option>
              <option>Entregado</option>
              <option>Cancelado</option>
              <option>Devolución</option>
            </select>
          </label>
          <label>
            <span>Motorizado</span>
            <select
              value={courier}
              onChange={(event) => setCourier(event.target.value)}
            >
              <option value="Todos">Todos los motorizados</option>
              {courierOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="download-excel"
          type="button"
          disabled={!dateReady || !reportOrders.length}
          onClick={() =>
            void downloadOrdersReport(
              reportOrders.map((order) => ({
                ...order,
                status: adminStatusLabel(order.status),
              })),
              exportLabel,
            )
          }
        >
          ⇩ Descargar Excel (.xlsx)
        </button>
      </section>
      {dateReady && (
        <div className="report-metrics">
          <article>
            <small>PEDIDOS ENCONTRADOS</small>
            <strong>{reportOrders.length}</strong>
          </article>
          <article>
            <small>MONTO A COBRAR</small>
            <strong>{money(totalCollect)}</strong>
          </article>
          <article>
            <small>COMISIONES</small>
            <strong>{money(totalCommission)}</strong>
          </article>
        </div>
      )}
      <div className="table-card report-table">
        {!dateReady ? (
          <EmptyState
            icon="▣"
            title={
              invalidRange
                ? "El rango de fechas no es válido"
                : "Selecciona el periodo del reporte"
            }
            text={
              invalidRange
                ? "La fecha Desde debe ser anterior o igual a la fecha Hasta."
                : "Elige una fecha exacta o completa las dos fechas del rango."
            }
          />
        ) : reportOrders.length ? (
          <table>
            <thead>
              <tr>
                <th>Fecha / pedido</th>
                <th>Empresa / cliente</th>
                <th>Productos</th>
                <th>Destino</th>
                <th>Motorizado</th>
                <th>Cobrar</th>
                <th>Comisión</th>
                <th>Estado</th>
                <th>Evidencia</th>
              </tr>
            </thead>
            <tbody>
              {reportOrders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <b>{order.deliveryDate}</b>
                    <small>#{order.id}</small>
                  </td>
                  <td>
                    <span
                      className={"brand-badge " + order.brand.toLowerCase()}
                    >
                      {order.brand}
                    </span>
                    <b>{order.client}</b>
                  </td>
                  <td>
                    {order.products?.length ? (
                      order.products.map((product) => (
                        <small key={product.name}>
                          {product.quantity} × {product.name}
                        </small>
                      ))
                    ) : (
                      <small>Sin detalle</small>
                    )}
                  </td>
                  <td>
                    <b>{order.district}</b>
                    <small>{order.address}</small>
                  </td>
                  <td>
                    <b>{order.assignedCourierName || "Sin asignar"}</b>
                  </td>
                  <td>
                    <b>{money(order.collect)}</b>
                  </td>
                  <td>
                    <b>{money(order.commission)}</b>
                  </td>
                  <td>
                    <span
                      className={
                        "status " + order.status.toLowerCase().replace(" ", "-")
                      }
                    >
                      {adminStatusLabel(order.status)}
                    </span>
                  </td>
                  <td>
                    <AdminPhotoEvidence order={order} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon="▣"
            title="Sin pedidos en este periodo"
            text="Cambia las fechas, empresa, estado o motorizado para ampliar el reporte."
          />
        )}
      </div>
    </>
  );
}

function ManagementView({
  orders,
  setOrders,
}: {
  orders: Order[];
  setOrders: (orders: Order[]) => void;
}) {
  const [passwordRole, setPasswordRole] = useState<AdminAccess>("suyai");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [deleteAccount, setDeleteAccount] = useState<
    "Todas" | "Suyai" | "Aura"
  >("Todas");
  const [deleteFrom, setDeleteFrom] = useState("");
  const [deleteTo, setDeleteTo] = useState("");
  const [deleteNotice, setDeleteNotice] = useState("");
  const [pushSettings, setPushSettings] = useState({
    suyai: false,
    aura: false,
    courier: false,
  });
  const [contactSettings, setContactSettings] = useState<CourierContactSettings>(
    DEFAULT_COURIER_CONTACT_SETTINGS,
  );
  const [contactTemplateBrand, setContactTemplateBrand] = useState<"Suyai" | "Aura">("Suyai");
  const [contactSettingsNotice, setContactSettingsNotice] = useState("");
  const [contactSettingsSaving, setContactSettingsSaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void readCloudState<Order>()
        .then((cloud) => {
          setPushSettings(cloud.pushSettings);
          setContactSettings(cloud.courierContactSettings);
        })
        .catch(() => {
          try {
            const saved = JSON.parse(
              localStorage.getItem(PUSH_SETTINGS_KEY) ?? "null",
            ) as typeof pushSettings | null;
            if (saved) setPushSettings(saved);
          } catch {}
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const recordsToDelete = useMemo(
    () =>
      orders.filter(
        (order) =>
          Boolean(
            deleteFrom &&
            deleteTo &&
            order.deliveryDate &&
            order.deliveryDate >= deleteFrom &&
            order.deliveryDate <= deleteTo,
          ) &&
          (deleteAccount === "Todas" || order.brand === deleteAccount),
      ),
    [orders, deleteAccount, deleteFrom, deleteTo],
  );

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordNotice("");
    setPasswordError("");
    if (!newPassword || newPassword.length > 128)
      return setPasswordError("Ingresa una contraseña de hasta 128 caracteres.");
    if (newPassword !== confirmPassword)
      return setPasswordError("Las contraseñas no coinciden.");
    setPasswordSaving(true);
    try {
      const response = await fetch("/api/admin-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: passwordRole, password: newPassword }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        return setPasswordError(
          result.error ?? "No se pudo cambiar la contraseña.",
        );
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice(
        `Contraseña de ${accessLabels[passwordRole].title} actualizada.`,
      );
    } catch {
      setPasswordError("No se pudo conectar con el servidor.");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function deleteRecords() {
    setDeleteNotice("");
    if (!deleteFrom || !deleteTo)
      return setDeleteNotice("Completa las dos fechas del rango.");
    if (deleteFrom > deleteTo)
      return setDeleteNotice(
        "La fecha inicial no puede ser posterior a la fecha final.",
      );
    if (!recordsToDelete.length)
      return setDeleteNotice(
        "No hay registros para eliminar con esos filtros.",
      );
    const accountLabel =
      deleteAccount === "Todas" ? "todas las cuentas" : deleteAccount;
    if (
      !window.confirm(
        `Se eliminarán permanentemente ${recordsToDelete.length} pedido(s) de ${accountLabel}, desde ${deleteFrom} hasta ${deleteTo}. ¿Deseas continuar?`,
      )
    )
      return;
    const removedIds = new Set(recordsToDelete.map((order) => order.id));
    const remaining = orders.filter((order) => !removedIds.has(order.id));
    setOrders(remaining);
    localStorage.setItem(ORDERS_KEY, JSON.stringify(remaining));
    await mutateCloudState({ action: "delete-orders", ids: [...removedIds] });
    setDeleteNotice(
      `${recordsToDelete.length} registro(s) eliminado(s) correctamente.`,
    );
  }

  function togglePush(target: keyof typeof pushSettings) {
    setPushSettings((current) => {
      const next = { ...current, [target]: !current[target] };
      localStorage.setItem(PUSH_SETTINGS_KEY, JSON.stringify(next));
      void mutateCloudState({ action: "save-push-settings", value: next });
      return next;
    });
  }

  async function saveContactSettings() {
    setContactSettingsNotice("");
    setContactSettingsSaving(true);
    try {
      await mutateCloudState({
        action: "save-courier-contact-settings",
        value: contactSettings,
      });
      setContactSettingsNotice("Configuración guardada para todos los dispositivos.");
    } catch (error) {
      setContactSettingsNotice(
        error instanceof Error ? error.message : "No se pudo guardar la configuración.",
      );
    } finally {
      setContactSettingsSaving(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="SUPERADMIN"
        title="Gestiones del sistema"
        subtitle="Administra accesos, registros operativos y preferencias de notificaciones."
      />
      <div className="management-grid">
        <section className="panel management-card">
          <div className="management-heading">
            <span>1</span>
            <div>
              <h2>Cambiar contraseñas</h2>
              <p>Actualiza el acceso de una cuenta administrativa.</p>
            </div>
          </div>
          <form className="management-form" onSubmit={changePassword}>
            <label>
              <span>Cuenta</span>
              <select
                value={passwordRole}
                onChange={(event) => {
                  setPasswordRole(event.target.value as AdminAccess);
                  setPasswordError("");
                  setPasswordNotice("");
                }}
              >
                <option value="superadmin">Superadmin</option>
                <option value="suyai">Administración Suyai</option>
                <option value="aura">Administración Aura</option>
              </select>
            </label>
            <label>
              <span>Nueva contraseña</span>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                maxLength={128}
                placeholder="Escribe una contraseña"
              />
            </label>
            <label>
              <span>Confirmar contraseña</span>
              <input
                type="password"
                autoComplete="new-password"
                maxLength={128}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repite la contraseña"
              />
            </label>
            {passwordError && (
              <div className="management-message error">{passwordError}</div>
            )}
            {passwordNotice && (
              <div className="management-message success">
                ✓ {passwordNotice}
              </div>
            )}
            <button className="primary" type="submit" disabled={passwordSaving}>
              {passwordSaving ? "Guardando…" : "Guardar contraseña"}
            </button>
          </form>
        </section>
        <section className="panel management-card danger-management">
          <div className="management-heading">
            <span>2</span>
            <div>
              <h2>Eliminar registros</h2>
              <p>Borra pedidos y evidencias dentro de un rango de fechas.</p>
            </div>
          </div>
          <div className="management-form">
            <label>
              <span>Cuenta</span>
              <select
                value={deleteAccount}
                onChange={(event) => {
                  setDeleteAccount(event.target.value as typeof deleteAccount);
                  setDeleteNotice("");
                }}
              >
                <option>Todas</option>
                <option>Suyai</option>
                <option>Aura</option>
              </select>
            </label>
            <div className="management-date-range">
              <label>
                <span>Desde</span>
                <DateInput
                  value={deleteFrom}
                  max={deleteTo || undefined}
                  onChange={(event) => {
                    setDeleteFrom(event.target.value);
                    setDeleteNotice("");
                  }}
                />
              </label>
              <label>
                <span>Hasta</span>
                <DateInput
                  value={deleteTo}
                  min={deleteFrom || undefined}
                  onChange={(event) => {
                    setDeleteTo(event.target.value);
                    setDeleteNotice("");
                  }}
                />
              </label>
            </div>
            <div className="delete-preview">
              <span>Registros encontrados</span>
              <strong>{recordsToDelete.length}</strong>
            </div>
            {deleteNotice && (
              <div
                className={`management-message ${deleteNotice.includes("correctamente") ? "success" : "warning"}`}
              >
                {deleteNotice}
              </div>
            )}
            <button
              className="danger-button"
              type="button"
              onClick={() => {
                void deleteRecords();
              }}
              disabled={!deleteFrom || !deleteTo}
            >
              Eliminar registros seleccionados
            </button>
            <small className="danger-note">
              Esta acción solicitará confirmación y no se puede deshacer.
            </small>
          </div>
        </section>
        <section className="panel management-card push-management">
          <div className="management-heading">
            <span>3</span>
            <div>
              <h2>Mensajes push</h2>
              <p>Activa o desactiva las notificaciones por grupo.</p>
            </div>
          </div>
          <div className="push-setting-list">
            {(
              [
                {
                  key: "suyai",
                  label: "Administración Suyai",
                  text: "Avisos operativos para Suyai",
                },
                {
                  key: "aura",
                  label: "Administración Aura",
                  text: "Avisos operativos para Aura",
                },
                {
                  key: "courier",
                  label: "Motorizados",
                  text: "Cambios y asignaciones de pedidos",
                },
              ] as const
            ).map((item) => (
              <div key={item.key}>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.text}</small>
                </div>
                <button
                  className={
                    pushSettings[item.key]
                      ? "push-toggle active"
                      : "push-toggle"
                  }
                  type="button"
                  role="switch"
                  aria-checked={pushSettings[item.key]}
                  onClick={() => togglePush(item.key)}
                >
                  <span />
                  {pushSettings[item.key] ? "Activado" : "Desactivado"}
                </button>
              </div>
            ))}
          </div>
          <div className="push-help">
            La preferencia queda guardada en Supabase y controla tanto los
            avisos internos como el envío por Firebase a los dispositivos activos.
          </div>
        </section>
        <section className="panel management-card contact-management">
          <div className="management-heading">
            <span>4</span>
            <div>
              <h2>Avisos al cliente</h2>
              <p>Configura la precisión GPS, el margen de llegada y las plantillas de WhatsApp.</p>
            </div>
          </div>
          <div className="management-form contact-settings-form">
            <div className="contact-settings-grid">
              <label>
                <span>Margen antes (min)</span>
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={contactSettings.etaBufferBeforeMinutes}
                  onChange={(event) => setContactSettings((current) => ({
                    ...current,
                    etaBufferBeforeMinutes: Number(event.target.value),
                  }))}
                />
              </label>
              <label>
                <span>Margen después (min)</span>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={contactSettings.etaBufferAfterMinutes}
                  onChange={(event) => setContactSettings((current) => ({
                    ...current,
                    etaBufferAfterMinutes: Number(event.target.value),
                  }))}
                />
              </label>
              <label>
                <span>Precisión GPS máx. (m)</span>
                <input
                  type="number"
                  min="20"
                  max="1000"
                  value={contactSettings.maxAccuracyMeters}
                  onChange={(event) => setContactSettings((current) => ({
                    ...current,
                    maxAccuracyMeters: Number(event.target.value),
                  }))}
                />
              </label>
              <label>
                <span>Reusar ubicación (min)</span>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={contactSettings.reuseLocationMinutes}
                  onChange={(event) => setContactSettings((current) => ({
                    ...current,
                    reuseLocationMinutes: Number(event.target.value),
                  }))}
                />
              </label>
              <label>
                <span>Código de país</span>
                <input
                  inputMode="numeric"
                  value={contactSettings.countryCode}
                  onChange={(event) => setContactSettings((current) => ({
                    ...current,
                    countryCode: event.target.value.replace(/\D/g, "").slice(0, 4),
                  }))}
                />
              </label>
              <label className="contact-force-setting">
                <span>Aviso fuera de orden</span>
                <button
                  className={contactSettings.allowForcedNotice ? "push-toggle active" : "push-toggle"}
                  type="button"
                  role="switch"
                  aria-checked={contactSettings.allowForcedNotice}
                  onClick={() => setContactSettings((current) => ({
                    ...current,
                    allowForcedNotice: !current.allowForcedNotice,
                  }))}
                >
                  <span />
                  {contactSettings.allowForcedNotice ? "Permitido" : "Bloqueado"}
                </button>
              </label>
            </div>
            <label>
              <span>Plantillas para</span>
              <select
                value={contactTemplateBrand}
                onChange={(event) => setContactTemplateBrand(event.target.value as "Suyai" | "Aura")}
              >
                <option>Suyai</option>
                <option>Aura</option>
              </select>
            </label>
            <label>
              <span>Mensaje de inicio de jornada</span>
              <textarea
                rows={7}
                value={contactSettings.morningTemplates[contactTemplateBrand]}
                onChange={(event) => setContactSettings((current) => ({
                  ...current,
                  morningTemplates: {
                    ...current.morningTemplates,
                    [contactTemplateBrand]: event.target.value,
                  },
                }))}
              />
            </label>
            <label>
              <span>Mensaje de próxima entrega</span>
              <textarea
                rows={8}
                value={contactSettings.nextDeliveryTemplates[contactTemplateBrand]}
                onChange={(event) => setContactSettings((current) => ({
                  ...current,
                  nextDeliveryTemplates: {
                    ...current.nextDeliveryTemplates,
                    [contactTemplateBrand]: event.target.value,
                  },
                }))}
              />
            </label>
            <small className="contact-template-help">
              El texto {"{courier_intro}"} siempre identifica a Pegasus Delivery como courier y a Suyai o Aura como empresa del pedido. Variables: {"{customer_name}"}, {"{order_number}"}, {"{business_name}"}, {"{delivery_company}"}, {"{courier_intro}"},
              {" {eta_start}"} y {"{eta_end}"}. Las dos últimas corresponden al aviso de próxima entrega.
            </small>
            {contactSettingsNotice && (
              <div className={`management-message ${contactSettingsNotice.includes("guardada") ? "success" : "error"}`}>
                {contactSettingsNotice}
              </div>
            )}
            <button
              className="primary"
              type="button"
              disabled={contactSettingsSaving}
              onClick={() => void saveContactSettings()}
            >
              {contactSettingsSaving ? "Guardando…" : "Guardar avisos al cliente"}
            </button>
          </div>
        </section>
        <PushDeviceManager />
      </div>
    </>
  );
}

function inventoryBrands(initialAccess: AdminAccess) {
  return initialAccess === "superadmin"
    ? (["Suyai", "Aura"] as const)
    : ([initialAccess === "suyai" ? "Suyai" : "Aura"] as const);
}

function inventoryKey(
  brand: "Suyai" | "Aura",
  warehouseCode: string,
  product: string,
) {
  return `${brand}|${warehouseCode}|${product}`;
}

function renamedInventoryRecord<T>(
  current: Record<string, T>,
  rename: ProductRename,
) {
  const next = { ...current };
  const prefix = `${rename.brand}|`;
  for (const [key, value] of Object.entries(current)) {
    if (!key.startsWith(prefix)) continue;
    const separator = key.indexOf("|", prefix.length);
    if (separator < 0 || key.slice(separator + 1) !== rename.oldName) continue;
    const nextKey = `${key.slice(0, separator + 1)}${rename.newName}`;
    next[nextKey] = value;
    delete next[key];
  }
  return next;
}

function WarehousesView({
  inventory,
  initialAccess,
  productCatalog,
}: {
  inventory: InventoryStock;
  initialAccess: AdminAccess;
  productCatalog: ProductCatalog;
}) {
  const allowedBrands = inventoryBrands(initialAccess);
  const rimac = warehouses[0];
  const availableProducts = allowedBrands
    .flatMap((brand) =>
      productCatalog[brand].map((product) => ({
        brand,
        product,
        quantity: inventory[inventoryKey(brand, rimac.code, product)] ?? 0,
      })),
    )
    .filter((item) => item.quantity > 0)
    .sort(
      (a, b) =>
        b.quantity - a.quantity || a.product.localeCompare(b.product, "es"),
    );
  const totalAvailable = availableProducts.reduce(
    (total, item) => total + item.quantity,
    0,
  );

  return (
    <>
      <PageTitle
        eyebrow="ALMACÉN PRINCIPAL"
        title="Almacén Rímac"
        subtitle="Stock disponible actualmente en Jr. Libertad 366, Rímac."
      />
      <div className="rimac-warehouse-layout">
        <article className="warehouse-card rimac-main-card">
          <div className={`warehouse-hero ${rimac.tone}`}>
            <span>{rimac.code}</span>
            <small>Principal</small>
          </div>
          <div className="warehouse-content">
            <h2>{rimac.name}</h2>
            <p>{rimac.address}</p>
            <div className="warehouse-stats rimac-stats">
              <div>
                <small>Productos con stock</small>
                <b>{availableProducts.length}</b>
              </div>
              <div>
                <small>Disponible</small>
                <b>{totalAvailable}</b>
              </div>
            </div>
            <a
              className="secondary link-button"
              href={rimac.maps}
              target="_blank"
              rel="noreferrer"
            >
              Ver ubicación en Maps ↗
            </a>
          </div>
        </article>
        <section className="panel warehouse-stock-preview">
          <div className="panel-head">
            <div>
              <h2>Vista previa del stock</h2>
              <p>Unidades disponibles por producto</p>
            </div>
            <strong>{totalAvailable} unidades</strong>
          </div>
          {availableProducts.length ? (
            <div className="warehouse-stock-list">
              {availableProducts.map((item) => (
                <div key={`${item.brand}-${item.product}`}>
                  <span className={`brand-badge ${item.brand.toLowerCase()}`}>
                    {item.brand}
                  </span>
                  <b>{item.product}</b>
                  <strong>{item.quantity}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="▣"
              title="Sin stock disponible"
              text="Ingresa existencias desde la sección Inventario."
            />
          )}
        </section>
      </div>
    </>
  );
}

function InventoryView({
  inventory,
  initialAccess,
  productCatalog,
  onSave,
  onCatalogChange,
}: {
  inventory: InventoryStock;
  initialAccess: AdminAccess;
  productCatalog: ProductCatalog;
  onSave: (inventory: InventoryStock) => void;
  onCatalogChange: (
    catalog: ProductCatalog,
    rename?: ProductRename,
  ) => Promise<void>;
}) {
  const allowedBrands = inventoryBrands(initialAccess);
  const [warehouseCode, setWarehouseCode] = useState(warehouses[0].code);
  const [productSearch, setProductSearch] = useState("");
  const [stockEntries, setStockEntries] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [catalogBrand, setCatalogBrand] = useState<keyof ProductCatalog>("Suyai");
  const [newProduct, setNewProduct] = useState("");
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [editingProduct, setEditingProduct] = useState<{
    brand: keyof ProductCatalog;
    original: string;
    value: string;
  } | null>(null);

  const visibleProducts = allowedBrands
    .flatMap((brand) =>
      productCatalog[brand].map((product) => ({ brand, product })),
    )
    .filter((item) =>
      item.product.toLowerCase().includes(productSearch.trim().toLowerCase()),
    );
  const selectedWarehouse =
    warehouses.find((item) => item.code === warehouseCode) ?? warehouses[0];
  const productsWithStock = visibleProducts.filter(
    (item) =>
      (Number(inventory[inventoryKey(item.brand, warehouseCode, item.product)]) ||
        0) > 0,
  ).length;
  const productsInNegative = visibleProducts.filter(
    (item) =>
      (Number(inventory[inventoryKey(item.brand, warehouseCode, item.product)]) ||
        0) < 0,
  ).length;

  function updateStockEntry(key: string, value: string) {
    if (value !== "" && !/^\d+$/.test(value)) return;
    setStockEntries((current) => ({ ...current, [key]: value }));
    setNotice("");
  }

  function addStock(key: string, product: string) {
    const quantity = Math.floor(Number(stockEntries[key]));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setNotice("Escribe una cantidad mayor a cero antes de agregar stock.");
      return;
    }
    const currentBalance = Number(inventory[key]) || 0;
    const nextBalance = inventoryBalanceAfterEntry(currentBalance, quantity);
    const next = withInventoryBalance(inventory, key, nextBalance);
    onSave(next);
    setStockEntries((current) => ({ ...current, [key]: "" }));
    setNotice(
      `${quantity} unidad${quantity === 1 ? "" : "es"} agregada${quantity === 1 ? "" : "s"} a ${product}. Saldo: ${nextBalance}.`,
    );
  }

  function resetStock(key: string, product: string) {
    const currentBalance = Number(inventory[key]) || 0;
    if (currentBalance >= 0) return;
    if (
      !window.confirm(
        `¿Volver a cero el saldo de “${product}”? El saldo actual es ${currentBalance}.`,
      )
    )
      return;
    const next = withInventoryBalance(inventory, key, 0);
    onSave(next);
    setStockEntries((current) => ({ ...current, [key]: "" }));
    setNotice(`El saldo de ${product} volvió a cero.`);
  }

  async function addCatalogProduct() {
    const product = newProduct.trim().replace(/\s+/g, " ");
    if (!product) {
      setNotice("Escribe el nombre del producto antes de agregarlo.");
      return;
    }
    if (
      productCatalog[catalogBrand].some(
        (item) =>
          normalizedInventoryName(item) === normalizedInventoryName(product),
      )
    ) {
      setNotice(`${product} ya existe en el catálogo ${catalogBrand}.`);
      return;
    }
    const nextCatalog: ProductCatalog = {
      ...productCatalog,
      [catalogBrand]: [...productCatalog[catalogBrand], product],
    };
    setCatalogSaving(true);
    try {
      await onCatalogChange(nextCatalog);
      setNewProduct("");
      setNotice(`${product} agregado al catálogo ${catalogBrand}.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "No se pudo agregar el producto.",
      );
    } finally {
      setCatalogSaving(false);
    }
  }

  async function removeCatalogProduct(
    brand: keyof ProductCatalog,
    product: string,
  ) {
    if (
      !window.confirm(
        `¿Quitar “${product}” del catálogo ${brand}? Dejará de aparecer en nuevos pedidos, pero los pedidos anteriores se conservarán.`,
      )
    )
      return;
    const nextCatalog: ProductCatalog = {
      ...productCatalog,
      [brand]: productCatalog[brand].filter((item) => item !== product),
    };
    setCatalogSaving(true);
    try {
      await onCatalogChange(nextCatalog);
      setNotice(`${product} fue retirado del catálogo ${brand}.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "No se pudo quitar el producto.",
      );
    } finally {
      setCatalogSaving(false);
    }
  }

  async function renameCatalogProduct() {
    if (!editingProduct) return;
    const nextName = editingProduct.value
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\|/g, "-");
    if (!nextName) {
      setNotice("El nombre del producto no puede quedar vacío.");
      return;
    }
    if (nextName === editingProduct.original) {
      setEditingProduct(null);
      return;
    }
    if (
      productCatalog[editingProduct.brand].some(
        (item) =>
          item !== editingProduct.original &&
          normalizedInventoryName(item) === normalizedInventoryName(nextName),
      )
    ) {
      setNotice(`${nextName} ya existe en el catálogo ${editingProduct.brand}.`);
      return;
    }
    const rename: ProductRename = {
      brand: editingProduct.brand,
      oldName: editingProduct.original,
      newName: nextName,
    };
    const nextCatalog: ProductCatalog = {
      ...productCatalog,
      [editingProduct.brand]: productCatalog[editingProduct.brand].map((item) =>
        item === editingProduct.original ? nextName : item,
      ),
    };
    setCatalogSaving(true);
    try {
      await onCatalogChange(nextCatalog, rename);
      setEditingProduct(null);
      setNotice(
        `${editingProduct.original} ahora se llama ${nextName}. El stock fue conservado.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "No se pudo editar el producto.",
      );
    } finally {
      setCatalogSaving(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="CONTROL DE STOCK"
        title="Inventario por almacén"
        subtitle="Suma ingresos de stock y revisa en rojo los faltantes generados por entregas."
      />
      {initialAccess === "superadmin" && (
        <section className="inventory-catalog-manager">
          <div>
            <strong>Administrar catálogo</strong>
            <small>Agrega productos de Suyai o Aura. Los cambios aparecen en todos los dispositivos.</small>
          </div>
          <label>
            <span>Empresa</span>
            <select
              value={catalogBrand}
              onChange={(event) =>
                setCatalogBrand(event.target.value as keyof ProductCatalog)
              }
            >
              <option value="Suyai">Suyai</option>
              <option value="Aura">Aura</option>
            </select>
          </label>
          <label className="catalog-product-name">
            <span>Nuevo producto</span>
            <input
              value={newProduct}
              maxLength={100}
              onChange={(event) => setNewProduct(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addCatalogProduct();
                }
              }}
              placeholder="Nombre del producto"
            />
          </label>
          <button
            className="primary catalog-add-button"
            type="button"
            disabled={catalogSaving}
            onClick={() => void addCatalogProduct()}
          >
            ＋ Agregar producto
          </button>
        </section>
      )}
      <section className="inventory-toolbar">
        <label>
          <span>Almacén</span>
          <select
            value={warehouseCode}
            onChange={(event) => {
              setWarehouseCode(event.target.value);
              setNotice("");
            }}
          >
            {warehouses.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Buscar producto</span>
          <input
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="Escribe para buscar…"
          />
        </label>
        <div className="inventory-summary">
          <div>
            <small>PRODUCTOS</small>
            <b>{visibleProducts.length}</b>
          </div>
          <div>
            <small>CON STOCK</small>
            <b>{productsWithStock}</b>
          </div>
          <div>
            <small>EN NEGATIVO</small>
            <b className={productsInNegative ? "inventory-negative-count" : ""}>
              {productsInNegative}
            </b>
          </div>
        </div>
      </section>
      {notice && (
        <div className="inventory-notice" role="status">
          ✓ {notice}
        </div>
      )}
      <div className="table-card inventory-table">
        <table>
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Producto</th>
              <th>Almacén</th>
              <th className="inventory-movement-column">Saldo y entrada</th>
              {initialAccess === "superadmin" && (
                <th className="inventory-action-column">Acción</th>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((item) => {
              const key = inventoryKey(item.brand, warehouseCode, item.product);
              const currentBalance = Number(inventory[key]) || 0;
              const isEditing =
                editingProduct?.brand === item.brand &&
                editingProduct.original === item.product;
              return (
                <tr key={key}>
                  <td>
                    <span className={`brand-badge ${item.brand.toLowerCase()}`}>
                      {item.brand}
                    </span>
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        className="catalog-edit-input"
                        value={editingProduct?.value ?? item.product}
                        maxLength={100}
                        autoFocus
                        onChange={(event) =>
                          setEditingProduct((current) =>
                            current
                              ? { ...current, value: event.target.value }
                              : current,
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void renameCatalogProduct();
                          }
                          if (event.key === "Escape") setEditingProduct(null);
                        }}
                        aria-label={`Nuevo nombre para ${item.product}`}
                      />
                    ) : (
                      <b>{item.product}</b>
                    )}
                  </td>
                  <td className="inventory-warehouse-column">
                    <span>{selectedWarehouse.name}</span>
                    <small>{selectedWarehouse.code}</small>
                  </td>
                  <td className="inventory-movement-column">
                    <div className={`stock-movement ${currentBalance < 0 ? "is-negative" : ""}`}>
                      <div className="stock-current-balance">
                        <small>Saldo actual</small>
                        <strong>{currentBalance}</strong>
                      </div>
                      <label className="stock-entry-input">
                        <span className="sr-only">Cantidad a agregar</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          step="1"
                          value={stockEntries[key] ?? ""}
                          onChange={(event) =>
                            updateStockEntry(key, event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addStock(key, item.product);
                            }
                          }}
                          placeholder="Cantidad"
                          aria-label={`Cantidad a agregar a ${item.product}`}
                        />
                      </label>
                      <button
                        className="stock-add-button"
                        type="button"
                        onClick={() => addStock(key, item.product)}
                      >
                        ＋ Agregar stock
                      </button>
                      <button
                        className="stock-reset-button"
                        type="button"
                        disabled={currentBalance >= 0}
                        onClick={() => resetStock(key, item.product)}
                      >
                        Volver a cero
                      </button>
                    </div>
                  </td>
                  {initialAccess === "superadmin" && (
                    <td className="inventory-action-column">
                      {isEditing ? (
                        <div className="catalog-edit-actions">
                          <button
                            className="catalog-save-edit"
                            type="button"
                            disabled={catalogSaving}
                            onClick={() => void renameCatalogProduct()}
                          >
                            ✓ Guardar
                          </button>
                          <button
                            className="catalog-cancel-edit"
                            type="button"
                            disabled={catalogSaving}
                            onClick={() => setEditingProduct(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="catalog-row-actions">
                          <button
                            className="catalog-edit-button"
                            type="button"
                            disabled={catalogSaving}
                            onClick={() =>
                              setEditingProduct({
                                brand: item.brand,
                                original: item.product,
                                value: item.product,
                              })
                            }
                          >
                            ✎ Editar
                          </button>
                          <button
                            className="catalog-remove-button"
                            type="button"
                            disabled={catalogSaving}
                            onClick={() =>
                              void removeCatalogProduct(item.brand, item.product)
                            }
                          >
                            × Quitar
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SettlementsView({ orders }: { orders: Order[] }) {
  const delivered = orders.filter((order) => order.status === "Entregado");
  const collected = delivered.reduce((sum, order) => sum + order.collect, 0);
  const commissions = delivered.reduce(
    (sum, order) => sum + order.commission,
    0,
  );
  return (
    <>
      <PageTitle
        eyebrow="FINANZAS OPERATIVAS"
        title="Rendición y comisiones"
        subtitle="Los movimientos aparecerán cuando existan pedidos entregados."
      />
      <div className="finance-rule">
        <span>!</span>
        <div>
          <b>Regla de caja protegida</b>
          <p>
            Cobrado al cliente = monto a rendir. La comisión se mantiene
            separada.
          </p>
        </div>
      </div>
      <div className="finance-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Rendición</h2>
              <p>Sin movimientos registrados</p>
            </div>
          </div>
          <div className="settlement-total">
            <small>TOTAL A RENDIR</small>
            <strong>{money(collected)}</strong>
            <span>Sin cobros registrados</span>
          </div>
          <button className="primary wide" disabled>
            Conciliar rendición
          </button>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Comisiones</h2>
              <p>Solo pedidos entregados</p>
            </div>
          </div>
          <div className="commission-breakdown">
            <div>
              <span>Comisiones brutas</span>
              <b>{money(commissions)}</b>
            </div>
            <div>
              <span>Adelantos</span>
              <b>{money(0)}</b>
            </div>
            <div>
              <span>Ajustes</span>
              <b>{money(0)}</b>
            </div>
            <div className="total">
              <span>Total a pagar</span>
              <b>{money(commissions)}</b>
            </div>
          </div>
          <button className="secondary wide" disabled>
            Crear liquidación
          </button>
        </article>
      </div>
    </>
  );
}

function CourierView({
  orders,
  setOrders,
  inventory,
  setInventory,
  initialOrderId,
  courierId,
  courierName,
}: {
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  inventory: InventoryStock;
  setInventory: React.Dispatch<React.SetStateAction<InventoryStock>>;
  initialOrderId: string;
  courierId: string;
  courierName: string;
}) {
  const [notice, setNotice] = useState("");
  const [dateFilter, setDateFilter] = useState(currentLimaDate);
  const [districtFilter, setDistrictFilter] = useState("");
  const [distanceOrder, setDistanceOrder] = useState<"near" | "far">("near");
  const [courierTab, setCourierTab] = useState<
    "inicio" | "historial" | "reportes"
  >("inicio");
  const [photos, setPhotos] = useState<Record<string, PhotoView[]>>({});
  const [uploading, setUploading] = useState("");
  const [targetOrderId, setTargetOrderId] = useState(initialOrderId);
  const [gpsDistances, setGpsDistances] = useState<
    Record<string, number | null>
  >({});
  const [contactHistory, setContactHistory] = useState<
    CustomerContactHistoryItem[]
  >([]);
  const [contactProgress, setContactProgress] = useState<
    Record<string, ContactProgress>
  >({});
  const activeStatuses: Order["status"][] = [
    "Pendiente",
    "En ruta",
    "Reprogramado",
  ];

  useEffect(() => {
    let active = true;
    async function verifySession() {
      const response = await fetch("/api/courier-session", { cache: "no-store" });
      if (active && response.status === 401)
        window.location.assign("/acceso-motorizado");
    }
    void verifySession();
    const timer = window.setInterval(() => void verifySession(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void verifySession();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const targetOrder = orders.find((order) => order.id === targetOrderId);
  const activeDateFilter = targetOrder?.deliveryDate || dateFilter;
  const visibleOrders = orders.filter(
    (order) =>
      (!activeDateFilter || order.deliveryDate === activeDateFilter) &&
      (!districtFilter || order.district === districtFilter),
  );
  const assigned = visibleOrders.filter((order) =>
    activeStatuses.includes(order.status),
  );
  const distanceForOrder = (order: Order) =>
    gpsDistances[order.id] ?? getRimacDistance(order.district);
  const orderedAssigned = [...assigned].sort((first, second) =>
    distanceOrder === "near"
      ? distanceForOrder(first) - distanceForOrder(second)
      : distanceForOrder(second) - distanceForOrder(first),
  );
  const delivered = visibleOrders.filter(
    (order) => order.status === "Entregado",
  );
  const historyOrders = visibleOrders.filter(
    (order) =>
      order.status === "Entregado" ||
      order.status === "Cancelado" ||
      order.status === "Devolución" ||
      order.status === "Reprogramado",
  );
  const collected = delivered.reduce((sum, order) => sum + order.collect, 0);
  const targetOrderIsVisible = orderedAssigned.some(
    (order) => order.id === targetOrderId,
  );

  useEffect(() => {
    if (initialOrderId) return;
    const timer = window.setTimeout(() => {
      try {
        const stored = JSON.parse(
          localStorage.getItem(COURIER_RETURN_ORDER_KEY) ?? "null",
        ) as { courierId?: string; orderId?: string; savedAt?: number } | null;
        if (
          stored?.courierId === courierId &&
          stored.orderId &&
          Date.now() - Number(stored.savedAt || 0) < 2 * 60 * 60 * 1000
        ) {
          setTargetOrderId(stored.orderId);
        }
      } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, [courierId, initialOrderId]);

  useEffect(() => {
    if (!targetOrderId || !targetOrderIsVisible) return;
    const timer = window.setTimeout(() => {
      setCourierTab("inicio");
      document
        .getElementById(`courier-order-${targetOrderId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [targetOrderId, targetOrderIsVisible]);

  useEffect(() => {
    let active = true;
    async function loadContactHistory() {
      const events = await getCustomerContactHistory();
      if (active) setContactHistory(events);
    }
    void loadContactHistory();
    const timer = window.setInterval(() => void loadContactHistory(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    function loadPhotos() {
      fetch("/api/photos", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : []))
        .then(
          (
            stored: Array<{
              id: string;
              orderId: string;
              name: string;
              url: string;
            }>,
          ) => {
            if (!active) return;
            const grouped: Record<string, PhotoView[]> = {};
            stored.forEach((photo) => {
              grouped[photo.orderId] ??= [];
              grouped[photo.orderId].push({
                id: photo.id,
                url: photo.url,
                name: photo.name,
              });
            });
            setPhotos(grouped);
          },
        )
        .catch(() => {});
    }
    loadPhotos();
    const refreshPhotosWhenVisible = () => {
      if (document.visibilityState === "visible") loadPhotos();
    };
    const poller = window.setInterval(refreshPhotosWhenVisible, 30_000);
    document.addEventListener("visibilitychange", refreshPhotosWhenVisible);
    return () => {
      active = false;
      window.clearInterval(poller);
      document.removeEventListener("visibilitychange", refreshPhotosWhenVisible);
    };
  }, []);

  useEffect(() => {
    const pendingGpsLinks = orders.filter(
      (order) => order.maps && !(order.id in gpsDistances),
    );
    if (!pendingGpsLinks.length) return;
    let active = true;

    Promise.all(
      pendingGpsLinks.map(async (order) => {
        let coordinates: Coordinates | null = extractMapCoordinates(
          order.maps ?? "",
        );
        if (!coordinates) {
          try {
            const response = await fetch(
              `/api/maps/coordinates?url=${encodeURIComponent(order.maps ?? "")}`,
            );
            const data = (await response.json()) as {
              coordinates?: Coordinates | null;
            };
            coordinates = data.coordinates ?? null;
          } catch {}
        }
        return [
          order.id,
          coordinates ? distanceFromRimac(coordinates) : null,
        ] as const;
      }),
    ).then((entries) => {
      if (!active) return;
      setGpsDistances((current) => ({
        ...current,
        ...Object.fromEntries(entries),
      }));
    });

    return () => {
      active = false;
    };
  }, [orders, gpsDistances]);

  function changeStatus(order: Order, status: Order["status"]) {
    if (
      status === "Entregado" &&
      !window.confirm(
        `¿Confirmas que entregaste el pedido #${order.id} a ${order.client} y cobraste ${money(order.collect)}?`,
      )
    )
      return;
    if (
      (status === "Cancelado" || status === "Devolución") &&
      !window.confirm(
        `¿Confirmas marcar el pedido #${order.id} como ${status.toLowerCase()}?`,
      )
    )
      return;
    let inventoryMessage = "";
    let nextInventory = inventory;
    const shouldDeductInventory =
      status === "Entregado" && !order.inventoryDeducted;
    if (shouldDeductInventory) {
      try {
        const result = deductOrderFromInventory(inventory, order);
        nextInventory = result.inventory;
        setInventory(result.inventory);
        localStorage.setItem(INVENTORY_KEY, JSON.stringify(result.inventory));
        inventoryMessage =
          result.deducted === result.requested
            ? ` Stock actualizado: ${result.deducted} unidad${result.deducted === 1 ? "" : "es"} descontada${result.deducted === 1 ? "" : "s"}.`
            : ` Stock actualizado: se descontaron ${result.deducted} de ${result.requested} unidades; revisa productos sin stock.`;
      } catch {
        inventoryMessage =
          " No se pudo actualizar el stock; revísalo en Inventario.";
      }
    }
    setOrders((current) => {
      const updated = current.map((item) =>
        item.id === order.id
          ? {
              ...item,
              status,
              inventoryDeducted:
                status === "Entregado" ? true : item.inventoryDeducted,
            }
          : item,
      );
      localStorage.setItem(ORDERS_KEY, JSON.stringify(updated));
      const changed = updated.find((item) => item.id === order.id);
      if (changed)
        void mutateCloudState({
          action: "update-order",
          order: changed,
          ...(shouldDeductInventory ? { inventory: nextInventory } : {}),
        }, "courier");
      return updated;
    });
    setNotice(`#${order.id} marcado como ${status}.${inventoryMessage}`);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function reactivateOrder(order: Order) {
    if (
      !window.confirm(
        `¿Deseas reactivar el pedido #${order.id} y devolverlo a pedidos pendientes?`,
      )
    )
      return;
    changeStatus(order, "Pendiente");
  }

  function cancelRoute(order: Order) {
    if (
      !window.confirm(
        `¿Deseas cancelar la ruta del pedido #${order.id} y devolverlo a pendiente?`,
      )
    )
      return;
    changeStatus(order, "Pendiente");
  }

  async function addPhotos(orderId: string, files: FileList | null) {
    if (!files?.length) return;
    setUploading(orderId);
    try {
      const added: PhotoView[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const blob = await compressPhoto(file);
        const id = `${orderId}-${createClientId()}`;
        const form = new FormData();
        form.set("id", id);
        form.set("orderId", orderId);
        form.set(
          "file",
          new File([blob], file.name, { type: blob.type || "image/jpeg" }),
        );
        const response = await fetch("/api/photos", {
          method: "POST",
          body: form,
        });
        const saved = (await response.json()) as PhotoView & { error?: string };
        if (!response.ok)
          throw new Error(saved.error || "No se pudo subir la foto.");
        added.push(saved);
      }
      setPhotos((current) => ({
        ...current,
        [orderId]: [...(current[orderId] ?? []), ...added],
      }));
      setNotice(
        `${added.length} foto${added.length === 1 ? "" : "s"} guardada${added.length === 1 ? "" : "s"} en #${orderId}.`,
      );
      window.setTimeout(() => setNotice(""), 2600);
    } catch {
      setNotice("No se pudo guardar la fotografía. Inténtalo nuevamente.");
      window.setTimeout(() => setNotice(""), 3000);
    } finally {
      setUploading("");
    }
  }

  async function deletePhoto(orderId: string, photo: PhotoView) {
    if (!window.confirm("¿Deseas eliminar esta fotografía?")) return;
    const response = await fetch(
      `/api/photos?id=${encodeURIComponent(photo.id)}`,
      { method: "DELETE" },
    );
    if (!response.ok) return setNotice("No se pudo eliminar la fotografía.");
    setPhotos((current) => ({
      ...current,
      [orderId]: (current[orderId] ?? []).filter(
        (item) => item.id !== photo.id,
      ),
    }));
  }

  function contactLinks(order: Order) {
    const digits = normalizePeruvianPhone(order.phone ?? "") ?? "";
    return { digits };
  }

  function updateContactProgress(orderId: string, progress: ContactProgress) {
    setContactProgress((current) => ({ ...current, [orderId]: progress }));
  }

  function rememberContactResult(result: CustomerContactResult) {
    setContactHistory((current) => [
      {
        id: result.eventId,
        order_id: result.orderId,
        event_type: result.eventType,
        status: "opened_whatsapp",
        eta_start: result.etaStart ?? null,
        eta_end: result.etaEnd ?? null,
        route_provider: result.provider ?? null,
        forced: Boolean(result.forced),
        created_at: result.preparedAt,
      },
      ...current.filter((item) => item.id !== result.eventId),
    ]);
  }

  function prepareWhatsAppWindow(orderId: string) {
    setTargetOrderId(orderId);
    try {
      localStorage.setItem(
        COURIER_RETURN_ORDER_KEY,
        JSON.stringify({ courierId, orderId, savedAt: Date.now() }),
      );
      const returnUrl = new URL(window.location.href);
      returnUrl.pathname = "/motorizado";
      returnUrl.search = "";
      returnUrl.searchParams.set("order", orderId);
      window.history.replaceState(window.history.state, "", returnUrl);
    } catch {}
    const isMobileDevice =
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isMobileDevice) return null;
    const whatsappWindow = window.open("", "_blank");
    if (whatsappWindow) {
      whatsappWindow.opener = null;
      try {
        whatsappWindow.document.title = "Preparando WhatsApp";
        whatsappWindow.document.body.innerHTML =
          '<main style="font-family:system-ui;padding:32px;text-align:center"><b>Preparando mensaje de WhatsApp…</b><p style="color:#65756c">Puedes volver a P‑Delivery si esta ventana no avanza.</p></main>';
      } catch {}
    }
    return whatsappWindow;
  }

  function nativeWhatsAppUrl(webUrl: string) {
    try {
      const parsed = new URL(webUrl);
      const phone = parsed.pathname.replace(/\D/g, "");
      const text = parsed.searchParams.get("text") ?? "";
      return `whatsapp://send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}`;
    } catch {
      return webUrl;
    }
  }

  function openPreparedWhatsApp(
    result: CustomerContactResult,
    whatsappWindow: Window | null,
  ) {
    rememberContactResult(result);
    updateContactProgress(result.orderId, {
      label: result.isMock ? "ETA de prueba preparada" : "WhatsApp abierto",
      kind: result.eventType === "morning_notice" ? "morning" : "next",
    });
    void markCustomerContactOpened(result.eventId);
    if (whatsappWindow && !whatsappWindow.closed) {
      whatsappWindow.location.replace(result.whatsappUrl);
      return;
    }
    window.location.assign(nativeWhatsAppUrl(result.whatsappUrl));
  }

  async function prepareMorningNotice(order: Order) {
    if (contactProgress[order.id]?.busy) return;
    const whatsappWindow = prepareWhatsAppWindow(order.id);
    updateContactProgress(order.id, {
      label: "Abriendo WhatsApp…",
      busy: true,
      kind: "morning",
    });
    try {
      const result = await registerCustomerNotification({
        orderId: order.id,
        courierName,
      });
      openPreparedWhatsApp(result, whatsappWindow);
    } catch (error) {
      whatsappWindow?.close();
      updateContactProgress(order.id, {
        label:
          error instanceof Error
            ? error.message
            : "No se pudo preparar el aviso.",
        error: true,
        kind: "morning",
      });
    }
  }

  async function prepareNextDeliveryNotice(
    order: Order,
    isNextStop: boolean,
    options: { useLastLocation?: boolean } = {},
  ) {
    if (contactProgress[order.id]?.busy) return;
    const forced = !isNextStop;
    if (
      forced &&
      !window.confirm(
        "Este pedido todavía no aparece como la próxima parada. ¿Deseas avisar igualmente?",
      )
    )
      return;
    const whatsappWindow = prepareWhatsAppWindow(order.id);
    try {
      let location;
      let allowLowAccuracy = false;
      if (!options.useLastLocation) {
        updateContactProgress(order.id, {
          label: "Obteniendo ubicación…",
          busy: true,
          kind: "next",
        });
        location = await getCurrentCourierLocation();
        if (location.accuracy > 100) {
          allowLowAccuracy = window.confirm(
            "La ubicación tiene baja precisión. ¿Deseas continuar con esta estimación?",
          );
          if (!allowLowAccuracy) {
            whatsappWindow?.close();
            updateContactProgress(order.id, {
              label: "Ubicación imprecisa. Intenta nuevamente.",
              error: true,
              canUseLastLocation: true,
              kind: "next",
            });
            return;
          }
        }
      }
      updateContactProgress(order.id, {
        label: "Calculando llegada…",
        busy: true,
        kind: "next",
      });
      const result = await calculateTravelDuration({
        orderId: order.id,
        location,
        forced,
        useLastLocation: Boolean(options.useLastLocation),
        allowLowAccuracy,
        courierName,
      });
      if (result.usedPreviousLocation) {
        updateContactProgress(order.id, {
          label: `Usando ubicación registrada hace ${result.previousLocationAgeMinutes ?? 0} minutos.`,
          busy: true,
          kind: "next",
        });
      }
      openPreparedWhatsApp(result, whatsappWindow);
    } catch (error) {
      whatsappWindow?.close();
      const message = error instanceof Error ? error.message : "No se pudo calcular la llegada.";
      const gpsCode = error instanceof Error ? error.message : "";
      const permissionDenied = gpsCode === "GPS_PERMISSION_DENIED";
      const timeout = gpsCode === "GPS_TIMEOUT";
      const unavailable = gpsCode === "GPS_UNAVAILABLE";
      updateContactProgress(order.id, {
        label: permissionDenied
          ? "No tienes permiso de ubicación. Actívalo para calcular el tiempo de llegada."
          : timeout
            ? "No pudimos obtener tu ubicación. Intenta nuevamente."
            : unavailable
              ? "No se pudo obtener tu ubicación actual."
              : message,
        error: true,
        permissionHelp: permissionDenied,
        canUseLastLocation: timeout || unavailable,
        kind: "next",
      });
    }
  }

  function displayContactTime(value: string) {
    return new Date(value).toLocaleTimeString("es-PE", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  function displayDate(value?: string) {
    if (!value) return "Sin fecha";
    return new Date(`${value}T12:00:00`).toLocaleDateString("es-PE", {
      day: "2-digit",
      month: "short",
    });
  }

  async function logoutCourier() {
    try {
      localStorage.removeItem(COURIER_RETURN_ORDER_KEY);
    } catch {}
    await unlinkPushDevice("courier").catch(() => undefined);
    await fetch("/api/courier-logout", { method: "POST" });
    window.location.assign("/");
  }

  return (
    <div className="courier-app">
      <header>
        <div className="courier-header-brand">
          <BrandLogo brand="general" priority />
          <div>
            <small>CONTROL DE ENTREGAS</small>
            <h1>Panel del motorizado</h1>
            <span className="courier-signed-user" data-courier-id={courierId}>
              {courierName}
            </span>
          </div>
        </div>
        <div className="courier-header-actions">
          <NotificationCenter audience="courier" />
          <Link className="courier-back" href="/">
            ← Inicio
          </Link>
          <button
            className="courier-logout-button"
            type="button"
            onClick={() => void logoutCourier()}
          >
            Cerrar sesión
          </button>
        </div>
      </header>
      {courierTab !== "reportes" && (
        <div className="courier-filter-group">
          <label className="courier-date-filter">
            <span>Filtrar pedidos por fecha</span>
            <DateInput
              value={activeDateFilter}
              onChange={(e) => {
                setTargetOrderId("");
                setDateFilter(e.target.value);
              }}
            />
            {activeDateFilter && (
              <button
                type="button"
                  onClick={() => {
                    setTargetOrderId("");
                    setDateFilter("");
                  }}
                aria-label="Quitar filtro de fecha"
              >
                ×
              </button>
            )}
          </label>
          <label className="courier-district-filter">
            <span>Filtrar por distrito</span>
            <select
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              aria-label="Filtrar pedidos por distrito"
            >
              <option value="">Todos los distritos</option>
              {LIMA_DISTRICTS.map((district) => (
                <option key={district} value={district}>
                  {district}
                </option>
              ))}
            </select>
          </label>
          <label className="courier-sort-filter">
            <span>Orden por distancia desde Rímac</span>
            <select
              value={distanceOrder}
              onChange={(event) =>
                setDistanceOrder(event.target.value as "near" | "far")
              }
              aria-label="Ordenar pedidos por distancia"
            >
              <option value="near">Más cercanos</option>
              <option value="far">Más lejanos</option>
            </select>
          </label>
        </div>
      )}
      {courierTab === "inicio" && (
        <div className="courier-summary">
          <article>
            <small>ENTREGAS PENDIENTES</small>
            <strong>{assigned.length}</strong>
          </article>
          <article>
            <small>COMPLETADAS</small>
            <strong>{delivered.length}</strong>
          </article>
          <article>
            <small>RECAUDADO</small>
            <strong>{money(collected)}</strong>
          </article>
        </div>
      )}
      {courierTab === "inicio" &&
        (assigned.length ? (
          <div className="courier-order-list">
            {orderedAssigned.map((order, index) => {
              const contact = contactLinks(order);
              const orderContactEvents = contactHistory.filter(
                (item) => item.order_id === order.id,
              );
              const morningEvent = orderContactEvents.find(
                (item) => item.event_type === "morning_notice",
              );
              const nextDeliveryEvent = orderContactEvents.find(
                (item) => item.event_type === "next_delivery_notice",
              );
              const contactStatus = contactProgress[order.id];
              const contactBusy = Boolean(contactStatus?.busy);
              return (
                <details
                  id={`courier-order-${order.id}`}
                  className={`next-stop courier-order-card${order.status === "En ruta" ? " is-en-ruta" : ""}`}
                  key={order.id}
                  open={order.id === targetOrderId || index === 0}
                >
                  <summary>
                    <div className="courier-card-summary">
                      <div>
                        <span
                          className={`brand-badge ${order.brand.toLowerCase()}`}
                        >
                          {order.brand}
                        </span>
                        <span
                          className={`courier-status-chip ${order.status.toLowerCase().replace(" ", "-")}`}
                        >
                          {order.status}
                        </span>
                      </div>
                      <b>#{order.id}</b>
                      <h2>{order.client}</h2>
                      <p>
                        {order.district} · {distanceForOrder(order)} km{" "}
                        {gpsDistances[order.id] != null
                          ? "GPS aprox."
                          : "distrito aprox."}{" "}
                        · {displayDate(order.deliveryDate)}
                      </p>
                    </div>
                    <span className="courier-chevron">⌄</span>
                  </summary>
                  <div className="courier-card-detail">
                    <div className="courier-detail-heading">
                      <small>
                        {index === 0 ? "PRÓXIMA ENTREGA" : `ENTREGA ${index + 1}`}
                      </small>
                      <button
                        type="button"
                        className="courier-label-download"
                        onClick={() => void downloadOrderLabel(order)}
                        aria-label={`Descargar rótulo del pedido ${order.id}`}
                      >
                        <span aria-hidden="true">↓</span>
                        Descargar rótulo
                      </button>
                    </div>
                    <h3>● {order.address}</h3>
                    <p>{order.district}</p>
                    <OrderProducts products={order.products} />
                    <div className="collect-box">
                      <div>
                        <small>COBRAR AL CLIENTE</small>
                        <strong>{money(order.collect)}</strong>
                      </div>
                      <div>
                        <small>MÉTODO DE PAGO</small>
                        <b>{order.payment}</b>
                      </div>
                    </div>
                    <div className="courier-contact-actions">
                      {contact.digits ? (
                        <a className="courier-call-action" href={`tel:+${contact.digits}`}>
                          <b>☎</b>
                          <span>Llamar</span>
                        </a>
                      ) : (
                        <span className="disabled">
                          <b>☎</b>
                          <span>Sin teléfono</span>
                        </span>
                      )}
                      {order.maps ? (
                        <a
                          className="courier-maps-action"
                          href={order.maps}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <b>⌖</b>
                          <span>Maps</span>
                        </a>
                      ) : (
                        <span className="disabled courier-maps-action">
                          <b>⌖</b>
                          <span>Sin mapa</span>
                        </span>
                      )}
                      {contact.digits ? (
                        <button
                          className="whatsapp-action morning-notice-action"
                          type="button"
                          disabled={contactBusy}
                          onClick={() => void prepareMorningNotice(order)}
                        >
                          <Image
                            className="whatsapp-action-icon"
                            src="/whatsapp-icon.png"
                            width={24}
                            height={24}
                            alt=""
                          />
                          <span>
                            {contactStatus?.busy && contactStatus.kind === "morning"
                              ? contactStatus.label
                              : "Avisar pedido"}
                          </span>
                        </button>
                      ) : (
                        <span className="disabled whatsapp-action">
                          <Image
                            className="whatsapp-action-icon"
                            src="/whatsapp-icon.png"
                            width={24}
                            height={24}
                            alt=""
                          />
                          <span>Aviso no disponible</span>
                        </span>
                      )}
                      {contact.digits && order.maps ? (
                        <button
                          className="whatsapp-action next-delivery-action"
                          type="button"
                          disabled={contactBusy}
                          onClick={() =>
                            void prepareNextDeliveryNotice(order, index === 0)
                          }
                        >
                          <Image
                            className="whatsapp-action-icon"
                            src="/whatsapp-icon.png"
                            width={24}
                            height={24}
                            alt=""
                          />
                          <span>
                            {contactStatus?.busy && contactStatus.kind === "next"
                              ? contactStatus.label
                              : "Próxima entrega"}
                          </span>
                        </button>
                      ) : (
                        <span className="disabled whatsapp-action next-delivery-action">
                          <Image
                            className="whatsapp-action-icon"
                            src="/whatsapp-icon.png"
                            width={24}
                            height={24}
                            alt=""
                          />
                          <span>ETA no disponible</span>
                        </span>
                      )}
                    </div>
                    <small className="contact-location-explainer">
                      Próxima entrega usa tu ubicación actual solo para calcular el rango de llegada.
                    </small>
                    {(morningEvent || nextDeliveryEvent || contactStatus) && (
                      <div className="customer-contact-summary" aria-live="polite">
                        {morningEvent && (
                          <span>
                            Aviso inicial: {displayContactTime(morningEvent.created_at)}
                          </span>
                        )}
                        {nextDeliveryEvent && (
                          <span>
                            Próxima entrega: {displayContactTime(nextDeliveryEvent.created_at)}
                          </span>
                        )}
                        {nextDeliveryEvent?.eta_start && nextDeliveryEvent.eta_end && (
                          <span>
                            ETA informada: {displayContactTime(nextDeliveryEvent.eta_start)}–
                            {displayContactTime(nextDeliveryEvent.eta_end)}
                            {nextDeliveryEvent.route_provider === "mock" ? " · prueba" : ""}
                          </span>
                        )}
                        {contactStatus && !contactStatus.busy && (
                          <p className={contactStatus.error ? "error" : ""}>
                            {contactStatus.label}
                          </p>
                        )}
                        {contactStatus?.permissionHelp && (
                          <button
                            type="button"
                            onClick={() =>
                              void prepareNextDeliveryNotice(order, index === 0)
                            }
                          >
                            Revisar permisos
                          </button>
                        )}
                        {contactStatus?.canUseLastLocation && (
                          <button
                            type="button"
                            onClick={() =>
                              void prepareNextDeliveryNotice(order, index === 0, {
                                useLastLocation: true,
                              })
                            }
                          >
                            Usar última ubicación válida
                          </button>
                        )}
                      </div>
                    )}
                    <PhotoEvidence
                      order={order}
                      photos={photos[order.id] ?? []}
                      uploading={uploading === order.id}
                      onAdd={(files) => {
                        void addPhotos(order.id, files);
                      }}
                      onDelete={(photo) => {
                        void deletePhoto(order.id, photo);
                      }}
                    />
                    <div className="courier-status-actions">
                      {order.status !== "En ruta" ? (
                        <button
                          className="route-start"
                          onClick={() => changeStatus(order, "En ruta")}
                        >
                          ▶ En ruta
                        </button>
                      ) : (
                        <button
                          className="route-cancel"
                          onClick={() => cancelRoute(order)}
                        >
                          ↶ Cancelar ruta
                        </button>
                      )}
                      <button
                        className="delivered"
                        onClick={() => changeStatus(order, "Entregado")}
                      >
                        ✓ Marcar entregado
                      </button>
                      <button
                        onClick={() => changeStatus(order, "Reprogramado")}
                      >
                        ↻ Reprogramar
                      </button>
                      <button onClick={() => changeStatus(order, "Devolución")}>
                        ↩ Devolución
                      </button>
                      <button
                        className="cancel"
                        onClick={() => changeStatus(order, "Cancelado")}
                      >
                        × Cancelar
                      </button>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <section className="next-stop courier-empty">
            <EmptyState
              icon="▣"
              title="No hay pedidos con estos filtros"
              text={
                dateFilter || districtFilter
                  ? "Prueba otra fecha, distrito o elimina los filtros."
                  : "Los pedidos creados por Administración aparecerán aquí automáticamente."
              }
            />
          </section>
        ))}
      {courierTab === "historial" &&
        (historyOrders.length ? (
          <section className="courier-history courier-history-page">
            <div className="courier-section-title">
              <span>HISTORIAL</span>
              <h2>Todos los pedidos procesados</h2>
            </div>
            {historyOrders.map((order) => (
              <div key={order.id}>
                <span className={`brand-badge ${order.brand.toLowerCase()}`}>
                  {order.brand}
                </span>
                <b>
                  #{order.id} · {order.client}
                </b>
                <small
                  className={`courier-history-status ${order.status.toLowerCase()}`}
                >
                  {order.status}
                </small>
                {(order.status === "Cancelado" ||
                  order.status === "Devolución" ||
                  order.status === "Reprogramado") && (
                  <button
                    className="reactivate-order"
                    type="button"
                    onClick={() => reactivateOrder(order)}
                  >
                    ↻ Reactivar
                  </button>
                )}
              </div>
            ))}
          </section>
        ) : (
          <section className="next-stop courier-empty">
            <EmptyState
              icon="◷"
              title="Aún no hay historial"
              text="Los pedidos entregados, reprogramados, cancelados o devueltos aparecerán aquí."
            />
          </section>
        ))}
      {courierTab === "reportes" && <CourierReports orders={orders} />}
      {notice && (
        <div className="courier-toast" role="status">
          ✓ {notice}
        </div>
      )}
      <nav className="courier-nav">
        <button
          className={courierTab === "inicio" ? "active" : ""}
          onClick={() => setCourierTab("inicio")}
        >
          ⌂<span>Inicio</span>
        </button>
        <button
          className={courierTab === "historial" ? "active" : ""}
          onClick={() => setCourierTab("historial")}
        >
          ◷<span>Historial</span>
        </button>
        <button
          className={courierTab === "reportes" ? "active" : ""}
          onClick={() => setCourierTab("reportes")}
        >
          ⇩<span>Reportes</span>
        </button>
      </nav>
    </div>
  );
}

function CourierReports({ orders }: { orders: Order[] }) {
  const [mode, setMode] = useState<"exacta" | "rango">("exacta");
  const [exactDate, setExactDate] = useState(currentLimaDate);
  const [fromDate, setFromDate] = useState(currentLimaDate);
  const [toDate, setToDate] = useState(currentLimaDate);
  const historyStatuses: Order["status"][] = [
    "Entregado",
    "Reprogramado",
    "Cancelado",
    "Devolución",
  ];
  const dateReady =
    mode === "exacta" ? Boolean(exactDate) : Boolean(fromDate && toDate);
  const reportOrders = orders.filter(
    (order) =>
      historyStatuses.includes(order.status) &&
      Boolean(order.deliveryDate) &&
      (mode === "exacta"
        ? order.deliveryDate === exactDate
        : Boolean(
            fromDate &&
            toDate &&
            order.deliveryDate! >= fromDate &&
            order.deliveryDate! <= toDate,
          )),
  );
  const deliveredCount = reportOrders.filter(
    (order) => order.status === "Entregado",
  ).length;
  const collected = reportOrders
    .filter((order) => order.status === "Entregado")
    .reduce((total, order) => total + order.collect, 0);
  const periodLabel = mode === "exacta" ? exactDate : `${fromDate}_a_${toDate}`;

  return (
    <section className="courier-reports">
      <div className="courier-section-title">
        <span>REPORTES</span>
        <h2>Histórico del motorizado</h2>
        <p>Consulta tus pedidos procesados y descárgalos en Excel.</p>
      </div>
      <div className="courier-report-controls">
        <div className="courier-report-mode">
          <button
            type="button"
            className={mode === "exacta" ? "active" : ""}
            onClick={() => setMode("exacta")}
          >
            Fecha exacta
          </button>
          <button
            type="button"
            className={mode === "rango" ? "active" : ""}
            onClick={() => setMode("rango")}
          >
            Rango de fechas
          </button>
        </div>
        {mode === "exacta" ? (
          <label>
            <span>Fecha del reporte</span>
            <DateInput
              value={exactDate}
              onChange={(event) => setExactDate(event.target.value)}
            />
          </label>
        ) : (
          <div className="courier-report-range">
            <label>
              <span>Desde</span>
              <DateInput
                value={fromDate}
                max={toDate || undefined}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label>
              <span>Hasta</span>
              <DateInput
                value={toDate}
                min={fromDate || undefined}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
          </div>
        )}
        <button
          className="courier-download-excel"
          type="button"
          disabled={!dateReady || !reportOrders.length}
          onClick={() =>
            void downloadOrdersReport(reportOrders, `motorizado_${periodLabel}`)
          }
        >
          ⇩ Descargar Excel
        </button>
      </div>
      {dateReady && (
        <div className="courier-report-summary">
          <article>
            <small>PROCESADOS</small>
            <strong>{reportOrders.length}</strong>
          </article>
          <article>
            <small>ENTREGADOS</small>
            <strong>{deliveredCount}</strong>
          </article>
          <article>
            <small>RECAUDADO</small>
            <strong>{money(collected)}</strong>
          </article>
        </div>
      )}
      {!dateReady ? (
        <section className="next-stop courier-empty">
          <EmptyState
            icon="◷"
            title="Selecciona una fecha"
            text="Elige una fecha exacta o completa el rango para generar el reporte."
          />
        </section>
      ) : reportOrders.length ? (
        <div className="courier-report-list">
          {reportOrders.map((order) => (
            <article key={order.id}>
              <div>
                <span className={`brand-badge ${order.brand.toLowerCase()}`}>
                  {order.brand}
                </span>
                <small>{order.deliveryDate}</small>
              </div>
              <strong>
                #{order.id} · {order.client}
              </strong>
              <p>
                {order.district} · {order.address}
              </p>
              <div>
                <span
                  className={`courier-history-status ${order.status.toLowerCase()}`}
                >
                  {order.status}
                </span>
                <b>{money(order.collect)}</b>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="next-stop courier-empty">
          <EmptyState
            icon="▣"
            title="Sin registros en este periodo"
            text="Prueba otra fecha o amplía el rango seleccionado."
          />
        </section>
      )}
    </section>
  );
}

function OrderProducts({ products }: { products?: OrderProduct[] }) {
  if (!products?.length) return null;
  return (
    <div className="courier-products">
      <small>PRODUCTOS DEL PEDIDO</small>
      {products.map((product) => (
        <div key={product.name}>
          <b>{product.quantity}</b>
          <span>{product.name}</span>
        </div>
      ))}
    </div>
  );
}

function PhotoEvidence({
  order,
  photos,
  uploading,
  onAdd,
  onDelete,
}: {
  order: Order;
  photos: PhotoView[];
  uploading: boolean;
  onAdd: (files: FileList | null) => void;
  onDelete: (photo: PhotoView) => void;
}) {
  return (
    <div className="courier-photo-section">
      <div className="courier-photo-heading">
        <div>
          <b>Evidencia fotográfica</b>
          <small>
            {photos.length} foto{photos.length === 1 ? "" : "s"}
          </small>
        </div>
        <label className={uploading ? "uploading" : ""}>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={uploading}
            onChange={(event) => {
              onAdd(event.target.files);
              event.target.value = "";
            }}
          />
          <span>{uploading ? "Guardando…" : "＋ Tomar o subir"}</span>
        </label>
      </div>
      {photos.length > 0 && (
        <div className="courier-photo-grid">
          {photos.map((photo) => (
            <figure key={photo.id}>
              <a
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Abrir ${photo.name}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- URL local generada desde IndexedDB */}
                <img src={photo.url} alt={`Evidencia del pedido ${order.id}`} />
              </a>
              <button
                type="button"
                onClick={() => onDelete(photo)}
                aria-label="Eliminar fotografía"
              >
                ×
              </button>
            </figure>
          ))}
        </div>
      )}
      <small className="courier-photo-note">
        Puedes usar la cámara o elegir varias imágenes de la galería.
      </small>
    </div>
  );
}

function AdminPhotoEvidence({
  order,
  compact = false,
}: {
  order: Order;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function toggleEvidence() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/photos?orderId=${encodeURIComponent(order.id)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("No se pudo consultar la evidencia.");
      const result = (await response.json()) as Array<
        PhotoView & { orderId?: string }
      >;
      setPhotos(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar las fotografías.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`admin-photo-evidence${compact ? " compact" : ""}`}>
      <button
        className="admin-photo-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={`evidence-${order.id}`}
        onClick={() => void toggleEvidence()}
      >
        <span aria-hidden="true">📷</span>
        {open ? "Ocultar fotos" : "Ver fotos de entrega"}
        {photos.length > 0 && <b>{photos.length}</b>}
      </button>
      {open && (
        <section
          className="admin-photo-panel"
          id={`evidence-${order.id}`}
          aria-label={`Evidencia fotográfica del pedido ${order.id}`}
        >
          {loading ? (
            <p>Cargando fotografías…</p>
          ) : error ? (
            <p className="admin-photo-error">{error}</p>
          ) : photos.length ? (
            <div className="admin-photo-grid">
              {photos.map((photo) => (
                <a
                  href={photo.url}
                  target="_blank"
                  rel="noreferrer"
                  key={photo.id}
                  aria-label={`Abrir ${photo.name}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagen privada servida por un endpoint autenticado */}
                  <img
                    src={photo.url}
                    alt={`Evidencia del pedido ${order.id}`}
                    loading="lazy"
                  />
                  <small>{photo.name}</small>
                </a>
              ))}
            </div>
          ) : (
            <p>Este pedido todavía no tiene fotos de entrega.</p>
          )}
        </section>
      )}
    </div>
  );
}
