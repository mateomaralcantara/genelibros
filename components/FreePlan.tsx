// Aviso del plan gratis y ventana para pasar a un plan de pago.

import React from "react";
import type { FreePlanUsage } from "../src/hooks/useFreePlanUsage";

export const FREE_PLAN_UPGRADE_TEXT =
  "Con el plan gratis tienes el título y los títulos de los capítulos. Para escribir la propuesta, la introducción y los capítulos, elige un plan.";

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

export const UpgradeModal: React.FC<{ reason: string; onUpgrade: () => void; onClose: () => void }> = ({ reason, onUpgrade, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
    <div className="w-full max-w-md rounded-2xl border border-amber-400/40 bg-slate-950 p-6 text-slate-100 shadow-2xl">
      <div className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-200">Plan gratis</div>
      <h2 className="mt-2 text-2xl font-black text-white">Continúa tu libro</h2>
      <p className="mt-3 text-sm text-slate-300">{reason}</p>
      <ul className="mt-4 space-y-1 text-sm text-slate-200">
        <li>✓ Libro completo con un clic, pago único</li>
        <li>✓ Créditos sin suscripción</li>
        <li>✓ Suscripciones de autor con créditos mensuales</li>
        <li>✓ O que nuestro equipo editorial lo escriba por ti</li>
      </ul>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-200 hover:bg-slate-700">
          Ahora no
        </button>
        <button type="button" onClick={onUpgrade} className="rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-950 hover:bg-amber-400">
          Ver planes
        </button>
      </div>
    </div>
  </div>
);
