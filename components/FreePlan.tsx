// Aviso del plan gratis y ventana para pasar a un plan de pago.

import React from "react";
import type { FreePlanUsage } from "../src/hooks/useFreePlanUsage";
import { formatUsd, type CatalogItem } from "../src/lib/commercial/pricing";
import { cardLines } from "./commercial/PricingSections";

export const FREE_PLAN_UPGRADE_TEXT =
  "Con el plan gratis ya tienes el título y los títulos de los capítulos. Para escribir la propuesta, la introducción y todos los capítulos, elige un plan:";

export const FreePlanBanner: React.FC<{ usage: FreePlanUsage; onUpgrade: () => void }> = ({ usage, onUpgrade }) => {
  const pct = Math.min(100, Math.round((usage.used / Math.max(1, usage.max)) * 100));
  return (
    <div className="shrink-0 flex flex-wrap items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100">
      <span className="font-black uppercase tracking-widest text-amber-200">Plan gratis</span>
      <span>
        {usage.used.toLocaleString("es-DO")} de {usage.max.toLocaleString("es-DO")} palabras
      </span>
      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${pct >= 100 ? "bg-red-400" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="hidden text-amber-100/80 md:inline">Incluye título y títulos de capítulos.</span>
      <button type="button" onClick={onUpgrade} className="ml-auto rounded-lg bg-amber-500 px-3 py-1.5 font-black uppercase tracking-widest text-slate-950 hover:bg-amber-400">
        Elegir plan
      </button>
    </div>
  );
};

const UNIT: Record<string, string> = { BOOK: "pago único", CREDIT_PACK: "sin suscripción", SUBSCRIPTION: "al mes" };

export const UpgradeModal: React.FC<{
  reason: string;
  plans: CatalogItem[] | null;
  onBuy: (item: CatalogItem) => void;
  onSeeAll: () => void;
  onClose: () => void;
}> = ({ reason, plans, onBuy, onSeeAll, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-amber-400/40 bg-slate-950 p-6 text-slate-100 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-200">Plan gratis</div>
          <h2 className="mt-2 text-2xl font-black text-white">Genera tu libro completo</h2>
          <p className="mt-2 text-sm text-slate-300">{reason}</p>
        </div>
        <button type="button" onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-white" aria-label="Cerrar">×</button>
      </div>

      {!plans ? (
        <div className="mt-6 text-sm text-slate-400">Cargando planes…</div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {plans.map((p, i) => (
            <div key={p.code} className={`flex flex-col rounded-2xl border p-4 ${i === 1 ? "border-amber-400/60 bg-amber-500/10" : "border-slate-800 bg-slate-900"}`}>
              {i === 1 && <div className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">Recomendado</div>}
              <div className="text-sm font-black text-white">{p.name}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-3xl font-black text-white">{formatUsd(p.price_usd)}</span>
                <span className="text-[11px] text-slate-400">{UNIT[p.kind] ?? ""}</span>
              </div>
              {p.credits && p.kind !== "CREDIT_PACK" ? (
                <div className="text-[11px] text-amber-200">
                  {p.credits.toLocaleString("es-DO")} créditos{p.kind === "SUBSCRIPTION" ? "/mes" : ""}
                </div>
              ) : null}
              <ul className="mt-3 space-y-1 text-xs text-slate-300">
                {cardLines(p).map((l) => (
                  <li key={l} className="flex gap-1.5"><span className="text-emerald-300">✓</span><span>{l}</span></li>
                ))}
              </ul>
              <div className="mt-auto pt-4">
                <button
                  type="button"
                  onClick={() => onBuy(p)}
                  className="w-full rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-950 hover:bg-amber-400"
                >
                  {p.kind === "SUBSCRIPTION" ? "Suscribirme" : "Comprar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onSeeAll} className="text-xs font-black uppercase tracking-widest text-indigo-300 hover:text-indigo-200">
          Ver todos los planes →
        </button>
        <button type="button" onClick={onClose} className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-200 hover:bg-slate-700">
          Ahora no
        </button>
      </div>
    </div>
  </div>
);

const FREE_TEASER_DISMISSED = "genelibros.freeTeaserDismissed";

/** Tarjeta pequeña en una esquina que presenta el plan gratis a los visitantes. Se puede cerrar. */
export const FreePlanTeaser: React.FC<{ plan: CatalogItem | null; onStart: () => void }> = ({ plan, onStart }) => {
  const [hidden, setHidden] = React.useState(() => {
    try {
      return localStorage.getItem(FREE_TEASER_DISMISSED) === "1";
    } catch {
      return false;
    }
  });
  if (!plan || hidden) return null;
  const close = () => {
    setHidden(true);
    try {
      localStorage.setItem(FREE_TEASER_DISMISSED, "1");
    } catch {
      /* sin almacenamiento */
    }
  };
  return (
    <aside
      className="fixed right-4 top-20 z-40 w-64 rounded-2xl border border-emerald-400/50 bg-slate-900/95 p-4 text-slate-100 shadow-2xl backdrop-blur"
      aria-label="Plan gratis"
    >
      <button type="button" onClick={close} className="absolute right-3 top-2 text-lg leading-none text-slate-400 hover:text-white" aria-label="Cerrar">
        ×
      </button>
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-200">Empieza aquí · sin tarjeta</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-black text-white">{plan.name}</span>
        <span className="text-sm font-black text-emerald-300">Gratis</span>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-slate-300">
        {plan.features.slice(0, 4).map((f) => (
          <li key={f}><span className="text-emerald-300">✓</span> {f}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="mt-3 w-full rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-slate-950 hover:bg-emerald-400"
      >
        Empezar gratis
      </button>
    </aside>
  );
};
