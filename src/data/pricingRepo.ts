// Catálogo de precios (Supabase). Lectura pública de lo activo; escritura
// solo admin (RLS). Ver supabase/migrations/20261119_pricing_catalog.sql.

import { supabase } from "../lib/supabase";
import type { CatalogItem, EditorialQuoteSettings } from "../lib/commercial/pricing";

function fail(context: string, error: any): never {
  throw new Error(`${context}: ${error?.message || error}`);
}

const normalize = (row: any): CatalogItem => ({
  ...row,
  price_usd: row.price_usd == null ? null : Number(row.price_usd),
  max_price_usd: row.max_price_usd == null ? null : Number(row.max_price_usd),
  credits: row.credits == null ? null : Number(row.credits),
  features: Array.isArray(row.features) ? row.features : [],
  limits: row.limits && typeof row.limits === "object" ? row.limits : {},
});

export async function listCatalog(): Promise<CatalogItem[]> {
  const { data, error } = await supabase.from("pricing_catalog").select("*").order("sort_order", { ascending: true });
  if (error) fail("No se pudieron cargar los precios", error);
  return (data ?? []).map(normalize);
}

export async function getEditorialQuoteSettings(): Promise<EditorialQuoteSettings | null> {
  const { data, error } = await supabase.from("pricing_settings").select("value").eq("key", "editorial_quote").maybeSingle();
  if (error) return null;
  return (data?.value as EditorialQuoteSettings) ?? null;
}

/* ------------------------------- Admin ------------------------------- */

export type CatalogPatch = Partial<
  Pick<CatalogItem, "name" | "description" | "price_usd" | "max_price_usd" | "credits" | "features" | "limits" | "active" | "sort_order">
>;

export async function updateCatalogItem(code: string, patch: CatalogPatch): Promise<void> {
  const { error } = await supabase.from("pricing_catalog").update(patch).eq("code", code);
  if (error) fail("No se pudo guardar el precio", error);
}

export async function saveEditorialQuoteSettings(value: EditorialQuoteSettings): Promise<void> {
  const { error } = await supabase.from("pricing_settings").upsert({ key: "editorial_quote", value }, { onConflict: "key" });
  if (error) fail("No se pudo guardar el cotizador", error);
}

export type PricingChange = { id: string; table_name: string; item_key: string; old_value: any; new_value: any; changed_at: string };

export async function listPricingChanges(limit = 30): Promise<PricingChange[]> {
  const { data, error } = await supabase.from("pricing_changes").select("*").order("changed_at", { ascending: false }).limit(limit);
  if (error) return [];
  return (data ?? []) as PricingChange[];
}
