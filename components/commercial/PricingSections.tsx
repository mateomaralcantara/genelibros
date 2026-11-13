// Secciones de precios de cada modalidad. Todos los importes vienen del
// catálogo (pricing_catalog); aquí solo se presentan.

import React from "react";
import { byKind, formatUsd, pricePerCredit, type CatalogItem } from "../../src/lib/commercial/pricing";

const PAYMENTS_NOTE =
  "El pago en línea (PayPal, AZUL y tarjeta) se está activando. Mientras tanto puedes pagar por transferencia: escríbenos desde «Mis encargos» o a nuestro equipo y te enviamos los datos.";

const Check: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <li className="flex gap-2"><span className="text-emerald-300">✓</span><span>{children}</span></li>
);

const BuyButton: React.FC<{ label: string }> = ({ label }) => (
  <button type="button" disabled title={PAYMENTS_NOTE} className="mt-5 w-full cursor-not-allowed rounded-xl bg-slate-700 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-300">
    {label} · pronto
  </button>
);

export const PaymentsNote: React.FC = () => (
  <p className="mt-6 rounded-xl border border-slate-700 bg-slate-900 p-4 text-xs text-slate-400">{PAYMENTS_NOTE}</p>
);

export const BookPrice: React.FC<{ items: CatalogItem[] }> = ({ items }) => {
  const book = byKind(items, "BOOK")[0];
  if (!book) return null;
  return (
    <div className="mt-8 max-w-md rounded-2xl border border-indigo-400/40 bg-indigo-500/10 p-6">
      <div className="text-sm font-black text-indigo-200">{book.name}</div>
      <div className="mt-2 text-5xl font-black text-white">{formatUsd(book.price_usd)}</div>
      <div className="text-xs text-slate-400">por libro · pago único</div>
      <ul className="mt-4 space-y-1.5 text-sm text-slate-200">{book.features.map((f) => <Check key={f}>{f}</Check>)}</ul>
      <BuyButton label="Crear mi libro" />
    </div>
  );
};

export const CreditPacks: React.FC<{ items: CatalogItem[] }> = ({ items }) => {
  const packs = byKind(items, "CREDIT_PACK");
  const costs = byKind(items, "CREDIT_COST");
  return (
    <>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {packs.map((p) => (
          <div key={p.code} className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <div className="text-sm font-black text-slate-200">{p.name}</div>
            <div className="mt-2 text-3xl font-black text-white">{formatUsd(p.price_usd)}</div>
            <div className="mt-1 text-sm text-amber-200">{(p.credits ?? 0).toLocaleString("es-DO")} créditos</div>
            {Number(p.limits?.bonus_percent) > 0 && <div className="mt-1 text-xs font-bold text-emerald-300">+{p.limits.bonus_percent} % de regalo</div>}
            <div className="mt-1 text-[11px] text-slate-500">{formatUsd(pricePerCredit(p), { decimals: true })} por crédito</div>
            <BuyButton label="Comprar" />
          </div>
        ))}
      </div>
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

export const SubscriptionPlans: React.FC<{ items: CatalogItem[] }> = ({ items }) => {
  const plans = byKind(items, "SUBSCRIPTION");
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((p, i) => (
        <div key={p.code} className={`rounded-2xl border p-5 ${i === 1 ? "border-amber-400/50 bg-amber-500/10" : "border-slate-700 bg-slate-900"}`}>
          {i === 1 && <div className="mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-amber-200">Más elegido</div>}
          <div className="text-sm font-black text-slate-100">{p.name}</div>
          <div className="mt-2 text-3xl font-black text-white">
            {formatUsd(p.price_usd)}
            <span className="text-sm font-bold text-slate-400">/{p.billing_interval === "year" ? "año" : "mes"}</span>
          </div>
          {p.description && <p className="mt-1 text-xs text-slate-400">{p.description}</p>}
          <ul className="mt-4 space-y-1.5 text-sm text-slate-200">{p.features.map((f) => <Check key={f}>{f}</Check>)}</ul>
          <BuyButton label="Suscribirme" />
        </div>
      ))}
    </div>
  );
};

