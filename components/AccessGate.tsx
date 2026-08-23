import React, { useState } from 'react';

export default function AccessGate(props: {
  email: string;
  request: any | null;
  onSubmit: (payload: { name: string; phone: string; transfer_reference: string; message: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [ref, setRef] = useState('');
  const [msg, setMsg] = useState('Hola, ya realicé la transferencia. Favor activar acceso.');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  const status = props.request?.status ?? null;

  return (
    <div className="min-h-screen w-full bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h1 className="text-3xl font-black">BestSeller</h1>
        <p className="text-sm text-slate-300 mt-2">
          Tu cuenta ({props.email}) aún no tiene acceso. Solicítalo y lo activamos manualmente al confirmar la transferencia.
        </p>

        {status === 'APPROVED' && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-sm">
            Acceso aprobado. Recarga la página.
          </div>
        )}

        {status === 'PENDING' && (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm">
            Solicitud enviada. Te contactaremos para confirmar pago y activar acceso.
          </div>
        )}

        {(!status || status === 'REJECTED') && (
          <div className="mt-5 space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre"
              className="w-full bg-slate-950/60 border border-slate-700 rounded-xl px-3 py-2 text-sm" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Teléfono / WhatsApp"
              className="w-full bg-slate-950/60 border border-slate-700 rounded-xl px-3 py-2 text-sm" />
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Referencia de transferencia"
              className="w-full bg-slate-950/60 border border-slate-700 rounded-xl px-3 py-2 text-sm" />
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Mensaje"
              className="w-full bg-slate-950/60 border border-slate-700 rounded-xl px-3 py-2 text-sm min-h-[110px]" />

            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setOk(false);
                try {
                  await props.onSubmit({ name, phone, transfer_reference: ref, message: msg });
                  setOk(true);
                } finally {
                  setBusy(false);
                }
              }}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-black text-xs uppercase tracking-widest disabled:opacity-60"
            >
              {busy ? 'Enviando…' : 'Solicitar acceso'}
            </button>

            {ok && (
              <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded p-3">
                Listo. Te contactamos para confirmar pago y activar tu cuenta.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}