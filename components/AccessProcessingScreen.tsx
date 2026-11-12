// Pantalla para usuarios registrados cuya cuenta aún no ha sido aprobada
// (profiles.has_access = false).

import React from "react";

export type AccessProcessingScreenProps = {
  email: string;
  busy?: boolean;
  requestStatus?: string;
  error?: string | null;
  onRefresh: () => void;
  onSignOut: () => void;
};

export const AccessProcessingScreen: React.FC<AccessProcessingScreenProps> = ({
  email,
  busy,
  requestStatus,
  error,
  onRefresh,
  onSignOut,
}) => {
  const statusLabel = requestStatus || "PENDING";

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-7 shadow-2xl">
        <div className="text-center">
          <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white">BestSeller</h1>
          <p className="mt-3 text-sm text-slate-300">
            Tu cuenta <span className="font-mono text-indigo-200">{email}</span> está en revisión.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-center">
          <div className="text-amber-200 text-sm font-bold">
            ⏳ Procesando. Nos pondremos en contacto lo antes posible.
          </div>
          <div className="mt-2 text-xs text-amber-100/80">
            Gate activo: el usuario entra y solo pasa cuando <span className="font-mono">profiles.has_access = true</span>.
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-400 font-black uppercase tracking-widest">Estado de solicitud</span>
            <span
              className={`rounded-full px-3 py-1 font-black ${
                statusLabel === "APPROVED"
                  ? "bg-emerald-500/15 text-emerald-200 border border-emerald-500/25"
                  : statusLabel === "REJECTED"
                    ? "bg-red-500/15 text-red-200 border border-red-500/25"
                    : "bg-amber-500/15 text-amber-200 border border-amber-500/25"
              }`}
            >
              {statusLabel}
            </span>
          </div>

          {statusLabel === "APPROVED" && (
            <p className="mt-3 text-xs text-emerald-200">
              La solicitud aparece como aprobada. Si aún ves esta pantalla, confirma que <span className="font-mono">profiles.has_access</span> esté en <span className="font-mono">true</span> y presiona “Revisar acceso”.
            </p>
          )}

          {error && (
            <p className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onRefresh}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? "Revisando…" : "Revisar acceso"}
          </button>

          <button
            type="button"
            onClick={onSignOut}
            className="w-full rounded-xl bg-slate-800 px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-100 transition hover:bg-slate-700"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
};