export const EditorialTiers: React.FC<{ items: CatalogItem[] }> = ({ items }) => {
  const tiers = byKind(items, "EDITORIAL_TIER");
  if (!tiers.length) return null;
  return (
    <div className="mt-8 rounded-2xl border border-amber-400/30 bg-slate-900 p-5">
      <div className="text-xs font-black uppercase tracking-widest text-amber-200">Precio orientativo por proyecto</div>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {tiers.map((t) => (
            <tr key={t.code} className="border-t border-slate-800 align-top">
              <td className="py-3 pr-3">
                <div className="font-black text-white">{t.name}</div>
                {t.description && <div className="text-xs text-slate-400">{t.description}</div>}
              </td>
              <td className="whitespace-nowrap py-3 text-right font-black text-amber-200">
                {formatUsd(t.price_usd)}{t.max_price_usd ? ` – ${formatUsd(t.max_price_usd)}` : "+"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

const OVERVIEW: Array<{ key: ModalityKey; kind: CatalogItem["kind"]; title: string; unit: string }> = [
  { key: "A", kind: "BOOK", title: "Crea tu libro", unit: "pago único" },
  { key: "C", kind: "CREDIT_PACK", title: "Créditos", unit: "sin suscripción" },
  { key: "B", kind: "SUBSCRIPTION", title: "Suscripción", unit: "al mes" },
  { key: "D", kind: "EDITORIAL_TIER", title: "Lo hacemos nosotros", unit: "por proyecto" },
];

function overviewPrice(item: CatalogItem): string {
  if (item.kind === "EDITORIAL_TIER") return `${formatUsd(item.price_usd)}${item.max_price_usd ? ` – ${formatUsd(item.max_price_usd)}` : "+"}`;
  return formatUsd(item.price_usd);
}

function overviewDetail(item: CatalogItem): string | null {
  if (item.kind === "CREDIT_PACK" || item.kind === "BOOK") return item.credits ? `${item.credits.toLocaleString("es-DO")} créditos` : null;
  if (item.kind === "SUBSCRIPTION") return item.credits ? `${item.credits.toLocaleString("es-DO")} créditos/mes` : null;
  return null;
}

export const PricingOverview: React.FC<{
  items: CatalogItem[];
  current?: ModalityKey;
  onSelect?: (key: ModalityKey) => void;
}> = ({ items, current, onSelect }) => {
  const groups = OVERVIEW.map((g) => ({ ...g, rows: byKind(items, g.kind) })).filter((g) => g.rows.length);
  if (!groups.length) return null;
  return (
    <section className="mt-10">
      <div className="text-xs font-black uppercase tracking-widest text-slate-400">Todos los precios</div>
      <div className={`mt-3 grid gap-3 sm:grid-cols-2 ${current === "D" ? "" : "lg:grid-cols-4"}`}>
        {groups.map((g) => {
          const active = g.key === current;
          return (
            <div
              key={g.key}
              className={`flex flex-col rounded-2xl border p-4 ${active ? "border-amber-400/60 bg-amber-500/10" : "border-slate-800 bg-slate-900"}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-black text-white">{g.title}</div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500">{g.unit}</div>
              </div>
              <table className="mt-3 w-full text-xs">
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.code} className="border-t border-slate-800 align-top">
                      <td className="py-1.5 pr-2 text-slate-300">
                        {r.name}
                        {overviewDetail(r) && <div className="text-[10px] text-slate-500">{overviewDetail(r)}</div>}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right font-black text-amber-200">{overviewPrice(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {onSelect && !active && (
                <button
                  type="button"
                  onClick={() => onSelect(g.key)}
                  className="mt-auto pt-3 text-left text-[11px] font-black uppercase tracking-widest text-indigo-300 hover:text-indigo-200"
                >
                  Ver detalles →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
