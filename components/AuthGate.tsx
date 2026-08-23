// components/AuthGate.tsx
import React from "react";
import { PenSquareIcon } from "./Icons";

export type AuthMode = "signin" | "signup";

export const AuthScreen: React.FC<{
  buildTag: string;
  mode: AuthMode;
  onMode: (m: AuthMode) => void;

  email: string;
  setEmail: (s: string) => void;
  password: string;
  setPassword: (s: string) => void;

  fullName: string;
  setFullName: (s: string) => void;
  phone: string;
  setPhone: (s: string) => void;

  busy: boolean;
  onSubmit: () => void;

  error: string | null;
  notice: string | null;
}> = ({
  buildTag,
  mode,
  onMode,
  email,
  setEmail,
  password,
  setPassword,
  fullName,
  setFullName,
  phone,
  setPhone,
  busy,
  onSubmit,
  error,
  notice,
}) => {
  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <PenSquareIcon className="w-8 h-8 text-indigo-400" />
          <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-white truncate">BestSeller</h1>
            <div className="text-[10px] text-slate-500 font-mono truncate">{buildTag}</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onMode("signin")}
            className={`py-2 rounded-xl text-xs font-black uppercase tracking-widest transition ${
              mode === "signin" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
            }`}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => onMode("signup")}
            className={`py-2 rounded-xl text-xs font-black uppercase tracking-widest transition ${
              mode === "signup" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
            }`}
          >
            Crear cuenta
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo"
            className="w-full bg-slate-950/60 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            autoComplete="email"
          />

          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="clave"
            type="password"
            className="w-full bg-slate-950/60 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />

          {mode === "signup" && (
            <>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nombre completo"
                className="w-full bg-slate-950/40 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                autoComplete="name"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="WhatsApp / Teléfono"
                className="w-full bg-slate-950/40 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                autoComplete="tel"
              />
            </>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={onSubmit}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-black text-xs uppercase tracking-widest transition-colors disabled:opacity-60"
          >
            {busy ? "Procesando…" : mode === "signin" ? "Entrar" : "Crear cuenta"}
          </button>

          {notice && (
            <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded p-3">
              {notice}
            </div>
          )}

          {error && (
            <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded p-3">{error}</div>
          )}
        </div>

        <div className="mt-4 text-[11px] text-slate-400 leading-snug">
          * Para que “Crear cuenta” entre directo a <b>Procesando</b>, en Supabase pon <b>Confirm email = OFF</b>.
        </div>
      </div>
    </div>
  );
};

export const ProcessingScreen: React.FC<{
  email: string;
  busy: boolean;
  requestStatus?: string;
  onRefresh: () => void;
  onSignOut: () => void;
}> = ({ email, busy, requestStatus, onRefresh, onSignOut }) => (
  <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-6">
    <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6">
      <h1 className="text-4xl md:text-5xl font-black tracking-tight text-center">BestSeller</h1>

      <p className="text-sm text-slate-300 mt-4 text-center">
        Cuenta en revisión: <span className="font-mono">{email}</span>
      </p>

      <div className="mt-5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm text-center">
        ⏳ Procesando. Nos comunicaremos con usted lo antes posible.
      </div>

      {requestStatus && (
        <div className="mt-3 text-[11px] text-slate-400 text-center">
          Estado: <span className="font-mono">{requestStatus}</span>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onRefresh}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-black text-xs uppercase tracking-widest transition-colors disabled:opacity-60"
        >
          {busy ? "Actualizando…" : "Actualizar estado"}
        </button>

        <button
          type="button"
          onClick={onSignOut}
          className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl font-black text-xs uppercase tracking-widest transition-colors"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  </div>
);
