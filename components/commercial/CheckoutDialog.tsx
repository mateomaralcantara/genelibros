// Ventana de pago: PayPal o transferencia bancaria.
// El pago con PayPal se confirma en el servidor (captura); la transferencia
// queda pendiente hasta que un administrador la verifica.

import React, { useEffect, useRef, useState } from "react";
import {
  createTransferOrder,
  getPaymentConfig,
  getPaymentMethods,
  paypalCapture,
  paypalCreate,
  reportTransfer,
  type PaymentConfig,
  type PaymentMethods,
} from "../../src/data/paymentsRepo";
import { formatUsd } from "../../src/lib/commercial/pricing";

export type CheckoutTarget =
  | { type: "catalog"; code: string; name: string; amountUsd: number; credits?: number | null }
  | { type: "editorial"; editorialOrderId: string; name: string; amount: number; currency: string };

const btn = "rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-widest transition disabled:opacity-50";
const input = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100";

declare global {
  interface Window {
    paypal?: any;
  }
}

let sdkPromise: Promise<void> | null = null;
let sdkClientId: string | null = null;
function loadPaypalSdk(clientId: string): Promise<void> {
  if (sdkPromise && sdkClientId === clientId) return sdkPromise;
  sdkClientId = clientId;
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("No se pudo cargar PayPal"));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

