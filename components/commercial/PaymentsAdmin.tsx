// Panel de pagos (solo admin): transferencias por verificar, historial y
// configuración de métodos de pago (PayPal / transferencia + datos bancarios).

import React, { useCallback, useEffect, useState } from "react";
import {
  PAYMENT_STATUS_LABELS,
  confirmTransfer,
  getPaymentConfig,
  getPaymentMethods,
  listPaymentsForAdmin,
  rejectPayment,
  savePaymentMethods,
  type PaymentConfig,
  type PaymentMethods,
  type PaymentOrder,
} from "../../src/data/paymentsRepo";

const input = "w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100";
const btn = "rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest transition disabled:opacity-50";

type Row = PaymentOrder & { email: string | null };

const PendingRow: React.FC<{ p: Row; onDone: () => void; onError: (m: string) => void }> = ({ p, onDone, onError }) => {
  const [ref, setRef] = useState(p.transfer_reference ?? "");
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-xl border border-amber-400/30 bg-slate-900 p-4 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="font-black text-white">{p.email ?? p.user_id}</span>
        <span>{p.catalog_code ?? p.purpose}</span>
        <span className="font-black text-amber-200">{p.currency} {p.amount.toFixed(2)}</span>
        <span className="text-slate-400">{new Date(p.created_at).toLocaleString("es-DO")}</span>
      </div>
      <div className="mt-1 text-xs text-slate-400">Referencia informada por el cliente: {p.transfer_reference || "— (aún no la envía)"}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input className={`${input} max-w-xs`} placeholder="Referencia bancaria verificada" value={ref} onChange={(e) => setRef(e.target.value)} />
        <button
          type="button"
          disabled={busy || !ref.trim()}
          className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}
          onClick={() => {
            if (!confirm(`¿Confirmas que recibiste ${p.currency} ${p.amount.toFixed(2)} en tu cuenta? Se activará la compra.`)) return;
            act(() => confirmTransfer(p.id, ref.trim()));
          }}
        >
          Confirmar pago recibido
        </button>
        <button type="button" disabled={busy} className={`${btn} bg-slate-800 text-red-300`} onClick={() => confirm("¿Rechazar este pedido?") && act(() => rejectPayment(p.id))}>
          Rechazar
        </button>
      </div>
    </li>
  );
};

const PaymentsAdmin: React.FC = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, m, c] = await Promise.all([listPaymentsForAdmin(), getPaymentMethods(), getPaymentConfig()]);
      setRows(r);
      setMethods(m ?? { paypal_enabled: false, transfer_enabled: true, transfer_instructions: "" });
      setConfig(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const pending = rows?.filter((r) => r.status === "PENDING" && r.provider === "MANUAL_TRANSFER") ?? [];
  const history = rows?.filter((r) => !(r.status === "PENDING" && r.provider === "MANUAL_TRANSFER")) ?? [];

  return (
    <div className="space-y-8">
      {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">{notice}</div>}
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</div>}

      <section>
        <h3 className="mb-2 text-sm font-black uppercase tracking-widest text-amber-200">Transferencias por verificar ({pending.length})</h3>
        {!rows && <div className="text-sm text-slate-400">Cargando…</div>}
        {rows && !pending.length && <div className="text-sm text-slate-400">No hay transferencias pendientes.</div>}
        <ul className="space-y-2">
          {pending.map((p) => (
            <PendingRow key={p.id} p={p} onError={setError} onDone={() => { setNotice("Pago actualizado."); load(); }} />
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Confirma solo cuando veas el dinero en tu cuenta bancaria. Los pagos de encargos editoriales se confirman dentro de cada encargo.
        </p>
      </section>

      {methods && (
        <section>
          <h3 className="mb-2 text-sm font-black uppercase tracking-widest text-amber-200">Métodos de pago</h3>
          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={methods.paypal_enabled} onChange={(e) => setMethods({ ...methods, paypal_enabled: e.target.checked })} />
              PayPal y tarjeta
              <span className={`text-xs ${config?.paypal.env ? "text-emerald-300" : "text-amber-300"}`}>
                {config?.paypal.env ? `(credenciales configuradas · ${config.paypal.env})` : "(faltan PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET en Vercel)"}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={methods.transfer_enabled} onChange={(e) => setMethods({ ...methods, transfer_enabled: e.target.checked })} />
              Transferencia bancaria
            </label>
            <label className="block text-xs text-slate-400">
              Datos para la transferencia (los ve el cliente al pagar)
              <textarea className={`${input} mt-1 min-h-[120px]`} value={methods.transfer_instructions} onChange={(e) => setMethods({ ...methods, transfer_instructions: e.target.value })} />
            </label>
            <button type="button" className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`} onClick={async () => { setError(null); try { await savePaymentMethods(methods); setNotice("Métodos de pago guardados."); load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>
              Guardar métodos de pago
            </button>
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-black uppercase tracking-widest text-slate-400">Historial</h3>
        <table className="w-full text-xs">
          <tbody>
            {history.map((p) => (
              <tr key={p.id} className="border-t border-slate-800">
                <td className="py-1.5 text-slate-400">{new Date(p.created_at).toLocaleString("es-DO")}</td>
                <td className="py-1.5 text-slate-200">{p.email ?? p.user_id.slice(0, 8)}</td>
                <td className="py-1.5">{p.catalog_code ?? p.purpose}</td>
                <td className="py-1.5">{p.provider === "PAYPAL" ? "PayPal" : "Transferencia"}</td>
                <td className="py-1.5 text-right text-amber-200">{p.currency} {p.amount.toFixed(2)}</td>
                <td className="py-1.5 pl-3 text-right font-bold">{PAYMENT_STATUS_LABELS[p.status]}</td>
              </tr>
            ))}
            {rows && !history.length && (
              <tr><td className="py-2 text-slate-500">Sin pagos todavía.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
};

export default PaymentsAdmin;
