// Modalidad D — panel del cliente: progreso, propuesta, comentarios, ajustes
// y descarga de entregables. Las acciones las valida la base de datos.

import React, { useCallback, useEffect, useState } from "react";
import CheckoutDialog, { type CheckoutTarget } from "./CheckoutDialog";
import {
  addClientComment,
  approveProposal,
  deliverableUrl,
  getEditorialOrderDetail,
  listMyEditorialOrders,
  requestChanges,
  type EditorialOrder,
  type EditorialOrderDetail,
} from "../../src/data/editorialRepo";
import {
  EDITORIAL_STAGES,
  canClientApprove,
  canClientRequestChanges,
  formatAmount,
  progressPercent,
  stageClientText,
  stageIndex,
  stageLabel,
} from "../../src/lib/commercial/editorialStatus";

const btn = "rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition disabled:opacity-50";
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" }) : "");

const OrderDetail: React.FC<{ orderId: string; onBack: () => void }> = ({ orderId, onBack }) => {
  const [detail, setDetail] = useState<EditorialOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [checkout, setCheckout] = useState<CheckoutTarget | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await getEditorialOrderDetail(orderId));
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
      setText("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!detail) return <div className="text-sm text-slate-400">{error ?? "Cargando…"}</div>;
  const { order, events, deliverables, payments } = detail;
  const current = stageIndex(order.status);
  const paid = payments.some((p) => p.status === "PAID");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <button type="button" onClick={onBack} className="text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white">
        ← Mis encargos
      </button>
      <div>
        <h2 className="text-3xl font-black text-white">{order.working_title || "Mi libro"}</h2>
        <p className="mt-1 text-sm text-slate-400">Solicitado el {fmtDate(order.created_at)}</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-black text-amber-200">{stageLabel(order.status)}</span>
          <span className="text-slate-400">{progressPercent(order.status)} %</span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-slate-800">
          <div className="h-2 rounded-full bg-amber-400" style={{ width: `${progressPercent(order.status)}%` }} />
        </div>
        <p className="mt-3 text-sm text-slate-300">{stageClientText(order.status)}</p>
        <ol className="mt-4 grid gap-1 text-xs md:grid-cols-2">
          {EDITORIAL_STAGES.map((s, i) => (
            <li key={s.code} className={i < current ? "text-emerald-300" : i === current ? "font-black text-amber-200" : "text-slate-500"}>
              {i < current ? "✓" : i === current ? "●" : "○"} {s.label}
            </li>
          ))}
        </ol>
      </div>

      {order.proposal_amount != null && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5">
          <div className="text-xs font-black uppercase tracking-widest text-amber-200">Propuesta de trabajo</div>
          <div className="mt-2 text-2xl font-black text-white">{formatAmount(order.proposal_amount, order.proposal_currency)}</div>
          {order.proposal_terms && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{order.proposal_terms}</p>}
          {canClientApprove(order) && (
            <button type="button" disabled={busy} onClick={() => run(() => approveProposal(order.id))} className={`${btn} mt-4 bg-amber-500 text-slate-950 hover:bg-amber-400`}>
              Aprobar propuesta
            </button>
          )}
          {order.client_approved_at && !paid && (
            <>
              <p className="mt-3 text-sm text-amber-100">
                Aprobaste la propuesta el {fmtDate(order.client_approved_at)}. El proyecto comienza cuando confirmemos el pago.
              </p>
              {order.status === "PENDIENTE_APROBACION" && (
                <button
                  type="button"
                  onClick={() =>
                    setCheckout({
                      type: "editorial",
                      editorialOrderId: order.id,
                      name: order.working_title || "Servicio editorial",
                      amount: Number(order.proposal_amount),
                      currency: String(order.proposal_currency || "USD").toUpperCase(),
                    })
                  }
                  className={`${btn} mt-3 bg-amber-500 text-slate-950 hover:bg-amber-400`}
                >
                  Pagar ahora
                </button>
              )}
            </>
          )}
          {checkout && <CheckoutDialog target={checkout} onClose={() => { setCheckout(null); load(); }} />}
          {paid && <p className="mt-3 text-sm font-bold text-emerald-300">Pago confirmado.</p>}
        </div>
      )}

      {deliverables.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="text-xs font-black uppercase tracking-widest text-slate-400">Archivos</div>
          <ul className="mt-3 space-y-2">
            {deliverables.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {d.file_name}
                  {d.description && <span className="text-slate-400"> — {d.description}</span>}
                </span>
                <button
                  type="button"
                  className={`${btn} bg-slate-800 text-slate-100 hover:bg-slate-700`}
                  onClick={() => run(async () => void window.open(await deliverableUrl(d.file_path), "_blank", "noopener"))}
                >
                  Descargar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="text-xs font-black uppercase tracking-widest text-slate-400">Historial</div>
        <ul className="mt-3 space-y-3 text-sm">
          {events.map((ev) => (
            <li key={ev.id} className="border-l-2 border-slate-700 pl-3">
              <div className="text-xs text-slate-500">{fmtDate(ev.created_at)}</div>
              {ev.kind === "STATUS" ? (
                <div className="text-slate-200">Etapa: {stageLabel(ev.to_status ?? "")}</div>
              ) : (
                <div className="whitespace-pre-wrap text-slate-200">{ev.body}</div>
              )}
            </li>
          ))}
          {!events.length && <li className="text-slate-500">Aún no hay movimientos.</li>}
        </ul>
        <textarea
          className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          placeholder={canClientRequestChanges(order) ? "Describe los ajustes que necesitas…" : "Escribe un mensaje al equipo…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy || !text.trim()} onClick={() => run(() => addClientComment(order.id, text))} className={`${btn} bg-slate-700 text-white hover:bg-slate-600`}>
            Enviar mensaje
          </button>
          {canClientRequestChanges(order) && (
            <button type="button" disabled={busy || !text.trim()} onClick={() => run(() => requestChanges(order.id, text))} className={`${btn} bg-amber-500 text-slate-950 hover:bg-amber-400`}>
              Pedir ajustes
            </button>
          )}
        </div>
      </div>
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
    </div>
  );
};

const MyEditorialOrders: React.FC<{ onNewRequest: () => void }> = ({ onNewRequest }) => {
  const [orders, setOrders] = useState<EditorialOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (openId) return;
    listMyEditorialOrders()
      .then(setOrders)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [openId]);

  if (openId) return <OrderDetail orderId={openId} onBack={() => setOpenId(null)} />;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-black text-white">Mis encargos editoriales</h2>
        <button type="button" onClick={onNewRequest} className={`${btn} bg-amber-500 text-slate-950 hover:bg-amber-400`}>
          Nuevo encargo
        </button>
      </div>
      {error && <div className="mt-4 text-sm text-red-300">{error}</div>}
      {!orders && !error && <div className="mt-6 text-sm text-slate-400">Cargando…</div>}
      {orders && !orders.length && <div className="mt-6 text-sm text-slate-400">Todavía no has encargado ningún libro.</div>}
      <ul className="mt-6 space-y-3">
        {orders?.map((o) => (
          <li key={o.id}>
            <button type="button" onClick={() => setOpenId(o.id)} className="w-full rounded-2xl border border-slate-800 bg-slate-900 p-4 text-left hover:border-amber-400/40">
              <div className="flex items-center justify-between gap-3">
                <span className="font-black text-white">{o.working_title || o.idea.slice(0, 60)}</span>
                <span className="text-xs font-black text-amber-200">{stageLabel(o.status)}</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-slate-800">
                <div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${progressPercent(o.status)}%` }} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default MyEditorialOrders;
