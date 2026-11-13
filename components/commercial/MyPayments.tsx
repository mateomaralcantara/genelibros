// Mis pagos: saldo de créditos y pedidos (pendientes, pagados…).

import React, { useCallback, useEffect, useState } from "react";
import {
  PAYMENT_STATUS_LABELS,
  cancelPaymentOrder,
  getMyCreditBalance,
  listMyPayments,
  reportTransfer,
  type PaymentOrder,
} from "../../src/data/paymentsRepo";

const PURPOSE: Record<PaymentOrder["purpose"], string> = {
  BOOK: "Libro",
  CREDITS: "Créditos",
  SUBSCRIPTION: "Suscripción",
  EDITORIAL_ORDER: "Servicio editorial",
};
const PROVIDER: Record<string, string> = { PAYPAL: "PayPal", MANUAL_TRANSFER: "Transferencia" };
const btn = "rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-widest transition disabled:opacity-50";
const STATUS_COLOR: Record<string, string> = { PAID: "text-emerald-300", PENDING: "text-amber-200", FAILED: "text-red-300", CANCELLED: "text-slate-500" };

const PendingTransfer: React.FC<{ p: PaymentOrder; onChange: () => void }> = ({ p, onChange }) => {
  const [ref, setRef] = useState(p.transfer_reference ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <input className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs" placeholder="Referencia de tu transferencia" value={ref} onChange={(e) => setRef(e.target.value)} />
      <button type="button" disabled={busy || !ref.trim() || ref === p.transfer_reference} className={`${btn} bg-amber-500 text-slate-950`} onClick={async () => { setBusy(true); try { await reportTransfer(p.id, ref); onChange(); } finally { setBusy(false); } }}>
        Enviar referencia
      </button>
      <button type="button" disabled={busy} className={`${btn} bg-slate-800 text-slate-300`} onClick={async () => { if (!confirm("¿Cancelar este pedido?")) return; setBusy(true); try { await cancelPaymentOrder(p.id); onChange(); } finally { setBusy(false); } }}>
        Cancelar
      </button>
    </div>
  );
};

const MyPayments: React.FC = () => {
  const [items, setItems] = useState<PaymentOrder[] | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([listMyPayments(), getMyCreditBalance()])
      .then(([p, b]) => {
        setItems(p);
        setBalance(b);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="text-3xl font-black text-white">Mis pagos</h2>
      <div className="mt-4 inline-block rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3">
        <div className="text-[10px] font-black uppercase tracking-widest text-amber-200">Saldo de créditos</div>
        <div className="text-3xl font-black text-white">{balance == null ? "…" : balance.toLocaleString("es-DO")}</div>
      </div>
      {error && <div className="mt-4 text-sm text-red-300">{error}</div>}
      {items && !items.length && <p className="mt-6 text-sm text-slate-400">Todavía no tienes pagos.</p>}
      <ul className="mt-6 space-y-2">
        {items?.map((p) => (
          <li key={p.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-black text-white">{PURPOSE[p.purpose]}{p.catalog_code ? ` · ${p.catalog_code}` : ""}</span>
              <span className="text-amber-200">{p.currency} {p.amount.toFixed(2)}</span>
              <span className="text-slate-400">{PROVIDER[p.provider ?? ""] ?? p.provider}</span>
              <span className={`ml-auto font-bold ${STATUS_COLOR[p.status] ?? "text-slate-300"}`}>{PAYMENT_STATUS_LABELS[p.status]}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {new Date(p.created_at).toLocaleString("es-DO")}
              {p.credits ? ` · ${p.credits} créditos` : ""}
              {p.transfer_reference ? ` · Ref. ${p.transfer_reference}` : ""}
            </div>
            {p.status === "PENDING" && p.provider === "MANUAL_TRANSFER" && (
              <>
                <p className="mt-2 text-xs text-amber-100">{p.transfer_reference ? "Estamos verificando tu transferencia." : "Cuando transfieras, escribe la referencia para que podamos verificarla."}</p>
                <PendingTransfer p={p} onChange={load} />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default MyPayments;
