"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { AdminAccess } from "../../../LogisticsApp";
import { LIMA_DISTRICTS } from "../../../districts";
import {
  normalizedProductCatalog,
  type ProductCatalog,
} from "../../../products";
import { createClientId } from "../../../clientId";
import { mutateCloudState, readCloudState } from "../../../cloudData";
import { DateInput } from "../../../DateInput";
import { BrandLogo } from "../../../BrandLogo";
import { currentLimaDate } from "../../../limaDate";

const ORDERS_KEY = "suyai-orders-v2";

type Draft = {
  brand: "Suyai" | "Aura";
  warehouse: string;
  client: string;
  phone: string;
  district: string;
  address: string;
  reference: string;
  maps: string;
  deliveryDate: string;
  assignedCourierId: string;
  assignedCourierName: string;
  payment: string;
  collect: string;
  commission: string;
  notes: string;
  productRows: { product: string; quantity: string }[];
};

const emptyDraft: Draft = {
  brand: "Suyai",
  warehouse: "Rímac",
  client: "",
  phone: "",
  district: "",
  address: "",
  reference: "",
  maps: "",
  deliveryDate: currentLimaDate(),
  assignedCourierId: "",
  assignedCourierName: "",
  payment: "Efectivo",
  collect: "",
  commission: "",
  notes: "",
  productRows: [{ product: "", quantity: "" }],
};

type AssignableCourier = { id: string; full_name: string };
type EditableOrder = {
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
  reference?: string;
  deliveryDate?: string;
  assignedCourierId?: string;
  assignedCourierName?: string;
  notes?: string;
  products?: Array<{ name: string; quantity: number }>;
  inventoryDeducted?: boolean;
};

function draftFromOrder(order: EditableOrder): Draft {
  return {
    brand: order.brand,
    warehouse: order.warehouse || "Rímac",
    client: order.client || "",
    phone: order.phone || "",
    district: order.district || "",
    address: order.address || "",
    reference: order.reference || "",
    maps: order.maps || "",
    deliveryDate: order.deliveryDate || currentLimaDate(),
    assignedCourierId: order.assignedCourierId || "",
    assignedCourierName: order.assignedCourierName || "",
    payment: order.payment || "Efectivo",
    collect: String(order.collect ?? ""),
    commission: String(order.commission ?? ""),
    notes: order.notes || "",
    productRows: order.products?.length
      ? order.products.map((product) => ({
          product: product.name,
          quantity: String(product.quantity),
        }))
      : [{ product: "", quantity: "" }],
  };
}

