// Panel del equipo (admin/editor) para la Modalidad D: estados, asignación,
// propuesta, etapas con responsables y fechas, archivos privados, notas y
// confirmación de pagos verificados (solo admin). Todo lo valida la base de
// datos con RLS y RPC.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  addStaffNote,
  getEditorialOrderDetail,
  listAllEditorialOrders,
  listStaff,
  recordManualPayment,
  saveStage,
  setDeliverableVisibility,
  updateEditorialOrder,
  uploadDeliverable,
  type EditorialOrder,
  type EditorialOrderDetail,
  type StaffMember,
} from "../../src/data/editorialRepo";
import EditorialQuoteCalculator from "./EditorialQuoteCalculator";
import PricingAdmin from "./PricingAdmin";
import PaymentsAdmin from "./PaymentsAdmin";
import { EDITORIAL_STAGES, EDITORIAL_STATUS_CODES, formatAmount, stageLabel } from "../../src/lib/commercial/editorialStatus";

const input = "w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-100";
const btn = "rounded-lg px-3 py-2 text-xs font-black uppercase tracking-widest transition disabled:opacity-50";
const box = "rounded-2xl border border-slate-800 bg-slate-900 p-4";
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) : "");

const OrderAdmin: React.FC<{ orderId: string; isAdmin: boolean; staff: StaffMember[]; onBack: () => void }> = ({ orderId, isAdmin, staff, onBack }) => {
  const [d, setD] = useState<EditorialOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState({ amount: "", currency: "", terms: "" });
  const [note, setNote] = useState({ body: "", visible: true });
  const [pay, setPay] = useState({ amount: "", currency: "", reference: "", note: "" });
  const [file, setFile] = useState<{ file: File | null; stage: string; description: string; visible: boolean }>({ file: null, stage: "", description: "", visible: false });

  const load = useCallback(async () => {
    try {
      const detail = await getEditorialOrderDetail(orderId);
      setD(detail);
      setProposal({
        amount: detail.order.proposal_amount != null ? String(detail.order.proposal_amount) : "",
        currency: detail.order.proposal_currency ?? "",
        terms: detail.order.proposal_terms ?? "",
      });
      setPay((p) => ({ ...p, amount: detail.order.proposal_amount != null ? String(detail.order.proposal_amount) : p.amount, currency: detail.order.proposal_currency ?? p.currency }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [orderId]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const staffName = useMemo(() => new Map(staff.map((s) => [s.user_id, s.name || s.email || s.user_id.slice(0, 8)])), [staff]);
  if (!d) return <div className="text-sm text-slate-400">{error ?? "Cargando…"}</div>;
  const o = d.order;
  const stageRow = (code: string) => d.stages.find((s) => s.stage === code);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white">← Encargos</button>
      <div className={box}>
        <div className="text-2xl font-black text-white">{o.working_title || "Sin título"}</div>
        <div className="mt-1 text-sm text-slate-400">
          {o.contact_name} · {o.contact_email} · {o.contact_phone} · recibido {fmtDate(o.created_at)}
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-200">{o.idea}</p>
        <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
          {o.purpose && <div><b>Propósito:</b> {o.purpose}</div>}
          {o.audience && <div><b>Público:</b> {o.audience}</div>}
          {o.genre && <div><b>Tipo:</b> {o.genre}</div>}
          {Object.entries(o.details || {}).filter(([, v]) => v).map(([k, v]) => <div key={k}><b>{k}:</b> {String(v)}</div>)}
        </div>
      </div>

      <div className={`${box} grid gap-3 md:grid-cols-2`}>
        <div>
          <label className="text-xs font-black uppercase text-slate-400">Estado</label>
          <select className={input} value={o.status} disabled={busy} onChange={(e) => run(() => updateEditorialOrder(o.id, { status: e.target.value }))}>
            {EDITORIAL_STATUS_CODES.map((c) => <option key={c} value={c}>{stageLabel(c)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-black uppercase text-slate-400">Responsable</label>
          <select className={input} value={o.assigned_to ?? ""} disabled={busy} onChange={(e) => run(() => updateEditorialOrder(o.id, { assigned_to: e.target.value || null }))}>
            <option value="">Sin asignar</option>
            {staff.map((s) => <option key={`${s.user_id}-${s.role}`} value={s.user_id}>{staffName.get(s.user_id)} ({s.role})</option>)}
          </select>
        </div>
      </div>

      <div className={box}>
        <div className="text-xs font-black uppercase text-slate-400">Propuesta al cliente</div>
        <div className="mt-2">
          <EditorialQuoteCalculator
            onUse={(amount, summary) =>
              setProposal((p) => ({ amount: String(amount), currency: "USD", terms: p.terms.trim() ? p.terms : `Desglose estimado:\n${summary}` }))
            }
          />
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_120px]">
          <input className={input} type="number" min="0" step="0.01" placeholder="Importe" value={proposal.amount} onChange={(e) => setProposal({ ...proposal, amount: e.target.value })} />
          <input className={input} placeholder="Moneda (DOP, USD…)" value={proposal.currency} onChange={(e) => setProposal({ ...proposal, currency: e.target.value.toUpperCase() })} />
        </div>
        <textarea className={`${input} mt-2 min-h-[90px]`} placeholder="Alcance, plazos, revisiones incluidas, forma de pago…" value={proposal.terms} onChange={(e) => setProposal({ ...proposal, terms: e.target.value })} />
        <button
          type="button"
          disabled={busy || !Number(proposal.amount) || !proposal.currency.trim()}
          className={`${btn} mt-2 bg-amber-500 text-slate-950 hover:bg-amber-400`}
          onClick={() =>
            run(() =>
              updateEditorialOrder(o.id, {
                proposal_amount: Number(proposal.amount),
                proposal_currency: proposal.currency.trim(),
                proposal_terms: proposal.terms.trim() || null,
                proposal_sent_at: new Date().toISOString(),
                status: ["RECIBIDA", "EN_EVALUACION", "PROPUESTA_ENVIADA"].includes(o.status) ? "PROPUESTA_ENVIADA" : o.status,
              })
            )
          }
        >
          Enviar propuesta
        </button>
        {o.client_approved_at && <div className="mt-2 text-xs font-bold text-emerald-300">Aprobada por el cliente el {fmtDate(o.client_approved_at)}</div>}
      </div>

      <div className={box}>
        <div className="text-xs font-black uppercase text-slate-400">Pagos</div>
        {d.payments.map((p) => (
          <div key={p.id} className="mt-2 text-sm text-slate-200">{formatAmount(p.amount, p.currency)} · {p.provider} · <b>{p.status}</b> {fmtDate(p.paid_at)}</div>
        ))}
        {!d.payments.length && <div className="mt-2 text-sm text-slate-500">Sin pagos registrados.</div>}
        {isAdmin && o.client_approved_at && !d.payments.some((p) => p.status === "PAID") && (
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <input className={input} type="number" min="0" step="0.01" placeholder="Importe recibido" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            <input className={input} placeholder="Moneda" value={pay.currency} onChange={(e) => setPay({ ...pay, currency: e.target.value.toUpperCase() })} />
            <input className={input} placeholder="Referencia bancaria" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
            <button
              type="button"
              disabled={busy || !Number(pay.amount) || !pay.currency.trim() || !pay.reference.trim()}
              className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}
              onClick={() => {
                if (!window.confirm("¿Verificaste el ingreso en el banco? Esto confirma el pago y contrata el proyecto.")) return;
                run(() => recordManualPayment({ orderId: o.id, amount: Number(pay.amount), currency: pay.currency.trim(), bankReference: pay.reference.trim(), note: pay.note }));
              }}
            >
              Confirmar pago verificado
            </button>
          </div>
        )}
      </div>

      <div className={box}>
        <div className="text-xs font-black uppercase text-slate-400">Etapas: responsables, fechas y notas internas</div>
        <div className="mt-2 space-y-2">
          {EDITORIAL_STAGES.slice(4).map((s) => {
            const row = stageRow(s.code);
            return (
              <div key={s.code} className="grid items-center gap-2 text-sm md:grid-cols-[160px_1fr_140px_1fr_auto]">
                <div className="font-bold text-slate-200">{s.label}</div>
                <select className={input} value={row?.assignee ?? ""} onChange={(e) => run(() => saveStage(o.id, s.code, { assignee: e.target.value || null }))}>
                  <option value="">—</option>
                  {staff.map((m) => <option key={`${s.code}-${m.user_id}-${m.role}`} value={m.user_id}>{staffName.get(m.user_id)}</option>)}
                </select>
                <input className={input} type="date" value={row?.due_date ?? ""} onChange={(e) => run(() => saveStage(o.id, s.code, { due_date: e.target.value || null }))} />
                <input className={input} defaultValue={row?.notes ?? ""} placeholder="Nota interna" onBlur={(e) => e.target.value !== (row?.notes ?? "") && run(() => saveStage(o.id, s.code, { notes: e.target.value || null }))} />
                <button type="button" className={`${btn} ${row?.completed_at ? "bg-emerald-700 text-white" : "bg-slate-800 text-slate-200"}`} onClick={() => run(() => saveStage(o.id, s.code, row?.completed_at ? { completed_at: null } : { started_at: row?.started_at ?? new Date().toISOString(), completed_at: new Date().toISOString() }))}>
                  {row?.completed_at ? "✓ Hecha" : "Marcar hecha"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className={box}>
        <div className="text-xs font-black uppercase text-slate-400">Archivos (privados)</div>
        {d.deliverables.map((f) => (
          <div key={f.id} className="mt-2 flex items-center justify-between gap-3 text-sm">
            <span>{f.file_name} <span className="text-slate-500">{f.stage ? `· ${stageLabel(f.stage)}` : ""} {f.description ? `· ${f.description}` : ""}</span></span>
            <button type="button" className={`${btn} ${f.visible_to_client ? "bg-emerald-700 text-white" : "bg-slate-800 text-slate-300"}`} onClick={() => run(() => setDeliverableVisibility(f.id, !f.visible_to_client))}>
              {f.visible_to_client ? "Visible al cliente" : "Solo equipo"}
            </button>
          </div>
        ))}
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_160px_1fr_auto_auto]">
          <input className={input} type="file" onChange={(e) => setFile({ ...file, file: e.target.files?.[0] ?? null })} />
          <select className={input} value={file.stage} onChange={(e) => setFile({ ...file, stage: e.target.value })}>
            <option value="">Etapa</option>
            {EDITORIAL_STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          <input className={input} placeholder="Descripción" value={file.description} onChange={(e) => setFile({ ...file, description: e.target.value })} />
          <label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={file.visible} onChange={(e) => setFile({ ...file, visible: e.target.checked })} /> Visible al cliente</label>
          <button type="button" disabled={busy || !file.file} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`} onClick={() => run(async () => {
            await uploadDeliverable({ orderId: o.id, file: file.file!, stage: file.stage || null, description: file.description, visibleToClient: file.visible });
            setFile({ file: null, stage: "", description: "", visible: false });
          })}>Subir</button>
        </div>
      </div>

      <div className={box}>
        <div className="text-xs font-black uppercase text-slate-400">Historial y notas</div>
        <ul className="mt-2 space-y-2 text-sm">
          {d.events.map((ev) => (
            <li key={ev.id} className="border-l-2 border-slate-700 pl-3">
              <span className="text-xs text-slate-500">{fmtDate(ev.created_at)} · {ev.kind}{ev.visible_to_client ? "" : " · interno"}</span>
              <div className="whitespace-pre-wrap text-slate-200">{ev.kind === "STATUS" ? `${stageLabel(ev.from_status ?? "")} → ${stageLabel(ev.to_status ?? "")}` : ev.body}</div>
            </li>
          ))}
        </ul>
        <textarea className={`${input} mt-3`} placeholder="Nota o mensaje" value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} />
        <div className="mt-2 flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={note.visible} onChange={(e) => setNote({ ...note, visible: e.target.checked })} /> Visible al cliente</label>
          <button type="button" disabled={busy || !note.body.trim()} className={`${btn} bg-slate-700 text-white hover:bg-slate-600`} onClick={() => run(async () => {
            await addStaffNote(o.id, note.body.trim(), note.visible);
            setNote({ body: "", visible: true });
          })}>Guardar nota</button>
        </div>
      </div>
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
    </div>
  );
};

const AdminEditorialPanel: React.FC<{ isAdmin: boolean; onBack: () => void }> = ({ isAdmin, onBack }) => {
  const [orders, setOrders] = useState<EditorialOrder[] | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"orders" | "pricing" | "payments">("orders");

  useEffect(() => {
    listStaff().then(setStaff).catch(() => setStaff([]));
  }, []);
  useEffect(() => {
    if (openId) return;
    setOrders(null);
    listAllEditorialOrders(filter || undefined)
      .then(setOrders)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [filter, openId]);

  return (
    <div className="min-h-full bg-slate-950 px-5 py-8 text-slate-100 md:px-10">
      <div className="mx-auto max-w-5xl">
        {openId ? (
          <OrderAdmin orderId={openId} isAdmin={isAdmin} staff={staff} onBack={() => setOpenId(null)} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={onBack} className={`${btn} bg-slate-800 text-slate-200`}>← Volver</button>
              <h1 className="text-3xl font-black text-white">{tab === "pricing" ? "Precios" : tab === "payments" ? "Pagos" : "Encargos editoriales"}</h1>
              {isAdmin && (
                <div className="flex gap-1">
                  <button type="button" onClick={() => setTab("orders")} className={`${btn} ${tab === "orders" ? "bg-emerald-700 text-white" : "bg-slate-800 text-slate-300"}`}>Encargos</button>
                  <button type="button" onClick={() => setTab("pricing")} className={`${btn} ${tab === "pricing" ? "bg-emerald-700 text-white" : "bg-slate-800 text-slate-300"}`}>Precios</button>
                  <button type="button" onClick={() => setTab("payments")} className={`${btn} ${tab === "payments" ? "bg-emerald-700 text-white" : "bg-slate-800 text-slate-300"}`}>Pagos</button>
                </div>
              )}
              {tab === "orders" && <select className={`${input} ml-auto w-auto`} value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">Todos los estados</option>
                {EDITORIAL_STATUS_CODES.map((c) => <option key={c} value={c}>{stageLabel(c)}</option>)}
              </select>}
            </div>
            {tab === "payments" && isAdmin ? <div className="mt-6"><PaymentsAdmin /></div> : tab === "pricing" && isAdmin ? <div className="mt-6"><PricingAdmin /></div> : <>
            {error && <div className="mt-4 text-sm text-red-300">{error}</div>}
            {!orders && !error && <div className="mt-6 text-sm text-slate-400">Cargando…</div>}
            {orders && !orders.length && <div className="mt-6 text-sm text-slate-400">No hay encargos.</div>}
            <ul className="mt-6 space-y-2">
              {orders?.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => setOpenId(o.id)} className="grid w-full gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3 text-left text-sm hover:border-emerald-400/40 md:grid-cols-[1fr_180px_160px]">
                    <span className="font-bold text-white">{o.working_title || o.idea.slice(0, 70)}<span className="block text-xs font-normal text-slate-400">{o.contact_name} · {o.contact_email}</span></span>
                    <span className="text-amber-200">{stageLabel(o.status)}</span>
                    <span className="text-slate-400">{fmtDate(o.updated_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
            </>}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminEditorialPanel;
