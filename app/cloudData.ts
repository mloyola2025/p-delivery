import type { ProductCatalog } from "./products";
import type { CourierContactSettings } from "./courierContact";

export type CloudState<TOrder = unknown> = {
  orders: TOrder[];
  inventory: Record<string, number>;
  pushSettings: { suyai: boolean; aura: boolean; courier: boolean };
  productCatalog: ProductCatalog;
  courierContactSettings: CourierContactSettings;
};

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(
        "El servidor tardó demasiado. Revisa tu conexión e intenta nuevamente.",
      );
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function readCloudState<TOrder>(
  scope: "admin" | "courier" = "admin",
) {
  const response = await fetchWithTimeout(
    `/api/state?scope=${scope}`,
    { cache: "no-store" },
    12_000,
  );
  if (!response.ok)
    throw new Error("No se pudo leer la información compartida.");
  return (await response.json()) as CloudState<TOrder>;
}

export async function mutateCloudState(
  payload: Record<string, unknown>,
  scope: "admin" | "courier" = "admin",
) {
  const response = await fetchWithTimeout(
    `/api/state?scope=${scope}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    15_000,
  );
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(result.error || "No se pudo guardar en la nube.");
  }
  return response.json();
}
