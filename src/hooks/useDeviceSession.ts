// Sesión por dispositivo: 1 cuenta = 1 dispositivo activo.
// - Reclama la sesión al entrar (o avisa si hay otro dispositivo activo).
// - Cierra la sesión tras IDLE_TIMEOUT_MS sin actividad.
// - Envía un latido cada HEARTBEAT_MS; si otro dispositivo la reemplaza, sale.
// Las RPC viven en device_session_gate.sql.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { normalizeError } from "../lib/editor";
import {
  DEVICE_STORAGE_KEY,
  HEARTBEAT_MS,
  IDLE_TIMEOUT_MS,
  getDeviceLabel,
  getOrCreateDeviceId,
  type DeviceConflictInfo,
} from "../lib/deviceSession";

export type DeviceSessionState = {
  deviceAllowed: boolean;
  deviceBusy: boolean;
  deviceNotice: string | null;
  deviceError: string | null;
  otherDevice: DeviceConflictInfo | null;
  /** Reintenta reclamar la sesión en este dispositivo. */
  retry: () => void;
  /** Entra aquí cerrando la sesión del otro dispositivo. */
  enterHere: () => void;
  /** Revoca la sesión de este dispositivo (antes de cerrar sesión en Auth). */
  releaseDevice: () => Promise<void>;
  /** Limpia el estado local (p. ej. cuando Auth informa que no hay sesión). */
  resetDeviceState: () => void;
};

export function useDeviceSession(userId: string | null | undefined, hasAccess: boolean): DeviceSessionState {
  const [deviceId, setDeviceId] = useState("");
  const [deviceAllowed, setDeviceAllowed] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [otherDevice, setOtherDevice] = useState<DeviceConflictInfo | null>(null);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deviceAutoClaimAttemptedRef = useRef(false);

  const clearDeviceTimers = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const resetDeviceState = useCallback(() => {
    deviceAutoClaimAttemptedRef.current = false;
    setDeviceAllowed(false);
    setDeviceBusy(false);
    setDeviceNotice(null);
    setDeviceError(null);
    setOtherDevice(null);
  }, []);

  const releaseDevice = useCallback(async () => {
    clearDeviceTimers();

    try {
      const currentDeviceId = deviceId || (typeof window !== "undefined" ? window.localStorage.getItem(DEVICE_STORAGE_KEY) || "" : "");
      if (currentDeviceId) {
        await supabase.rpc("revoke_my_device_session", {
          p_device_id: currentDeviceId,
        });
      }
    } catch {
      // Si la RPC no existe o falla, igual cerramos Auth.
    }

    resetDeviceState();
  }, [clearDeviceTimers, deviceId, resetDeviceState]);

  const claimDeviceSession = useCallback(async (opts?: { force?: boolean }) => {
    if (!userId) return false;
    if (!hasAccess) return false;

    const force = Boolean(opts?.force);
    const nextDeviceId = deviceId || getOrCreateDeviceId();

    setDeviceId(nextDeviceId);
    setDeviceBusy(true);
    setDeviceError(null);
    setDeviceNotice(null);

    try {
      if (!force) {
        const { data: activeData, error: activeErr } = await supabase.rpc("get_active_device_session", {
          p_device_id: nextDeviceId,
        });

        if (activeErr) throw activeErr;

        const row = Array.isArray(activeData) ? activeData[0] : activeData;
        const hasOther = Boolean((row as any)?.has_other_active_device);

        if (hasOther) {
          setOtherDevice({
            active_device_label: (row as any)?.active_device_label ?? null,
            active_last_seen_at: (row as any)?.active_last_seen_at ?? null,
          });
          setDeviceAllowed(false);
          return false;
        }
      }

      const { error: claimErr } = await supabase.rpc("claim_device_session", {
        p_device_id: nextDeviceId,
        p_device_label: getDeviceLabel(),
        p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      });

      if (claimErr) throw claimErr;

      setOtherDevice(null);
      setDeviceAllowed(true);
      setDeviceNotice(force ? "Sesión anterior cerrada. Entraste en este dispositivo." : null);
      return true;
    } catch (e) {
      setDeviceAllowed(false);
      setDeviceError(`Device gate: ${normalizeError(e)}`);
      return false;
    } finally {
      setDeviceBusy(false);
    }
  }, [deviceId, hasAccess, userId]);

  const retry = useCallback(() => {
    deviceAutoClaimAttemptedRef.current = false;
    claimDeviceSession().catch((e) => setDeviceError(normalizeError(e)));
  }, [claimDeviceSession]);

  const enterHere = useCallback(() => {
    deviceAutoClaimAttemptedRef.current = false;
    claimDeviceSession({ force: true }).catch((e) => setDeviceError(normalizeError(e)));
  }, [claimDeviceSession]);

  // Reclamo automático (una vez) al tener sesión y acceso aprobado.
  useEffect(() => {
    if (!userId) return;
    if (!hasAccess) return;
    if (deviceAllowed) return;
    if (deviceBusy) return;
    if (deviceAutoClaimAttemptedRef.current) return;

    deviceAutoClaimAttemptedRef.current = true;
    claimDeviceSession().catch((e) => setDeviceError(`Device gate: ${normalizeError(e)}`));
  }, [claimDeviceSession, deviceAllowed, deviceBusy, hasAccess, userId]);

  // Cierre por inactividad.
  useEffect(() => {
    if (!userId || !hasAccess || !deviceAllowed || !deviceId) return;

    const signOutForInactivity = async () => {
      clearDeviceTimers();

      try {
        await supabase.rpc("revoke_my_device_session", {
          p_device_id: deviceId,
        });
      } catch {
        // Igual cerramos sesión local.
      }

      setDeviceAllowed(false);
      setDeviceNotice(null);
      setOtherDevice(null);
      setDeviceError("Sesión cerrada por 30 minutos sin actividad.");
      await supabase.auth.signOut();
    };

    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        signOutForInactivity().catch(() => {});
      }, IDLE_TIMEOUT_MS);
    };

    const events: Array<keyof WindowEventMap> = ["mousemove", "keydown", "click", "scroll", "touchstart"];

    resetIdleTimer();

    for (const eventName of events) {
      window.addEventListener(eventName, resetIdleTimer, { passive: true });
    }

    const onVisibilityChange = () => {
      if (!document.hidden) resetIdleTimer();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, resetIdleTimer);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [clearDeviceTimers, deviceAllowed, deviceId, hasAccess, userId]);

  // Latido: si otro dispositivo reemplaza la sesión, salimos.
  useEffect(() => {
    if (!userId || !hasAccess || !deviceAllowed || !deviceId) return;

    const heartbeat = async () => {
      try {
        const { data, error: touchErr } = await supabase.rpc("touch_device_session", {
          p_device_id: deviceId,
        });

        if (touchErr) throw touchErr;

        if (data !== true) {
          clearDeviceTimers();
          setDeviceAllowed(false);
          setDeviceError("Tu sesión venció o fue reemplazada por otro dispositivo.");
          await supabase.auth.signOut();
        }
      } catch (e) {
        setDeviceError(`Heartbeat: ${normalizeError(e)}`);
      }
    };

    heartbeatTimerRef.current = setInterval(() => {
      heartbeat().catch(() => {});
    }, HEARTBEAT_MS);

    heartbeat().catch(() => {});

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };
  }, [clearDeviceTimers, deviceAllowed, deviceId, hasAccess, userId]);

  return {
    deviceAllowed,
    deviceBusy,
    deviceNotice,
    deviceError,
    otherDevice,
    retry,
    enterHere,
    releaseDevice,
    resetDeviceState,
  };
}
