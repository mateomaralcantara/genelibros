// Planificador de prompt: el autor responde unas preguntas y la app arma el
// encargo completo del libro. No hace falta preparar el prompt en otra IA.

import React, { useMemo, useState } from "react";
import {
  BOOK_TYPES,
  LANGUAGES,
  POINTS_OF_VIEW,
  TONES,
  WORDS_PER_CHAPTER,
  buildBookPrompt,
  emptyPlan,
  needsPointOfView,
  planProblems,
  type BookPlan,
} from "../src/lib/promptPlanner";

const input =
  "w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500";
const label = "block text-xs font-bold text-slate-300";
const hint = "mt-0.5 text-[11px] font-normal text-slate-500";

const STEPS = ["Tu idea", "Lector y estilo", "Estructura"] as const;

const PromptPlanner: React.FC<{
  disabled?: boolean;
  onUse: (prompt: string) => void;
  onEdit: (prompt: string) => void;
  onClose: () => void;
}> = ({ disabled, onUse, onEdit, onClose }) => {
  const [plan, setPlan] = useState<BookPlan>(emptyPlan);
  const [step, setStep] = useState(0);
  const set = <K extends keyof BookPlan>(key: K, value: BookPlan[K]) => setPlan((p) => ({ ...p, [key]: value }));
  const prompt = useMemo(() => buildBookPrompt(plan), [plan]);
  const problems = planProblems(plan);

  return (
    <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-indigo-500/40 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-white">Planificador de prompt</div>
          <p className="text-xs text-slate-400">Responde estas preguntas y armamos el encargo de tu libro. No necesitas ChatGPT, Gemini ni Claude.</p>
        </div>
        <button type="button" onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-white" aria-label="Cerrar planificador">×</button>
      </div>

      <div className="mt-3 flex gap-1">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(i)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-black uppercase tracking-widest ${i === step ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {step === 0 && (
          <>
            <label className={label}>
              Tipo de libro
              <select className={`${input} mt-1`} value={plan.bookType} onChange={(e) => set("bookType", e.target.value)}>
                {BOOK_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className={label}>
              Título de trabajo <span className="font-normal text-slate-500">(opcional)</span>
              <input className={`${input} mt-1`} value={plan.workingTitle} onChange={(e) => set("workingTitle", e.target.value)} placeholder="Déjalo vacío y te proponemos uno" />
            </label>
            <label className={`${label} md:col-span-2`}>
              ¿De qué trata tu libro?
              <div className={hint}>Cuéntalo con tus palabras: la idea, la historia o el conocimiento que quieres compartir.</div>
              <textarea className={`${input} mt-1 min-h-[90px]`} value={plan.idea} onChange={(e) => set("idea", e.target.value)} placeholder="Ej.: Cómo pasé de empleado a emprendedor en República Dominicana y los 7 errores que todo principiante debe evitar." />
            </label>
            <label className={`${label} md:col-span-2`}>
              ¿Qué debe lograr el lector? <span className="font-normal text-slate-500">(opcional)</span>
              <input className={`${input} mt-1`} value={plan.goal} onChange={(e) => set("goal", e.target.value)} placeholder="Ej.: Que abra su primer negocio con un plan claro y sin endeudarse." />
            </label>
          </>
        )}

        {step === 1 && (
          <>
            <label className={`${label} md:col-span-2`}>
              ¿Para quién es?
              <input className={`${input} mt-1`} value={plan.audience} onChange={(e) => set("audience", e.target.value)} placeholder="Ej.: Jóvenes de 20 a 35 años que quieren emprender" />
            </label>
            <label className={label}>
              Tono
              <select className={`${input} mt-1`} value={plan.tone} onChange={(e) => set("tone", e.target.value)}>
                {TONES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className={label}>
              Idioma
              <select className={`${input} mt-1`} value={plan.language} onChange={(e) => set("language", e.target.value)}>
                {LANGUAGES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            {needsPointOfView(plan.bookType) && (
              <label className={label}>
                Punto de vista
                <select className={`${input} mt-1`} value={plan.pointOfView} onChange={(e) => set("pointOfView", e.target.value)}>
                  {POINTS_OF_VIEW.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
            )}
            <label className={`${label} md:col-span-2`}>
              Autores o libros que te inspiran <span className="font-normal text-slate-500">(opcional)</span>
              <input className={`${input} mt-1`} value={plan.references} onChange={(e) => set("references", e.target.value)} placeholder="Ej.: con el estilo directo de «Hábitos atómicos»" />
            </label>
            <label className={label}>
              Debe incluir <span className="font-normal text-slate-500">(opcional)</span>
              <input className={`${input} mt-1`} value={plan.mustInclude} onChange={(e) => set("mustInclude", e.target.value)} placeholder="Ej.: ejercicios al final de cada capítulo" />
            </label>
            <label className={label}>
              Evitar <span className="font-normal text-slate-500">(opcional)</span>
              <input className={`${input} mt-1`} value={plan.avoid} onChange={(e) => set("avoid", e.target.value)} placeholder="Ej.: tecnicismos, temas políticos" />
            </label>
          </>
        )}

        {step === 2 && (
          <>
            <label className={label}>
              Número de capítulos
              <input className={`${input} mt-1`} type="number" min={3} max={40} value={plan.chapters} onChange={(e) => set("chapters", Number(e.target.value))} />
            </label>
            <label className={label}>
              Palabras por capítulo
              <select className={`${input} mt-1`} value={plan.wordsPerChapter} onChange={(e) => set("wordsPerChapter", Number(e.target.value))}>
                {WORDS_PER_CHAPTER.map((w) => <option key={w} value={w}>{w.toLocaleString("es-DO")} palabras</option>)}
              </select>
            </label>
            <label className={`${label} md:col-span-2`}>
              ¿Ya tienes títulos de capítulos? <span className="font-normal text-slate-500">(opcional, uno por línea)</span>
              <textarea className={`${input} mt-1 min-h-[80px]`} value={plan.chapterTitles} onChange={(e) => set("chapterTitles", e.target.value)} placeholder={"El día que renuncié\nLos números no mienten\n…"} />
            </label>
          </>
        )}
      </div>

      <details className="mt-4 rounded-lg border border-slate-700 bg-slate-950 p-3">
        <summary className="cursor-pointer text-xs font-bold text-slate-300">Ver el prompt que se enviará</summary>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-300">{prompt}</pre>
      </details>

      {problems.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-amber-300">
          {problems.map((p) => <li key={p}>• {p}</li>)}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-200 hover:bg-slate-700">
            ← Atrás
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={() => setStep(step + 1)} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-indigo-500">
            Siguiente →
          </button>
        ) : (
          <>
            <button type="button" disabled={problems.length > 0} onClick={() => onEdit(prompt)} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-black uppercase tracking-widest text-slate-200 hover:bg-slate-700 disabled:opacity-50">
              Revisar y editar
            </button>
            <button type="button" disabled={disabled || problems.length > 0} onClick={() => onUse(prompt)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-500 disabled:opacity-50">
              Crear mi libro
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default PromptPlanner;
