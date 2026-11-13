// Panel de precios (solo admin): edita el catálogo y el cotizador editorial
// sin tocar el código. Cada cambio queda en pricing_changes.

import React, { useCallback, useEffect, useState } from "react";
import {
  listCatalog,
  listPricingChanges,
  getEditorialQuoteSettings,
  saveEditorialQuoteSettings,
  updateCatalogItem,
  type PricingChange,
} from "../../src/data/pricingRepo";
import { formatUsd, pricePerCredit, type CatalogItem, type CatalogKind, type EditorialQuoteSettings } from "../../src/lib/commercial/pricing";

const input = "w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100";
const btn = "rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest transition disabled:opacity-50";

const KIND_TITLES: Record<CatalogKind, string> = {
  FREE: "Plan gratis",
  BOOK: "A · Libro con un clic",
  SUBSCRIPTION: "B · Suscripciones (mensual)",
  CREDIT_PACK: "C · Paquetes de créditos",
  EDITORIAL_TIER: "D · Servicio editorial (desde – hasta)",
  CREDIT_COST: "Consumo de créditos por operación",
};

const Row: React.FC<{ item: CatalogItem; onSave: (patch: Partial<CatalogItem>) => Promise<void> }> = ({ item, onSave }) => {
  const [d, setD] = useState({
    name: item.name,
    price: item.price_usd?.toString() ?? "",
    max: item.max_price_usd?.toString() ?? "",
    credits: item.credits?.toString() ?? "",
    maxWords: item.limits?.max_words != null ? String(item.limits.max_words) : "",
    features: item.features.join("\n"),
    active: item.active,
  });
  const [busy, setBusy] = useState(false);
  const dirty =
    d.name !== item.name ||
    d.price !== (item.price_usd?.toString() ?? "") ||
    d.max !== (item.max_price_usd?.toString() ?? "") ||
    d.credits !== (item.credits?.toString() ?? "") ||
    d.maxWords !== (item.limits?.max_words != null ? String(item.limits.max_words) : "") ||
    d.features !== item.features.join("\n") ||
    d.active !== item.active;
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const isFree = item.kind === "FREE";
  const showPrice = item.kind !== "CREDIT_COST" && !isFree;
  const showCredits = item.kind !== "EDITORIAL_TIER" && !isFree;
  const showFeatures = ["FREE", "BOOK", "SUBSCRIPTION", "EDITORIAL_TIER"].includes(item.kind);

  return (
    <div className={`grid items-start gap-2 rounded-xl border p-3 md:grid-cols-[1.3fr_90px_90px_90px_1.5fr_auto] ${d.active ? "border-slate-800 bg-slate-900" : "border-slate-800 bg-slate-950 opacity-60"}`}>
      <div>
        <input className={input} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <div className="mt-1 font-mono text-[10px] text-slate-500">{item.code}</div>
      </div>
      <div>{showPrice && <><label className="text-[10px] text-slate-500">{item.kind === "EDITORIAL_TIER" ? "Desde US$" : "US$"}</label><input className={input} type="number" min="0" step="0.01" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} /></>}</div>
      <div>{isFree && <><label className="text-[10px] text-slate-500">Palabras incluidas</label><input className={input} type="number" min="0" step="500" value={d.maxWords} onChange={(e) => setD({ ...d, maxWords: e.target.value })} /></>}{item.kind === "EDITORIAL_TIER" && <><label className="text-[10px] text-slate-500">Hasta US$</label><input className={input} type="number" min="0" step="0.01" value={d.max} onChange={(e) => setD({ ...d, max: e.target.value })} /></>}</div>
      <div>{showCredits && <><label className="text-[10px] text-slate-500">Créditos</label><input className={input} type="number" min="0" step="1" value={d.credits} onChange={(e) => setD({ ...d, credits: e.target.value })} /></>}
        {item.kind === "CREDIT_PACK" && <div className="mt-1 text-[10px] text-slate-500">{formatUsd(pricePerCredit({ price_usd: num(d.price), credits: num(d.credits) }), { decimals: true })}/crédito</div>}
      </div>
      <div>{showFeatures && <><label className="text-[10px] text-slate-500">Características (una por línea)</label><textarea className={`${input} min-h-[60px]`} value={d.features} onChange={(e) => setD({ ...d, features: e.target.value })} /></>}</div>
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> Activo</label>
        <button
          type="button"
          disabled={!dirty || busy}
          className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({
                name: d.name.trim(),
                price_usd: showPrice ? num(d.price) : item.price_usd,
                max_price_usd: item.kind === "EDITORIAL_TIER" ? num(d.max) : item.max_price_usd,
                credits: showCredits ? num(d.credits) : item.credits,
                features: showFeatures ? d.features.split("\n").map((f) => f.trim()).filter(Boolean) : item.features,
                active: d.active,
                ...(isFree ? { limits: { ...item.limits, max_words: num(d.maxWords) ?? 0 } } : {}),
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          Guardar
        </button>
      </div>
    </div>
  );
};

const QUOTE_FIELDS: Array<[keyof EditorialQuoteSettings, string]> = [
  ["min_usd", "Mínimo por proyecto (US$)"],
  ["max_usd", "Máximo por proyecto (US$)"],
  ["per_interview", "Por entrevista (US$)"],
  ["design_layout", "Diseño y diagramación (US$)"],
  ["cover_design", "Diseño de portada (US$)"],
  ["per_revision_round", "Por ronda de revisión (US$)"],
  ["rush_multiplier", "Multiplicador por urgencia (ej. 1.25)"],
];

const PricingAdmin: React.FC = () => {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [quote, setQuote] = useState<EditorialQuoteSettings | null>(null);
  const [changes, setChanges] = useState<PricingChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, q, h] = await Promise.all([listCatalog(), getEditorialQuoteSettings(), listPricingChanges()]);
      setItems(c);
      setQuote(q);
      setChanges(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (fn: () => Promise<void>, msg: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(msg);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!items || !items.length)
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
        {error || items ? (
          <>
            No se pudo cargar el catálogo{error ? `: ${error}` : " (está vacío)"}.<br />
            Ejecuta en Supabase → SQL Editor, en este orden: <code>20261118_roles_editorial_payments.sql</code> y{" "}
            <code>20261119_pricing_catalog.sql</code>, y recarga.
          </>
        ) : (
          "Cargando precios…"
        )}
      </div>
    );
  const kinds: CatalogKind[] = ["FREE", "BOOK", "SUBSCRIPTION", "CREDIT_PACK", "EDITORIAL_TIER", "CREDIT_COST"];

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-400">Los cambios se aplican al instante en las páginas de precios y quedan registrados en el historial.</p>
      {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">{notice}</div>}
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</div>}

      {kinds.map((k) => (
        <section key={k}>
          <h3 className="mb-2 text-sm font-black uppercase tracking-widest text-amber-200">{KIND_TITLES[k]}</h3>
          <div className="space-y-2">
            {items.filter((i) => i.kind === k).map((i) => (
              <Row key={`${i.code}-${i.price_usd}-${i.credits}-${i.active}`} item={i} onSave={(patch) => save(() => updateCatalogItem(i.code, patch), `Guardado: ${patch.name ?? i.name}`)} />
            ))}
          </div>
        </section>
      ))}

      {quote && (
        <section>
          <h3 className="mb-2 text-sm font-black uppercase tracking-widest text-amber-200">Cotizador del servicio editorial</h3>
          <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-4">
            {QUOTE_FIELDS.map(([key, label]) => (
              <label key={key} className="text-xs text-slate-400">
                {label}
                <input className={input} type="number" step="0.01" value={String(quote[key] ?? "")} onChange={(e) => setQuote({ ...quote, [key]: Number(e.target.value) })} />
              </label>
            ))}
            {(["base_by_complexity", "per_1000_words_by_complexity", "research"] as const).map((group) => (
              <div key={group} className="md:col-span-4">
                <div className="text-xs font-bold text-slate-300">
                  {group === "base_by_complexity" ? "Base por complejidad (US$)" : group === "per_1000_words_by_complexity" ? "Por cada 1.000 palabras según complejidad (US$)" : "Investigación (US$)"}
                </div>
                <div className="mt-1 grid gap-2 md:grid-cols-5">
                  {Object.entries(quote[group] as Record<string, number>).map(([k, v]) => (
                    <label key={k} className="text-[11px] text-slate-500">
                      {k}
                      <input className={input} type="number" step="0.01" value={v} onChange={(e) => setQuote({ ...quote, [group]: { ...(quote[group] as any), [k]: Number(e.target.value) } })} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="md:col-span-4">
              <button type="button" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`} onClick={() => save(() => saveEditorialQuoteSettings(quote), "Cotizador guardado")}>
                Guardar cotizador
              </button>
            </div>
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-black uppercase tracking-widest text-slate-400">Historial de cambios</h3>
        <ul className="space-y-1 text-xs text-slate-400">
          {changes.map((c) => (
            <li key={c.id}>
              {new Date(c.changed_at).toLocaleString("es-DO")} · <span className="font-mono">{c.item_key}</span>
              {c.old_value?.price_usd !== undefined && c.old_value?.price_usd !== c.new_value?.price_usd && ` · precio ${formatUsd(c.old_value.price_usd)} → ${formatUsd(c.new_value.price_usd)}`}
            </li>
          ))}
          {!changes.length && <li>Sin cambios todavía.</li>}
        </ul>
      </section>
    </div>
  );
};

export default PricingAdmin;
