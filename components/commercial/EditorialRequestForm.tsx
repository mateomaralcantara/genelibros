// Modalidad D — formulario inicial del encargo editorial.

import React, { useState } from "react";
import { createEditorialOrder } from "../../src/data/editorialRepo";

const input =
  "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none";
const label = "block text-xs font-black uppercase tracking-widest text-slate-400";

const EditorialRequestForm: React.FC<{ onCancel: () => void; onCreated: () => void }> = ({ onCancel, onCreated }) => {
  const [f, setF] = useState({
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    working_title: "",
    idea: "",
    purpose: "",
    audience: "",
    genre: "",
    length: "",
    tone: "",
    deadline: "",
    references: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!f.contact_name.trim() || !f.contact_email.trim() || !f.idea.trim()) {
      setError("Necesitamos tu nombre, tu email y tu idea para el libro.");
      return;
    }
    setBusy(true);
    try {
      await createEditorialOrder({
        contact_name: f.contact_name.trim(),
        contact_email: f.contact_email.trim(),
        contact_phone: f.contact_phone.trim(),
        working_title: f.working_title.trim() || undefined,
        idea: f.idea.trim(),
        purpose: f.purpose.trim() || undefined,
        audience: f.audience.trim() || undefined,
        genre: f.genre || undefined,
        details: {
          length: f.length.trim() || null,
          tone: f.tone.trim() || null,
          desired_deadline: f.deadline || null,
          references: f.references.trim() || null,
        },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-5">
      <button type="button" onClick={onCancel} className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white">
        ← Volver
      </button>
      <h2 className="text-3xl font-black text-white">Cuéntanos tu libro</h2>
      <p className="text-sm text-slate-400">No necesitas tenerlo todo claro: un asesor editorial te ayudará a definirlo.</p>

      <div className="grid gap-4 md:grid-cols-3">
        <div><label className={label}>Nombre *</label><input className={input} value={f.contact_name} onChange={set("contact_name")} /></div>
        <div><label className={label}>Email *</label><input type="email" className={input} value={f.contact_email} onChange={set("contact_email")} /></div>
        <div><label className={label}>WhatsApp / teléfono</label><input className={input} value={f.contact_phone} onChange={set("contact_phone")} /></div>
      </div>

      <div><label className={label}>Título provisional</label><input className={input} value={f.working_title} onChange={set("working_title")} placeholder="Si ya tienes uno" /></div>
      <div>
        <label className={label}>Tu idea, historia o conocimiento *</label>
        <textarea className={`${input} min-h-[140px]`} value={f.idea} onChange={set("idea")} placeholder="¿De qué trata? ¿Qué quieres contar o enseñar?" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div><label className={label}>Propósito del libro</label><textarea className={input} value={f.purpose} onChange={set("purpose")} placeholder="Inspirar, enseñar, dejar un legado, posicionar tu marca…" /></div>
        <div><label className={label}>Público objetivo</label><textarea className={input} value={f.audience} onChange={set("audience")} placeholder="¿Quién lo va a leer?" /></div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className={label}>Tipo de libro</label>
          <select className={input} value={f.genre} onChange={set("genre")}>
            <option value="">Sin decidir</option>
            <option value="NO_FICCION">No ficción / divulgación</option>
            <option value="AUTOBIOGRAFIA">Autobiografía o memorias</option>
            <option value="NEGOCIOS">Negocios o desarrollo profesional</option>
            <option value="NOVELA">Novela o ficción</option>
            <option value="ACADEMICO">Académico o técnico</option>
            <option value="OTRO">Otro</option>
          </select>
        </div>
        <div><label className={label}>Extensión aproximada</label><input className={input} value={f.length} onChange={set("length")} placeholder="Ej.: 120 páginas, 12 capítulos" /></div>
        <div><label className={label}>Fecha deseada</label><input type="date" className={input} value={f.deadline} onChange={set("deadline")} /></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div><label className={label}>Tono o estilo</label><input className={input} value={f.tone} onChange={set("tone")} placeholder="Cercano, académico, inspirador…" /></div>
        <div><label className={label}>Referencias o materiales</label><input className={input} value={f.references} onChange={set("references")} placeholder="Libros que te gustan, documentos que tienes…" /></div>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      <button type="submit" disabled={busy} className="rounded-xl bg-amber-500 px-5 py-3 text-xs font-black uppercase tracking-widest text-slate-950 hover:bg-amber-400 disabled:opacity-50">
        {busy ? "Enviando…" : "Enviar solicitud"}
      </button>
    </form>
  );
};

export default EditorialRequestForm;
