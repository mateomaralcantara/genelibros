// Cliente mínimo de la API REST de PayPal (Orders v2 + verificación de webhooks).
// Documentación oficial:
//   https://developer.paypal.com/docs/api/orders/v2/
//   https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature
//
// Variables de entorno (Vercel):
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET  — credenciales de la app REST
//   PAYPAL_ENV = sandbox | live             — por defecto sandbox
//   PAYPAL_WEBHOOK_ID                       — id del webhook creado en el panel de PayPal

export type PaypalConfig = { clientId: string; clientSecret: string; env: "sandbox" | "live"; webhookId: string };

export function paypalConfig(env: Record<string, string | undefined> = process.env): PaypalConfig | null {
  const clientId = String(env.PAYPAL_CLIENT_ID || "").trim();
  const clientSecret = String(env.PAYPAL_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return null;
  const mode = String(env.PAYPAL_ENV || "sandbox").trim().toLowerCase() === "live" ? "live" : "sandbox";
  return { clientId, clientSecret, env: mode, webhookId: String(env.PAYPAL_WEBHOOK_ID || "").trim() };
}

export function paypalBase(cfg: PaypalConfig): string {
  return cfg.env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

type FetchLike = typeof fetch;

export class PaypalError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

async function call(cfg: PaypalConfig, path: string, init: RequestInit, f: FetchLike): Promise<any> {
  const token = await accessToken(cfg, f);
  const res = await f(`${paypalBase(cfg)}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) throw new PaypalError(body?.message || `PayPal respondió ${res.status}`, res.status, body);
  return body;
}

async function accessToken(cfg: PaypalConfig, f: FetchLike): Promise<string> {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await f(`${paypalBase(cfg)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) throw new PaypalError("No se pudo autenticar con PayPal", res.status, body);
  return body.access_token;
}

export function money(amount: number): string {
  return (Math.round(amount * 100) / 100).toFixed(2);
}

export async function createPaypalOrder(
  cfg: PaypalConfig,
  input: { paymentOrderId: string; amount: number; currency: string; description: string },
  f: FetchLike = fetch
): Promise<string> {
  const body = await call(
    cfg,
    "/v2/checkout/orders",
    {
      method: "POST",
      headers: { "PayPal-Request-Id": `create-${input.paymentOrderId}` }, // idempotencia en PayPal
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.paymentOrderId,
            custom_id: input.paymentOrderId,
            description: input.description.slice(0, 127),
            amount: { currency_code: input.currency, value: money(input.amount) },
          },
        ],
      }),
    },
    f
  );
  if (!body?.id) throw new PaypalError("PayPal no devolvió el id de la orden", 502, body);
  return body.id as string;
}

export type CaptureResult = {
  completed: boolean;
  captureId: string | null;
  amount: number | null;
  currency: string | null;
  customId: string | null;
  raw: any;
};

/** Extrae la captura de una orden de PayPal (respuesta de capture o de GET). */
export function readCapture(order: any): CaptureResult {
  const unit = order?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    completed: order?.status === "COMPLETED" && capture?.status === "COMPLETED",
    captureId: capture?.id ?? null,
    amount: capture?.amount?.value != null ? Number(capture.amount.value) : null,
    currency: capture?.amount?.currency_code ?? null,
    customId: capture?.custom_id ?? unit?.custom_id ?? unit?.reference_id ?? null,
    raw: { order_id: order?.id, status: order?.status, capture_status: capture?.status, payer: order?.payer?.payer_id },
  };
}

/** Captura la orden. Si ya estaba capturada, la consulta y devuelve su captura. */
export async function capturePaypalOrder(cfg: PaypalConfig, paypalOrderId: string, f: FetchLike = fetch): Promise<CaptureResult> {
  try {
    const body = await call(
      cfg,
      `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      { method: "POST", headers: { "PayPal-Request-Id": `capture-${paypalOrderId}` } },
      f
    );
    return readCapture(body);
  } catch (error) {
    if (error instanceof PaypalError && error.status === 422) {
      const order = await call(cfg, `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, { method: "GET" }, f);
      return readCapture(order);
    }
    throw error;
  }
}

/** Verifica la firma de un webhook con la API de PayPal. */
export async function verifyPaypalWebhook(
  cfg: PaypalConfig,
  headers: Record<string, string | string[] | undefined>,
  event: unknown,
  f: FetchLike = fetch
): Promise<boolean> {
  if (!cfg.webhookId) return false;
  const h = (name: string) => {
    const v = headers[name];
    return String(Array.isArray(v) ? v[0] : v ?? "");
  };
  const body = await call(
    cfg,
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: JSON.stringify({
        auth_algo: h("paypal-auth-algo"),
        cert_url: h("paypal-cert-url"),
        transmission_id: h("paypal-transmission-id"),
        transmission_sig: h("paypal-transmission-sig"),
        transmission_time: h("paypal-transmission-time"),
        webhook_id: cfg.webhookId,
        webhook_event: event,
      }),
    },
    f
  );
  return body?.verification_status === "SUCCESS";
}
