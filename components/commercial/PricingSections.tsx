// Secciones de precios de cada modalidad. Todos los importes vienen del
// catálogo (pricing_catalog); aquí solo se presentan.

import React from "react";
import { byKind, formatUsd, pricePerCredit, type CatalogItem } from "../../src/lib/commercial/pricing";

const PAYMENTS_NOTE =
  "Paga con PayPal (o tarjeta a través de PayPal) o por transferencia bancaria. Las compras se activan en cuanto el pago queda confirmado.";

/** Lo provee ServicesHub: abre la ventana de pago del producto. */
export const BuyContext = React.createContext<((item: CatalogItem) => void) | null>(null);

export const PaymentsNote: React.FC = () => (
  <p className="mt-6 rounded-xl border border-slate-700 bg-slate-900 p-4 text-xs text-slate-400">{PAYMENTS_NOTE}</p>
);

export const CreditPacks: React.FC<{ items: CatalogItem[] }> = ({ items }) => {
  const costs = byKind(items, "CREDIT_COST");
  return (
    <>
      <PricingCards items={items} only="CREDIT_PACK" />
      {costs.length > 0 && (
        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="text-xs font-black uppercase tracking-widest text-slate-400">Cuánto consume cada operación</div>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {costs.map((c) => (
                <tr key={c.code} className="border-t border-slate-800">
                  <td className="py-2 text-slate-200">{c.name}</td>
                  <td className="py-2 text-right font-black text-amber-200">{c.credits} créditos</td>
                  <td className="py-2 pl-3 text-right text-xs text-slate-500">por {c.limits?.unit ?? "operación"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">Antes de cada operación costosa verás cuántos créditos consumirá.</p>
        </div>
      )}
    </>
  );
};

export const EditorialTiers: React.FC<{ items: CatalogItem[]; onRequest?: () => void }> = ({ items, onRequest }) => {
  if (!byKind(items, "EDITORIAL_TIER").length) return null;
  return (
    <div className="mt-8">
      <div className="text-xs font-black uppercase tracking-widest text-amber-200">Precio orientativo por proyecto</div>
      <PricingCards items={items} only="EDITORIAL_TIER" onRequestEditorial={onRequest} />
      <p className="mt-3 text-xs text-slate-400">
        Cada libro es distinto: el precio final depende de la extensión, las entrevistas, la investigación, el diseño y
        el plazo. Te enviamos una propuesta personalizada y sin compromiso.
      </p>
    </div>
  );
};

/** "Desde US$X" para las tarjetas del inicio. */
export function fromPrice(items: CatalogItem[], kind: CatalogItem["kind"]): string | null {
  const prices = byKind(items, kind).map((i) => i.price_usd).filter((p): p is number => p != null);
  return prices.length ? `Desde ${formatUsd(Math.min(...prices))}` : null;
}

/* --------------------------------------------------------------------------
 * Resumen compacto con TODOS los modelos de precios, en tarjetas. Se muestra
 * en el inicio de Servicios y al pie de cada modalidad (resaltando la actual).
 * ------------------------------------------------------------------------ */

type ModalityKey = "A" | "B" | "C" | "D";

/* --------------------------------------------------------------------------
 * Tarjetas por categoría: cada producto en una tarjeta compacta con su
 * descripción y su botón. Filtro por categoría arriba.
 * ------------------------------------------------------------------------ */

export type PricingCategory = "BOOK" | "CREDIT_PACK" | "SUBSCRIPTION" | "EDITORIAL_TIER";

const CATEGORIES: Array<{ kind: PricingCategory; label: string; unit: string; modality: ModalityKey }> = [
  { kind: "BOOK", label: "Crea tu libro", unit: "pago único", modality: "A" },
  { kind: "CREDIT_PACK", label: "Créditos", unit: "sin suscripción", modality: "C" },
  { kind: "SUBSCRIPTION", label: "Suscripciones", unit: "al mes", modality: "B" },
  { kind: "EDITORIAL_TIER", label: "Lo hacemos nosotros", unit: "por proyecto", modality: "D" },
];

/** Líneas de descripción de una tarjeta (máx. 4), a partir del catálogo. */
export function cardLines(item: CatalogItem): string[] {
  if (item.features.length) return item.features.slice(0, 4);
  const lines: string[] = [];
  if (item.description) lines.push(item.description);
  if (item.kind === "CREDIT_PACK") {
    if (item.credits) lines.push(`${item.credits.toLocaleString("es-DO")} créditos`);
    if (Number(item.limits?.bonus_percent) > 0) lines.push(`+${item.limits.bonus_percent} % de regalo`);
    const per = pricePerCredit(item);
    if (per != null) lines.push(`${formatUsd(per, { decimals: true })} por crédito`);
    lines.push("No caducan con el mes");
  }
  return lines.slice(0, 4);
}

const ProductCard: React.FC<{ item: CatalogItem; unit: string; highlight?: boolean; onRequest?: () => void }> = ({ item, unit, highlight, onRequest }) => {
  const buy = React.useContext(BuyContext);
  const editorial = item.kind === "EDITORIAL_TIER";
  return (
    <div className={`flex flex-col rounded-2xl border p-4 ${highlight ? "border-amber-400/60 bg-amber-500/10" : "border-slate-800 bg-slate-900"}`}>
      {highlight && <div className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">Más elegido</div>}
      <div className="text-sm font-black text-white">{item.name}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-black text-white">
          {formatUsd(item.price_usd)}
          {editorial && item.max_price_usd ? <span className="text-base"> – {formatUsd(item.max_price_usd)}</span> : null}
        </span>
        <span className="text-[11px] text-slate-400">{unit}</span>
      </div>
      {item.kind === "SUBSCRIPTION" && item.credits ? <div className="text-[11px] text-amber-200">{item.credits.toLocaleString("es-DO")} créditos/mes</div> : null}
      <ul className="mt-3 space-y-1 text-xs text-slate-300">
        {cardLines(item).map((l) => (
          <li key={l} className="flex gap-1.5"><span className="text-emerald-300">✓</span><span>{l}</span></li>
        ))}
      </ul>
      <div className="mt-auto pt-4">
        {editorial ? (
          <button type="button" onClick={onRequest} className="w-full rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-950 hover:bg-amber-400">
            Solicitar cotización
          </button>
        ) : (
          <button
            type="button"
            disabled={!buy}
            onClick={() => buy?.(item)}
            className="w-full rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
          >
            {item.kind === "SUBSCRIPTION" ? "Suscribirme" : "Comprar"}
          </button>
        )}
      </div>
    </div>
  );
};

export const PricingCards: React.FC<{
  items: CatalogItem[];
  only?: PricingCategory;
  onRequestEditorial?: () => void;
  title?: string;
}> = ({ items, only, onRequestEditorial, title = "Precios" }) => {
  const available = CATEGORIES.filter((c) => (!only || c.kind === only) && byKind(items, c.kind).length);
  const [filter, setFilter] = React.useState<PricingCategory | "ALL">("ALL");
  if (!available.length) return null;
  const shown = available.filter((c) => filter === "ALL" || c.kind === filter);
  return (
    <section className="mt-8">
      {!only && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 text-xs font-black uppercase tracking-widest text-slate-400">{title}</div>
          {[{ kind: "ALL" as const, label: "Todos" }, ...available].map((c) => (
            <button
              key={c.kind}
              type="button"
              onClick={() => setFilter(c.kind)}
              className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest transition ${filter === c.kind ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {shown.map((c) => {
        const rows = byKind(items, c.kind);
        return (
          <div key={c.kind} className="mt-5">
            {!only && <div className="mb-2 text-sm font-black text-amber-200">{c.label}</div>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {rows.map((r, i) => (
                <ProductCard key={r.code} item={r} unit={c.unit} highlight={c.kind === "SUBSCRIPTION" && i === 1} onRequest={onRequestEditorial} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
};
