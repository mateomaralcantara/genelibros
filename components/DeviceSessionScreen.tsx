// Pantalla que aparece cuando la cuenta ya está activa en otro dispositivo.

import React from "react";
import { formatSessionDate, type DeviceConflictInfo } from "../src/lib/deviceSession";

export type DeviceSessionScreenProps = {
  email: string;
  busy?: boolean;
  error?: string | null;
  notice?: string | null;
  otherDevice?: DeviceConflictInfo | null;
  onEnterHere: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
};

export const DeviceSessionScreen: React.FC<DeviceSessionScreenProps> = ({
  email,
  busy,
  error,
  notice,
  otherDevice,
  onEnterHere,
  onRefresh,
  onSignOut,
}) => {
  const hasOtherDevice = Boolean(otherDevice);

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-7 shadow-2xl">
        <div className="text-center">
          <h1 className="text-5xl md:text-6xl font-black tracking-tight text-white">BestSeller</h1>
          <p className="mt-3 text-sm text-slate-300">
            Sesión aprobada para <span className="font-mono text-indigo-200">{email}</span>.
          </p>
        </div>

        <div
          className={`mt-6 rounded-2xl border p-4 text-center ${
            hasOtherDevice
              ? "border-amber-500/25 bg-amber-500/10"
              : "border-indigo-500/25 bg-indigo-500/10"
          }`}
        >
          <div className={`text-sm font-bold ${hasOtherDevice ? "text-amber-200" : "text-indigo-200"}`}>
            {hasOtherDevice
              ? "⚠️ Ya tienes una sesión activa en otro dispositivo."
              : busy
                ? "🔐 Validando este dispositivo…"
                : "🔐 Este dispositivo necesita activar sesión."}
          </div>

          <div className="mt-2 text-xs text-slate-300">
            La sesión se cierra automáticamente después de <span className="font-mono">30 minutos</span> sin actividad.
          </div>
        </div>

        {hasOtherDevice && (
          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-xs text-slate-300">
            <div className="font-black uppercase tracking-widest text-slate-400">Dispositivo activo</div>
            <div className="mt-2">
              <span className="text-slate-400">Nombre:</span>{" "}
              <span className="font-mono text-slate-100">{otherDevice?.active_device_label || "Otro dispositivo"}</span>
            </div>
            <div className="mt-1">
              <span className="text-slate-400">Última actividad:</span>{" "}
              <span className="font-mono text-slate-100">{formatSessionDate(otherDevice?.active_last_seen_at)}</span>
            </div>
            <p className="mt-3 text-amber-100/80">
              Puedes cerrar la sesión anterior y continuar aquí. Esto evita que una misma cuenta quede abierta en dos sitios a la vez.
            </p>
          </div>
        )}

        {notice && (
          <p className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-200">
            {notice}
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
            {error}
          </p>
        )}

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={hasOtherDevice ? onEnterHere : onRefresh}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? "Procesando…" : hasOtherDevice ? "Cerrar anterior y entrar" : "Activar dispositivo"}
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
