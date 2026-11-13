// Pagos de LibroSeller.
//   GET  /api/payments?action=config            → métodos disponibles (PayPal: client id público)
//   POST /api/payments?action=paypal-create     → crea el pedido y la orden de PayPal (usuario)
//   POST /api/payments?action=paypal-capture    → captura en el servidor y entrega (usuario)
//   POST /api/payments?action=paypal-webhook    → respaldo firmado por PayPal
//
// Un pedido nunca se marca pagado por una redirección del navegador: solo
// cuando PayPal confirma la captura (respuesta del servidor o webhook firmado).
// El importe sale del catálogo o de la propuesta editorial, nunca del cliente.

import { createClient } from "@supabase/supabase-js";
import { requireUserOrWorker } from "../src/server/request-auth.js";
import { capturePaypalOrder, createPaypalOrder, paypalConfig, readCapture, verifyPaypalWebhook, PaypalError } from "../src/server/paypal.js";

function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) throw Object.assign(new Error("Pagos no configurados en el servidor (falta SUPABASE_SERVICE_ROLE_KEY)."), { statusCode: 500 });
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function body(req: any): any {
  if (req?.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(String(req?.body || "{}"));
  } catch {
    return {};
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSE_BY_KIND: Record<string, string> = { BOOK: "BOOK", CREDIT_PACK: "CREDITS", SUBSCRIPTION: "SUBSCRIPTION" };

async function paypalEnabled(db: ReturnType<typeof admin>): Promise<boolean> {
  const { data } = await db.from("pricing_settings").select("value").eq("key", "payment_methods").maybeSingle();
  return Boolean((data?.value as any)?.paypal_enabled) && Boolean(paypalConfig());
}

async function userId(req: any): Promise<string> {
  const p = await requireUserOrWorker(req);
  if (p.kind !== "user") throw Object.assign(new Error("Solo usuarios"), { statusCode: 403 });
  return p.userId;
}

async function handleConfig(res: any) {
  const cfg = paypalConfig();
  let methods: any = {};
  try {
    const { data } = await admin().from("pricing_settings").select("value").eq("key", "payment_methods").maybeSingle();
    methods = data?.value ?? {};
  } catch {
    methods = {};
  }
  return res.status(200).json({
    paypal: { enabled: Boolean(methods.paypal_enabled && cfg), clientId: methods.paypal_enabled && cfg ? cfg.clientId : null, env: cfg?.env ?? null },
    transfer: { enabled: Boolean(methods.transfer_enabled) },
  });
}

async function handleCreate(req: any, res: any) {
  const uid = await userId(req);
  const db = admin();
  const cfg = paypalConfig();
  if (!cfg || !(await paypalEnabled(db))) return res.status(409).json({ error: "PayPal no está activo todavía." });

  const { code, editorialOrderId } = body(req);
  let row: Record<string, any>;
  let description: string;

  if (editorialOrderId) {
    if (!UUID_RE.test(String(editorialOrderId))) return res.status(400).json({ error: "Encargo inválido" });
    const { data: o } = await db.from("editorial_orders").select("*").eq("id", editorialOrderId).maybeSingle();
    if (!o || o.user_id !== uid) return res.status(404).json({ error: "Encargo no encontrado" });
    if (!o.client_approved_at || o.status !== "PENDIENTE_APROBACION") return res.status(409).json({ error: "Primero aprueba la propuesta." });
    if (!(Number(o.proposal_amount) > 0) || String(o.proposal_currency).toUpperCase() !== "USD") {
      return res.status(409).json({ error: "Este encargo no se puede pagar con PayPal (la propuesta no está en USD). Paga por transferencia." });
    }
    row = { purpose: "EDITORIAL_ORDER", reference_id: o.id, amount: Number(o.proposal_amount), currency: "USD" };
    description = `Servicio editorial: ${o.working_title || "encargo"}`;
  } else {
    const { data: c } = await db.from("pricing_catalog").select("*").eq("code", String(code || "")).eq("active", true).maybeSingle();
    if (!c || !PURPOSE_BY_KIND[c.kind] || !(Number(c.price_usd) > 0)) return res.status(404).json({ error: "Producto no disponible" });
    row = { purpose: PURPOSE_BY_KIND[c.kind], amount: Number(c.price_usd), currency: "USD", catalog_code: c.code, credits: c.credits };
    description = `LibroSeller: ${c.name}`;
  }

  const { data: pay, error } = await db
    .from("payment_orders")
    .insert({ ...row, user_id: uid, kind: "ONE_TIME", status: "PENDING", provider: "PAYPAL", idempotency_key: `PAYPAL:${crypto.randomUUID()}` })
    .select("id, amount, currency")
    .single();
  if (error || !pay) throw new Error(`No se pudo crear el pedido: ${error?.message}`);

  const paypalOrderId = await createPaypalOrder(cfg, { paymentOrderId: pay.id, amount: Number(pay.amount), currency: pay.currency, description });
  await db.from("payment_orders").update({ provider_order_id: paypalOrderId, updated_at: new Date().toISOString() }).eq("id", pay.id);
  return res.status(200).json({ paypalOrderId, paymentOrderId: pay.id });
}

async function settle(db: ReturnType<typeof admin>, paymentOrderId: string, capture: ReturnType<typeof readCapture>) {
  if (!capture.completed || !capture.captureId || capture.amount == null || !capture.currency) return "PENDING";
  const { data, error } = await db.rpc("record_provider_payment", {
    p_payment_id: paymentOrderId,
    p_provider: "PAYPAL",
    p_transaction_id: capture.captureId,
    p_amount: capture.amount,
    p_currency: capture.currency,
    p_raw: capture.raw,
  });
  if (error) throw new Error(`No se pudo registrar el pago: ${error.message}`);
  return String(data || "PAID");
}

async function handleCapture(req: any, res: any) {
  const uid = await userId(req);
  const db = admin();
  const cfg = paypalConfig();
  if (!cfg) return res.status(409).json({ error: "PayPal no está configurado." });
  const { paypalOrderId } = body(req);
  if (!paypalOrderId || typeof paypalOrderId !== "string") return res.status(400).json({ error: "Falta la orden de PayPal" });

  const { data: pay } = await db.from("payment_orders").select("id, user_id, status").eq("provider", "PAYPAL").eq("provider_order_id", paypalOrderId).maybeSingle();
  if (!pay || pay.user_id !== uid) return res.status(404).json({ error: "Pedido no encontrado" });
  if (pay.status === "PAID") return res.status(200).json({ status: "PAID" });

  const capture = await capturePaypalOrder(cfg, paypalOrderId);
  if (capture.customId && capture.customId !== pay.id) return res.status(409).json({ error: "La orden de PayPal no corresponde a este pedido." });
  const status = await settle(db, pay.id, capture);
  return res.status(200).json({ status });
}

async function handleWebhook(req: any, res: any) {
  const cfg = paypalConfig();
  if (!cfg) return res.status(200).json({ ignored: true });
  const event = body(req);
  const ok = await verifyPaypalWebhook(cfg, req.headers || {}, event);
  if (!ok) return res.status(400).json({ error: "Firma inválida" });

  if (event?.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const r = event.resource || {};
    const paymentOrderId = String(r.custom_id || "");
    if (UUID_RE.test(paymentOrderId)) {
      const db = admin();
      await settle(db, paymentOrderId, {
        completed: r.status === "COMPLETED",
        captureId: r.id ?? null,
        amount: r.amount?.value != null ? Number(r.amount.value) : null,
        currency: r.amount?.currency_code ?? null,
        customId: paymentOrderId,
        raw: { webhook_event_id: event.id, capture_status: r.status },
      });
    }
  }
  return res.status(200).json({ received: true });
}

export default async function handler(req: any, res: any) {
  const action = String(req?.query?.action || "");
  try {
    if (action === "config" && req.method === "GET") return await handleConfig(res);
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (action === "paypal-create") return await handleCreate(req, res);
    if (action === "paypal-capture") return await handleCapture(req, res);
    if (action === "paypal-webhook") return await handleWebhook(req, res);
    return res.status(404).json({ error: "Acción desconocida" });
  } catch (error: any) {
    const status = Number(error?.statusCode) || (error instanceof PaypalError ? 502 : 500);
    console.error("[payments]", action, error?.message, error instanceof PaypalError ? error.details : "");
    return res.status(status).json({ error: error?.message || "Error en el pago" });
  }
}
