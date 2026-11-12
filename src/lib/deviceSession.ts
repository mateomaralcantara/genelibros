// Sesión por dispositivo: 1 cuenta = 1 dispositivo activo, caducidad por
// inactividad. Ver device_session_gate.sql.

export const DEVICE_STORAGE_KEY = "bestseller_device_id";
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const HEARTBEAT_MS = 60 * 1000;

export type DeviceConflictInfo = {
  active_device_label?: string | null;
  active_last_seen_at?: string | null;
};

export function createFallbackDeviceId(): string {
  return `dev_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return createFallbackDeviceId();

  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing && existing.trim().length >= 8) return existing;

  const next =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : createFallbackDeviceId();

  window.localStorage.setItem(DEVICE_STORAGE_KEY, next);
  return next;
}

export function getDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Dispositivo";
  const platform = navigator.platform || "Dispositivo";
  const language = navigator.language || "";
  return language ? `${platform} · ${language}` : platform;
}

export function formatSessionDate(value?: string | null): string {
  if (!value) return "reciente";
  try {
    return new Intl.DateTimeFormat("es", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
