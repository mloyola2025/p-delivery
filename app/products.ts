export type ProductBrand = "Suyai" | "Aura";
export type ProductCatalog = Record<ProductBrand, string[]>;

export const PRODUCT_CATALOG: ProductCatalog = {
  Suyai: [
    "Aceite de Orégano",
    "Aceite 2 en 1",
    "Aceite de Aguaje",
    "Aceite de Coco 100% Virgen (500 ml)",
    "Aceite de Copaiba",
    "Aceite de Moringa",
    "Aceite de Muña",
    "Aceite de Ricino",
    "Aceite de Romero",
    "Aceite Esencial de Eucalipto",
    "Sangre de Grado",
    "Mood Magic (Microdosis de Hongos)",
    "Microdosis de Ayahuasca",
    "hongo (indicar suyai)",
    "Crema ayahuasca (indicar suyai)",
    "Oregano 1 lt",
  ],
  Aura: [
    "Pets 5%",
    "Pets 10%",
    "Relax",
    "Focus",
    "Plus",
    "Oregano aura",
    "Romero aura",
    "Muña aura",
    "Oregano 1 lt aura",
  ],
};

export function normalizedProductCatalog(value?: Partial<ProductCatalog>) {
  return {
    Suyai:
      Array.isArray(value?.Suyai)
        ? [...value.Suyai]
        : [...PRODUCT_CATALOG.Suyai],
    Aura:
      Array.isArray(value?.Aura)
        ? [...value.Aura]
        : [...PRODUCT_CATALOG.Aura],
  } satisfies ProductCatalog;
}

export type OrderProduct = { name: string; quantity: number };