export default function NewOrderForm({
  initialAccess,
  editOrderId = "",
}: {
  initialAccess: AdminAccess;
  editOrderId?: string;
}) {
  const isEditing = Boolean(editOrderId);
  const draftKey = `suyai-order-draft-v2-${initialAccess}${editOrderId ? `-edit-${editOrderId}` : ""}`;
  const initialBrand: Draft["brand"] =
    initialAccess === "aura" ? "Aura" : "Suyai";
  const [draft, setDraft] = useState<Draft>({
    ...emptyDraft,
    brand: initialBrand,
  });
  const [ready, setReady] = useState(false);
  const [editingOrder, setEditingOrder] = useState<EditableOrder | null>(null);
  const [loadError, setLoadError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [openProductIndex, setOpenProductIndex] = useState<number | null>(null);
  const [productCatalog, setProductCatalog] = useState<ProductCatalog>(() =>
    normalizedProductCatalog(),
  );
  const [couriers, setCouriers] = useState<AssignableCourier[]>([]);
  const [courierLoadError, setCourierLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const selectedProducts = draft.productRows
    .map((row) => ({
      name: row.product.trim(),
      quantity: Number(row.quantity),
    }))
    .filter((product) => product.name && product.quantity > 0);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      async function loadInitialDraft() {
        try {
          localStorage.removeItem("suyai-new-order-draft");
          localStorage.removeItem("suyai-created-orders");
          if (editOrderId) {
            const cloud = await readCloudState<EditableOrder>();
            const order = cloud.orders.find((item) => item.id === editOrderId);
            if (!order) throw new Error("No se encontró el pedido o no tienes acceso para editarlo.");
            if (!active) return;
            setEditingOrder(order);
            const saved = localStorage.getItem(draftKey);
            setDraft(
              saved
                ? { ...draftFromOrder(order), ...(JSON.parse(saved) as Partial<Draft>) }
                : draftFromOrder(order),
            );
          } else {
            const saved = localStorage.getItem(draftKey);
            if (saved) {
              const parsed = JSON.parse(saved) as Partial<Draft>;
              const today = currentLimaDate();
              const savedDeliveryDate = parsed.deliveryDate || today;
              setDraft({
                ...emptyDraft,
                ...parsed,
                // A protected draft may survive for several days. Do not let an
                // old date silently create a historical order when it is resumed.
                deliveryDate:
                  savedDeliveryDate < today ? today : savedDeliveryDate,
              });
            }
          }
        } catch (error) {
          if (active)
            setLoadError(
              error instanceof Error ? error.message : "No se pudo cargar el pedido.",
            );
        } finally {
          if (active) setReady(true);
        }
      }
      void loadInitialDraft();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draftKey, editOrderId]);

  useEffect(() => {
    let active = true;
    void readCloudState()
      .then((cloud) => {
        if (active)
          setProductCatalog(normalizedProductCatalog(cloud.productCatalog));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/couriers/assignable", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar motorizados");
        return response.json() as Promise<{ users?: AssignableCourier[] }>;
      })
      .then((result) => {
        if (active) {
          setCouriers(result.users ?? []);
          setCourierLoadError(false);
        }
      })
      .catch(() => {
        if (active) {
          setCouriers([]);
          setCourierLoadError(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(draftKey, JSON.stringify(draft));
      setSavedAt(
        new Date().toLocaleTimeString("es-PE", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, ready, draftKey]);

  function update<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateProductRow(
    index: number,
    field: "product" | "quantity",
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      productRows: current.productRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    }));
  }

  function addProductRow() {
    setDraft((current) => ({
      ...current,
      productRows: [...current.productRows, { product: "", quantity: "" }],
    }));
    setOpenProductIndex(draft.productRows.length);
  }

  function removeProductRow(index: number) {
    setDraft((current) => ({
      ...current,
      productRows:
        current.productRows.length === 1
          ? [{ product: "", quantity: "" }]
          : current.productRows.filter((_, rowIndex) => rowIndex !== index),
    }));
    setOpenProductIndex(null);
  }

  function selectProduct(index: number, product: string) {
    updateProductRow(index, "product", product);
    setOpenProductIndex(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const incompleteProduct = draft.productRows.some(
      (row) =>
        (row.product.trim() && !Number(row.quantity)) ||
        (!row.product.trim() && Number(row.quantity)),
    );
    if (incompleteProduct) {
      window.alert(
        "Completa el nombre y la cantidad de cada producto agregado.",
      );
      return;
    }
    if (!selectedProducts.length) {
      window.alert(
        "Selecciona al menos un producto y una cantidad antes de continuar.",
      );
      return;
    }
    setConfirming(true);
  }

  async function createOrder() {
    if (creating) return;
    setCreating(true);
    const order = {
      ...(editingOrder ?? {}),
      id:
        editingOrder?.id ??
        `${draft.brand === "Suyai" ? "SY" : "AU"}-${createClientId().slice(0, 6).toUpperCase()}`,
      brand: draft.brand,
      client: draft.client,
      district: draft.district,
      warehouse: draft.warehouse,
      collect: Number(draft.collect),
      commission: Number(draft.commission),
      status: editingOrder?.status ?? "Pendiente",
      address: draft.address,
      payment: draft.payment,
      maps: draft.maps,
      phone: draft.phone,
      reference: draft.reference,
      deliveryDate: draft.deliveryDate,
      assignedCourierId: draft.assignedCourierId,
      assignedCourierName: draft.assignedCourierName,
      notes: draft.notes,
      products: selectedProducts,
    };
    try {
      await mutateCloudState({
        action: isEditing ? "update-order" : "create-order",
        order,
      });
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : `No se pudo ${isEditing ? "actualizar" : "crear"} el pedido. Revisa tu conexión e intenta nuevamente.`,
      );
      setCreating(false);
      return;
    }
    try {
      const existing = JSON.parse(
        localStorage.getItem(ORDERS_KEY) ?? "[]",
      ) as EditableOrder[];
      const nextOrders = isEditing
        ? existing.some((item) => item.id === order.id)
          ? existing.map((item) => (item.id === order.id ? order : item))
          : [order, ...existing]
        : [order, ...existing];
      localStorage.setItem(ORDERS_KEY, JSON.stringify(nextOrders));
      localStorage.removeItem(draftKey);
    } catch {}
    const dashboardDate = encodeURIComponent(
      order.deliveryDate || currentLimaDate(),
    );
    window.location.assign(
      `/admin?access=${initialAccess}&date=${dashboardDate}`,
    );
  }

  function clearDraft() {
    if (
      !window.confirm(
        isEditing
          ? "¿Deseas descartar los cambios y restaurar los datos guardados del pedido?"
          : "¿Deseas borrar todos los datos de este borrador?",
      )
    )
      return;
    localStorage.removeItem(draftKey);
    setDraft(
      editingOrder
        ? draftFromOrder(editingOrder)
        : { ...emptyDraft, brand: initialBrand },
    );
  }

  return (
    <main className={`new-order-page access-theme-${initialAccess}`}>
      <header className="new-order-header">
        <Link className="brand-lockup" href="/">
          <BrandLogo
            brand={initialAccess === "superadmin" ? "general" : initialAccess}
            priority
          />
          <span>
            <strong>
              {initialAccess === "superadmin"
                ? "Superadmin"
                : initialAccess === "aura"
                  ? "Aura"
                  : "Suyai"}
            </strong>
            <small>Logistics OS</small>
          </span>
        </Link>
        <Link className="back-admin" href={`/admin?access=${initialAccess}`}>
          ← Volver a Administración
        </Link>
      </header>

      <form className="order-page-form" onSubmit={submit}>
        <div className="order-page-title">
          <div>
            <span className="eyebrow">
              {isEditing ? `PEDIDOS · EDITAR #${editOrderId}` : "PEDIDOS · NUEVO REGISTRO"}
            </span>
            <h1>{isEditing ? "Editar pedido" : "Crear nuevo pedido"}</h1>
            <p>
              {isEditing
                ? "Actualiza los datos necesarios. El código y el estado actual del pedido se conservarán."
                : "Completa los datos con tranquilidad. Este formulario guarda un borrador automáticamente."}
            </p>
          </div>
          <div className="draft-status">
            <span>✓</span>
            <div>
              <b>{isEditing ? "Edición protegida" : "Borrador protegido"}</b>
              <small>
                {savedAt
                  ? `Guardado a las ${savedAt}`
                  : "Preparando guardado automático…"}
              </small>
            </div>
          </div>
        </div>

        {loadError && <div className="edit-order-load-error">{loadError}</div>}
        <div className="order-form-layout">
          <div className="order-form-main">
            <FormSection
              number="1"
              title="Operación"
              description="Empresa, almacén y fecha de entrega."
            >
              <Field label="Empresa">
                <select
                  value={draft.brand}
                  disabled={initialAccess !== "superadmin"}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      brand: e.target.value as Draft["brand"],
                      productRows: [{ product: "", quantity: "" }],
                    }))
                  }
                >
                  <option>Suyai</option>
                  <option>Aura</option>
                </select>
                {initialAccess !== "superadmin" && (
                  <small>Definida por el tipo de acceso.</small>
                )}
              </Field>
              <Field label="Almacén responsable">
                <select
                  value={draft.warehouse}
                  onChange={(e) => update("warehouse", e.target.value)}
                >
                  <option>Rímac</option>
                  <option>San Martín de Porres</option>
                  <option>La Molina</option>
                </select>
              </Field>
              <Field label="Fecha de entrega">
                <DateInput
                  required
                  value={draft.deliveryDate}
                  onChange={(e) => update("deliveryDate", e.target.value)}
                />
              </Field>
              <Field
                label="Motorizado asignado"
                hint={
                  courierLoadError
                    ? "No se pudo cargar la lista. Recarga la página para volver a intentarlo."
                    : "Solo este motorizado verá el pedido y recibirá la notificación push."
                }
              >
                <select
                  required
                  value={draft.assignedCourierId}
                  onChange={(event) => {
                    const selected = couriers.find(
                      (courier) => courier.id === event.target.value,
                    );
                    setDraft((current) => ({
                      ...current,
                      assignedCourierId: selected?.id ?? "",
                      assignedCourierName: selected?.full_name ?? "",
                    }));
                  }}
                >
                  <option value="" disabled>
                    {couriers.length
                      ? "Selecciona un motorizado"
                      : courierLoadError
                        ? "Error al cargar motorizados"
                        : "No hay motorizados activos"}
                  </option>
                  {draft.assignedCourierId &&
                    !couriers.some(
                      (courier) => courier.id === draft.assignedCourierId,
                    ) && (
                      <option value={draft.assignedCourierId}>
                        {draft.assignedCourierName || "Motorizado actual"}
                      </option>
                    )}
                  {couriers.map((courier) => (
                    <option key={courier.id} value={courier.id}>
                      {courier.full_name}
                    </option>
                  ))}
                </select>
              </Field>
            </FormSection>

            <FormSection
              number="2"
              title={`Productos ${draft.brand}`}
              description="Selecciona los productos y cantidades de este pedido."
            >
              <div
                className={`product-selector-list wide product-selector-${draft.brand.toLowerCase()}`}
              >
                {draft.productRows.map((row, index) => {
                  const matchingProducts = productCatalog[draft.brand].filter(
                    (product) =>
                      product
                        .toLowerCase()
                        .includes(row.product.trim().toLowerCase()),
                  );
                  const optionsId = `product-options-${draft.brand.toLowerCase()}-${index}`;
                  return (
                    <div className="product-entry-row" key={index}>
                      <div className="product-entry-head">
                        <strong>Producto {index + 1}</strong>
                        <button
                          className="remove-product-row"
                          type="button"
                          onClick={() => removeProductRow(index)}
                          aria-label={`Quitar producto ${index + 1}`}
                        >
                          × Quitar
                        </button>
                      </div>
                      <div className="product-entry-fields">
                        <div className="product-search-field">
                          <span>Producto</span>
                          <div className="product-combobox">
                            <input
                              type="text"
                              value={row.product}
                              onFocus={() => setOpenProductIndex(index)}
                              onChange={(event) => {
                                updateProductRow(
                                  index,
                                  "product",
                                  event.target.value,
                                );
                                setOpenProductIndex(index);
                              }}
                              placeholder="Escribe para buscar o agregar…"
                              autoComplete="off"
                              role="combobox"
                              aria-expanded={openProductIndex === index}
                              aria-controls={optionsId}
                              aria-label={`Producto ${index + 1}`}
                            />
                            <button
                              className="product-dropdown-toggle"
                              type="button"
                              onClick={() =>
                                setOpenProductIndex((current) =>
                                  current === index ? null : index,
                                )
                              }
                              aria-label={
                                openProductIndex === index
                                  ? "Cerrar lista de productos"
                                  : "Abrir lista de productos"
                              }
                              aria-expanded={openProductIndex === index}
                            >
                              ⌄
                            </button>
                            {openProductIndex === index && (
                              <div
                                className="product-options-menu"
                                id={optionsId}
                                role="listbox"
                              >
                                {matchingProducts.length ? (
                                  matchingProducts.map((product) => (
                                    <button
                                      type="button"
                                      role="option"
                                      aria-selected={row.product === product}
                                      key={product}
                                      onClick={() =>
                                        selectProduct(index, product)
                                      }
                                    >
                                      {product}
                                    </button>
                                  ))
                                ) : (
                                  <small>
                                    Sin coincidencias. Puedes registrar “
                                    {row.product}” como producto nuevo.
                                  </small>
                                )}
                              </div>
                            )}
                          </div>
                          <small>
                            Catálogo {draft.brand} · también puedes escribir uno
                            nuevo
                          </small>
                        </div>
                        <label className="product-number-field">
                          <span>Cantidad</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            value={row.quantity}
                            onChange={(event) =>
                              updateProductRow(
                                index,
                                "quantity",
                                event.target.value,
                              )
                            }
                            placeholder="Ej. 2"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
                <button
                  className="add-product-row"
                  type="button"
                  onClick={addProductRow}
                >
                  ＋ Agregar otro producto
                </button>
              </div>
            </FormSection>

            <FormSection
              number="3"
              title="Cliente y destino"
              description="Datos para contactar y encontrar al cliente."
            >
              <Field label="Nombre del cliente" wide>
                <input
                  required
                  autoComplete="name"
                  value={draft.client}
                  onChange={(e) => update("client", e.target.value)}
                  placeholder="Nombre completo"
                />
              </Field>
              <Field label="Teléfono / WhatsApp">
                <input
                  required
                  type="tel"
                  autoComplete="tel"
                  value={draft.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  placeholder="987 654 321"
                />
              </Field>
              <Field label="Distrito">
                <select
                  required
                  value={draft.district}
                  onChange={(e) => update("district", e.target.value)}
                >
                  <option value="" disabled>
                    Selecciona un distrito
                  </option>
                  {LIMA_DISTRICTS.map((district) => (
                    <option key={district} value={district}>
                      {district}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Dirección completa" wide>
                <input
                  required
                  autoComplete="street-address"
                  value={draft.address}
                  onChange={(e) => update("address", e.target.value)}
                  placeholder="Calle, número, urbanización"
                />
              </Field>
              <Field label="Referencia" wide>
                <input
                  value={draft.reference}
                  onChange={(e) => update("reference", e.target.value)}
                  placeholder="Color de puerta, piso, punto cercano…"
                />
              </Field>
              <Field
                label="Enlace de Google Maps"
                wide
                hint="Pega el enlace compartido desde Google Maps para que el motorizado abra la ubicación exacta."
              >
                <div className="maps-input">
                  <span>⌖</span>
                  <input
                    type="url"
                    value={draft.maps}
                    onChange={(e) => update("maps", e.target.value)}
                    placeholder="https://maps.app.goo.gl/…"
                  />
                </div>
              </Field>
            </FormSection>

            <FormSection
              number="4"
              title="Cobro y comisión"
              description="Los importes permanecen separados en todo momento."
            >
              <Field label="Método de pago">
                <select
                  value={draft.payment}
                  onChange={(e) => update("payment", e.target.value)}
                >
                  <option>Efectivo</option>
                  <option>Yape / Plin</option>
                  <option>Transferencia</option>
                  <option>Prepagado</option>
                </select>
              </Field>
              <Field label="Monto a cobrar al cliente (S/)">
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.collect}
                  onChange={(e) => update("collect", e.target.value)}
                  placeholder="80.00"
                />
              </Field>
              <Field label="Comisión interna (S/)">
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.commission}
                  onChange={(e) => update("commission", e.target.value)}
                  placeholder="10.00"
                />
              </Field>
              <div className="commission-warning wide">
                <b>Separación obligatoria</b>
                <span>
                  El motorizado cobra y rinde el monto del cliente. La comisión
                  se paga después y nunca se suma al cobro.
                </span>
              </div>
            </FormSection>

            <FormSection
              number="5"
              title="Notas"
              description="Información adicional para preparación o entrega."
            >
              <Field label="Indicaciones" wide>
                <textarea
                  value={draft.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  placeholder="Productos, cantidades, prioridad u observaciones…"
                  rows={4}
                />
              </Field>
            </FormSection>
          </div>

          <aside className="order-form-summary">
            <span className={`brand-badge ${draft.brand.toLowerCase()}`}>
              {draft.brand}
            </span>
            <h2>Resumen del pedido</h2>
            <dl>
              <div>
                <dt>Cliente</dt>
                <dd>{draft.client || "Sin completar"}</dd>
              </div>
              <div>
                <dt>Productos</dt>
                <dd>
                  {selectedProducts.length
                    ? selectedProducts
                        .map(
                          (product) => `${product.quantity} × ${product.name}`,
                        )
                        .join(", ")
                    : "Sin seleccionar"}
                </dd>
              </div>
              <div>
                <dt>Destino</dt>
                <dd>{draft.district || "Sin completar"}</dd>
              </div>
              <div>
                <dt>Almacén</dt>
                <dd>{draft.warehouse}</dd>
              </div>
              <div>
                <dt>Motorizado</dt>
                <dd>{draft.assignedCourierName || "Sin asignar"}</dd>
              </div>
              <div>
                <dt>Cobrar</dt>
                <dd className="summary-collect">
                  S/ {Number(draft.collect || 0).toFixed(2)}
                </dd>
              </div>
              <div>
                <dt>Comisión separada</dt>
                <dd>S/ {Number(draft.commission || 0).toFixed(2)}</dd>
              </div>
            </dl>
            {draft.maps && (
              <a
                className="maps-preview"
                href={draft.maps}
                target="_blank"
                rel="noreferrer"
              >
                ⌖ Probar enlace de Maps ↗
              </a>
            )}
            <button
              className="primary wide"
              type="submit"
              disabled={!ready || Boolean(loadError)}
            >
              {isEditing ? "Guardar cambios del pedido" : "Crear pedido y reservar stock"}
            </button>
            <button className="clear-draft" type="button" onClick={clearDraft}>
              {isEditing ? "Restaurar datos guardados" : "Borrar borrador"}
            </button>
          </aside>
        </div>
      </form>
      {confirming && (
        <div className="order-confirm-backdrop" role="presentation">
          <section
            className="order-confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-order-title"
          >
            <div className="order-confirm-icon">✓</div>
            <span className="eyebrow">CONFIRMACIÓN FINAL</span>
            <h2 id="confirm-order-title">
              {isEditing ? "¿Guardar los cambios?" : "¿Crear este pedido?"}
            </h2>
            <p>
              {isEditing
                ? "El pedido, el panel del motorizado y el próximo rótulo usarán inmediatamente estos datos."
                : "Revisa los datos principales. El pedido aparecerá en Administración y en el panel del motorizado."}
            </p>
            <dl>
              <div>
                <dt>Empresa</dt>
                <dd>
                  <span className={`brand-badge ${draft.brand.toLowerCase()}`}>
                    {draft.brand}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Cliente</dt>
                <dd>{draft.client}</dd>
              </div>
              <div>
                <dt>Productos</dt>
                <dd>
                  {selectedProducts
                    .map((product) => `${product.quantity} × ${product.name}`)
                    .join(", ")}
                </dd>
              </div>
              <div>
                <dt>Fecha</dt>
                <dd>{draft.deliveryDate}</dd>
              </div>
              <div>
                <dt>Motorizado</dt>
                <dd>{draft.assignedCourierName}</dd>
              </div>
              <div>
                <dt>Destino</dt>
                <dd>
                  {draft.district} · {draft.address}
                </dd>
              </div>
              <div>
                <dt>Monto a cobrar</dt>
                <dd className="confirm-amount">
                  S/ {Number(draft.collect || 0).toFixed(2)}
                </dd>
              </div>
            </dl>
            <div className="order-confirm-actions">
              <button
                className="secondary"
                type="button"
                disabled={creating}
                onClick={() => setConfirming(false)}
              >
                Volver a revisar
              </button>
              <button
                className="primary"
                type="button"
                disabled={creating}
                onClick={createOrder}
              >
                {creating
                  ? isEditing
                    ? "Guardando cambios…"
                    : "Creando pedido…"
                  : isEditing
                    ? "Confirmar y guardar"
                    : "Confirmar y crear pedido"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function FormSection({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="form-section">
      <div className="form-section-head">
        <span>{number}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="page-form-grid">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