const PaypalButtons: React.FC<{ clientId: string; target: CheckoutTarget; onPaid: () => void; onError: (m: string) => void; onPending: () => void }> = ({
  clientId,
  target,
  onPaid,
  onError,
  onPending,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let buttons: any = null;
    loadPaypalSdk(clientId)
      .then(() => {
        if (cancelled || !ref.current || !window.paypal) return;
        buttons = window.paypal.Buttons({
          style: { layout: "vertical", shape: "rect", label: "pay" },
          createOrder: () => paypalCreate(target.type === "catalog" ? { code: target.code } : { editorialOrderId: target.editorialOrderId }),
          onApprove: async (data: any) => {
            try {
              const status = await paypalCapture(data.orderID);
              if (status === "PAID") onPaid();
              else onPending();
            } catch (e) {
              onError(e instanceof Error ? e.message : String(e));
            }
          },
          onError: (err: any) => onError(err?.message || "PayPal no pudo procesar el pago."),
        });
        buttons.render(ref.current);
      })
      .catch((e) => onError(e.message));
    return () => {
      cancelled = true;
      try {
        buttons?.close?.();
      } catch {
        /* nada */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  return <div ref={ref} className="min-h-[120px] rounded-xl bg-white p-3" />;
};

const CheckoutDialog: React.FC<{ target: CheckoutTarget; onClose: () => void; onViewPayments?: () => void }> = ({ target, onClose, onViewPayments }) => {
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [tab, setTab] = useState<"paypal" | "transfer">("paypal");
  const [state, setState] = useState<"idle" | "paid" | "pending" | "transfer_requested" | "transfer_reported">("idle");
  const [error, setError] = useState<string | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([getPaymentConfig(), getPaymentMethods()]).then(([c, m]) => {
      setConfig(c);
      setMethods(m);
      const paypalOk = c.paypal.enabled && !!c.paypal.clientId && (target.type === "catalog" || target.currency === "USD");
      setTab(paypalOk ? "paypal" : "transfer");
    });
  }, [target]);

  const amountLabel = target.type === "catalog" ? formatUsd(target.amountUsd) : `${target.currency} ${target.amount.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`;
  const paypalOk = !!config?.paypal.enabled && !!config.paypal.clientId && (target.type === "catalog" || target.currency === "USD");
  const transferOk = !!methods?.transfer_enabled;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-6 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-slate-400">Pagar</div>
            <div className="mt-1 text-xl font-black text-white">{target.name}</div>
            <div className="mt-1 text-3xl font-black text-amber-200">{amountLabel}</div>
            {target.type === "catalog" && target.credits ? <div className="text-xs text-slate-400">Incluye {target.credits.toLocaleString("es-DO")} créditos</div> : null}
          </div>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-white" aria-label="Cerrar">×</button>
        </div>

        {state === "paid" && (
          <div className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            <div className="text-lg font-black">¡Pago confirmado!</div>
            {target.type === "catalog" ? "Tu cuenta está activa y los créditos ya están en tu saldo." : "Tu encargo queda contratado; el equipo empieza a trabajar."}
          </div>
        )}
        {state === "pending" && (
          <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            PayPal aún está procesando el cobro. Lo confirmaremos automáticamente en cuanto PayPal lo apruebe; puedes verlo en «Mis pagos».
          </div>
        )}

        {state !== "paid" && state !== "pending" && (
          <>
            {!config ? (
              <div className="mt-6 text-sm text-slate-400">Cargando métodos de pago…</div>
            ) : !paypalOk && !transferOk ? (
              <div className="mt-6 text-sm text-slate-300">Los pagos aún no están activos. Escríbenos y te ayudamos.</div>
            ) : (
              <>
                <div className="mt-6 flex gap-2">
                  {paypalOk && (
                    <button type="button" onClick={() => setTab("paypal")} className={`${btn} flex-1 ${tab === "paypal" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300"}`}>
                      PayPal o tarjeta
                    </button>
                  )}
                  {transferOk && (
                    <button type="button" onClick={() => setTab("transfer")} className={`${btn} flex-1 ${tab === "transfer" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300"}`}>
                      Transferencia
                    </button>
                  )}
                </div>

                {tab === "paypal" && paypalOk && (
                  <div className="mt-4">
                    <PaypalButtons
                      clientId={config.paypal.clientId!}
                      target={target}
                      onPaid={() => setState("paid")}
                      onPending={() => setState("pending")}
                      onError={setError}
                    />
                    <p className="mt-2 text-[11px] text-slate-500">Pago seguro procesado por PayPal. No guardamos los datos de tu tarjeta.</p>
                  </div>
                )}

                {tab === "transfer" && transferOk && (
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-900 p-4 text-slate-200">{methods?.transfer_instructions}</div>
                    {target.type === "editorial" ? (
                      <p className="text-slate-300">
                        Transfiere <b>{amountLabel}</b> y envíanos el comprobante por el chat del encargo. El equipo lo verifica y
                        activa tu proyecto.
                      </p>
                    ) : state === "idle" ? (
                      <button type="button" disabled={busy} onClick={() => run(async () => { setTransferId(await createTransferOrder(target.code)); setState("transfer_requested"); })} className={`${btn} w-full bg-amber-500 text-slate-950 hover:bg-amber-400`}>
                        Pagaré por transferencia
                      </button>
                    ) : state === "transfer_requested" ? (
                      <div className="space-y-2">
                        <p className="text-slate-300">
                          Transfiere exactamente <b>{amountLabel}</b> y escribe aquí el número de referencia o confirmación de tu banco.
                        </p>
                        <input className={input} placeholder="Referencia de la transferencia" value={reference} onChange={(e) => setReference(e.target.value)} />
                        <button type="button" disabled={busy || !reference.trim()} onClick={() => run(async () => { await reportTransfer(transferId!, reference); setState("transfer_reported"); })} className={`${btn} w-full bg-amber-500 text-slate-950 hover:bg-amber-400`}>
                          Ya transferí
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-100">
                        Recibido. Verificaremos tu transferencia y activaremos tu compra; normalmente en menos de 24 horas laborables.
                        Puedes seguir el estado en «Mis pagos».
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {error && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</div>}

        <div className="mt-6 flex justify-end gap-2">
          {onViewPayments && (
            <button type="button" onClick={onViewPayments} className={`${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`}>
              Mis pagos
            </button>
          )}
          <button type="button" onClick={onClose} className={`${btn} bg-slate-800 text-slate-200 hover:bg-slate-700`}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default CheckoutDialog;
