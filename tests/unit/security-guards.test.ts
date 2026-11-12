import { beforeEach, describe, expect, it, vi } from "vitest";

// Supabase simulado: controla lo que devuelven getUser, profiles y la RPC de cuota.
const db = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | { has_access: boolean },
  profileError: null as null | { message: string },
  quota: { allowed: true } as any,
  quotaError: null as null | { message: string },
  rpcCalls: 0,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => (db.user ? { data: { user: db.user }, error: null } : { data: { user: null }, error: { message: "bad" } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: db.profile, error: db.profileError }),
        }),
      }),
    }),
    rpc: async () => {
      db.rpcCalls += 1;
      return { data: db.quota, error: db.quotaError };
    },
  }),
}));

import { requireUserOrWorker } from "../../src/server/request-auth";
import { guardPaidRequest, requireApprovedAccess } from "../../src/server/request-guard";
import { QuotaExceededError } from "../../src/server/rate-limit";
import { assertPublicUrl } from "../../src/server/safe-fetch";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const user = { kind: "user" as const, userId: USER_ID };

beforeEach(() => {
  db.user = null;
  db.profile = null;
  db.profileError = null;
  db.quota = { allowed: true };
  db.quotaError = null;
  db.rpcCalls = 0;
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  vi.stubEnv("OS4_WORKER_SECRET", "secreto-worker");
  vi.stubEnv("ACCESS_GATE_DISABLED", "");
  vi.stubEnv("ACCESS_GATE_FAIL_CLOSED", "");
  vi.stubEnv("RATE_LIMIT_FAIL_CLOSED", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("requireUserOrWorker", () => {
  it("rechaza peticiones sin sesión (401)", async () => {
    await expect(requireUserOrWorker({ headers: {} })).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rechaza tokens inválidos (401)", async () => {
    await expect(requireUserOrWorker({ headers: { authorization: "Bearer falso" } })).rejects.toMatchObject({ statusCode: 401 });
  });

  it("acepta un usuario con sesión válida", async () => {
    db.user = { id: USER_ID };
    await expect(requireUserOrWorker({ headers: { authorization: "Bearer bueno" } })).resolves.toEqual(user);
  });

  it("acepta un worker con el secreto correcto y rechaza uno incorrecto", async () => {
    await expect(requireUserOrWorker({ headers: { "x-worker-secret": "secreto-worker" } })).resolves.toEqual({ kind: "worker" });
    await expect(requireUserOrWorker({ headers: { "x-worker-secret": "otro" } })).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe("requireApprovedAccess", () => {
  it("bloquea a un usuario sin perfil o no aprobado (403)", async () => {
    await expect(requireApprovedAccess(user)).rejects.toMatchObject({ statusCode: 403 });
    db.profile = { has_access: false };
    await expect(requireApprovedAccess(user)).rejects.toMatchObject({ statusCode: 403, code: "ACCESS_NOT_APPROVED" });
  });

  it("deja pasar a un usuario aprobado", async () => {
    db.profile = { has_access: true };
    await expect(requireApprovedAccess(user)).resolves.toBeUndefined();
  });

  it("los workers no necesitan aprobación", async () => {
    await expect(requireApprovedAccess({ kind: "worker" })).resolves.toBeUndefined();
  });

  it("si la base no responde, deja pasar salvo con ACCESS_GATE_FAIL_CLOSED", async () => {
    db.profileError = { message: "timeout" };
    await expect(requireApprovedAccess(user)).resolves.toBeUndefined();
    vi.stubEnv("ACCESS_GATE_FAIL_CLOSED", "true");
    await expect(requireApprovedAccess(user)).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("guardPaidRequest (acceso + límite de uso)", () => {
  it("no consume cuota si el usuario no está aprobado", async () => {
    await expect(guardPaidRequest(user, "composer")).rejects.toMatchObject({ statusCode: 403 });
    expect(db.rpcCalls).toBe(0);
  });

  it("consume una unidad de cuota para un usuario aprobado", async () => {
    db.profile = { has_access: true };
    await guardPaidRequest(user, "composer");
    expect(db.rpcCalls).toBe(1);
  });

  it("devuelve 429 con Retry-After cuando se agota la cuota", async () => {
    db.profile = { has_access: true };
    db.quota = { allowed: false, scope: "hour", limit: 60, retry_after_seconds: 600 };
    const error = await guardPaidRequest(user, "composer").catch((e) => e);
    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error).toMatchObject({ statusCode: 429, retryAfterSeconds: 600 });
    expect(error.message).toMatch(/60 solicitudes por hora/);
  });

  it("los workers no consumen cuota", async () => {
    await guardPaidRequest({ kind: "worker" }, "composer");
    expect(db.rpcCalls).toBe(0);
  });

  it("si la función de cuota falla, deja pasar salvo con RATE_LIMIT_FAIL_CLOSED", async () => {
    db.profile = { has_access: true };
    db.quotaError = { message: "function does not exist" };
    await expect(guardPaidRequest(user, "research")).resolves.toBeUndefined();
    vi.stubEnv("RATE_LIMIT_FAIL_CLOSED", "true");
    await expect(guardPaidRequest(user, "research")).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("assertPublicUrl — protección SSRF", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://localhost/",
    "http://servicio.internal/",
  ])("bloquea %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow(/no permitido/i);
  });

  it.each([
    ["file:///etc/passwd", /http/],
    ["ftp://example.com/", /http/],
    ["https://user:clave@example.com/", /credenciales/],
    ["https://example.com:8443/", /Puerto/],
    ["no es una url", /inválida/],
  ])("rechaza %s", async (url, message) => {
    await expect(assertPublicUrl(url)).rejects.toThrow(message);
  });

  it("acepta una IP pública en puerto estándar", async () => {
    await expect(assertPublicUrl("https://8.8.8.8/")).resolves.toBeInstanceOf(URL);
  });
});
