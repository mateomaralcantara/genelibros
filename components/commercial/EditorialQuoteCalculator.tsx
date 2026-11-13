// Cotizador para el equipo: estima el precio del servicio editorial con los
// parámetros de pricing_settings y permite usarlo en la propuesta.

import React, { useEffect, useMemo, useState } from "react";
import { getEditorialQuoteSettings } from "../../src/data/pricingRepo";
import {
  COMPLEXITY_LABELS,
  RESEARCH_LABELS,
  formatUsd,
  quoteEditorial,
  type Complexity,
  type EditorialQuoteInput,
  type EditorialQuoteSettings,
  type ResearchLevel,
} from "../../src/lib/commercial/pricing";

const input = "w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100";

const EditorialQuoteCalculator: React.FC<{ onUse: (amountUsd: number, summary: string) => void }> = ({ onUse }) => {
  const [settings, setSettings] = useState<EditorialQuoteSettings | null>(null);
  const [q, setQ] = useState<EditorialQuoteInput>({
    complexity: "MEDIA",
    words: 30000,
    interviews: 3,
    research: "BASICA",
    designLayout: true,
    coverDesign: true,
    revisionRounds: 2,
    rush: false,
  });
  useEffect(() => {
    getEditorialQuoteSettings().then(setSettings).catch(() => setSettings(null));
  }, []);
  const result = useMemo(() => (settings ? quoteEditorial(q, settings) : null), [q, settings]);
  if (!settings || !result) return <div className="text-xs text-slate-500">Cotizador no disponible (ejecuta la migración de precios).</div>;

  const summary = result.lines.map((l) => `• ${l.label}: ${formatUsd(l.usd)}`).join("\n");

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3">
      <div className="text-xs font-black uppercase tracking-widest text-indigo-200">Cotizador</div>
      <div className="mt-2 grid gap-2 md:grid-cols-4">
        <label className="text-[11px] text-slate-400 md:col-span-2">Complejidad
          <select className={input} value={q.complexity} onChange={(e) => setQ({ ...q, complexity: e.target.value as Complexity })}>
            {Object.entries(COMPLEXITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-400">Palabras<input className={input} type="number" min="0" step="1000" value={q.words} onChange={(e) => setQ({ ...q, words: Number(e.target.value) })} /></label>
        <label className="text-[11px] text-slate-400">Entrevistas<input className={input} type="number" min="0" value={q.interviews} onChange={(e) => setQ({ ...q, interviews: Number(e.target.value) })} /></label>
        <label className="text-[11px] text-slate-400 md:col-span-2">Investigación
          <select className={input} value={q.research} onChange={(e) => setQ({ ...q, research: e.target.value as ResearchLevel })}>
            {Object.entries(RESEARCH_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-400">Rondas de revisión<input className={input} type="number" min="0" value={q.revisionRounds} onChange={(e) => setQ({ ...q, revisionRounds: Number(e.target.value) })} /></label>
        <div className="flex flex-col justify-end gap-1 text-[11px] text-slate-300">
          <label><input type="checkbox" checked={q.designLayout} onChange={(e) => setQ({ ...q, designLayout: e.target.checked })} /> Diagramación</label>
          <label><input type="checkbox" checked={q.coverDesign} onChange={(e) => setQ({ ...q, coverDesign: e.target.checked })} /> Portada</label>
          <label><input type="checkbox" checked={q.rush} onChange={(e) => setQ({ ...q, rush: e.target.checked })} /> Urgente</label>
        </div>
      </div>
      <ul className="mt-3 space-y-0.5 text-xs text-slate-300">
        {result.lines.map((l) => <li key={l.label} className="flex justify-between"><span>{l.label}</span><span>{formatUsd(l.usd)}</span></li>)}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2">
        <span className="text-lg font-black text-white">{formatUsd(result.total)}</span>
        <button type="button" onClick={() => onUse(result.total, summary)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white hover:bg-indigo-500">
          Usar en la propuesta
        </button>
      </div>
      {result.atMin && <div className="mt-1 text-[11px] text-amber-300">Se aplicó el mínimo de {formatUsd(settings.min_usd)}.</div>}
      {result.aboveMax && <div className="mt-1 text-[11px] text-amber-300">El cálculo ({formatUsd(result.subtotal)}) supera el máximo de {formatUsd(settings.max_usd)}: valora una cotización a medida.</div>}
    </div>
  );
};

export default EditorialQuoteCalculator;
