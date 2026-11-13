// Pagos: PayPal (vía /api/payments) y transferencia (RPC con RLS).
// Ver supabase/migrations/20261120_checkout_paypal_transfer.sql y api/payments.ts.

import { authHeaders, supabase } from "../lib/supabase";

function fail(context: string, error: any): never {
  throw new Error(`${context}: ${error?.message || error}`);
}

export type PaymentConfig = {
  paypal: { enabled: boolean; clientId: string | null; env: string | null };
  transfer: { enabled: boolean };
};

export type PaymentMethods = { paypal_enabled: boolean; transfer_enabled: boolean; transfer_instructions: string };

export type PaymentOrder = {
  id: string;
  user_id: string;
  purpose: "EDITORIAL_ORDER" | "BOOK" | "SUBSCRIPTION" | "CREDITS";
  reference_id: string | null;
  amount: number;
  currency: string;
  status: "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  provider: string | null;
  catalog_code: string | null;
  credits: number | null;
  transfer_reference: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  created_at: string;
};

export const PAYMENT_STATUS_LABELS: Record<PaymentOrder["status"], string> = {
  PENDING: "Pendiente",
  PAID: "Pagado",
  FAILED: "Rechazado",
  CANCELLED: "Cancelado",
  REFUNDED: "Reembolsado",
  PARTIALLY_REFUNDED: "Reembolso parcial",
};

const normalize = (r: any): PaymentOrder => ({ ...r, amount: Number(r.amount), credits: r.credits == null ? null : Number(r.credits) });

async function api(action: string, payload?: unknown): Promise<any> {
  const res = await fetch(`/api/payments?action=${action}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Error ${res.status}`);
  return body;
}

export async function getPaymentConfig(): Promise<PaymentConfig> {
  try {
    return await api("config");
  } catch {
    return { paypal: { enabled: false, clientId: null, env: null }, transfer: { enabled: false } };
  }
}

export async function getPaymentMethods(): Promise<PaymentMethods | null> {
  const { data, error } = await supabase.from("pricing_settings").select("value").eq("key", "payment_methods").maybeSingle();
  if (error) return null;
  return (data?.value as PaymentMethods) ?? null;
}

/* ------------------------------ PayPal ------------------------------ */

export async function paypalCreate(target: { code: string } | { editorialOrderId: string }): Promise<string> {
  const body = await api("paypal-create", target);
  return body.paypalOrderId as string;
}

export async function paypalCapture(paypalOrderId: string): Promise<"PAID" | "PENDING"> {
  const body = await api("paypal-capture", { paypalOrderId });
  return body.status;
}

/* --------------------------- Transferencia --------------------------- */

export async function createTransferOrder(code: string): Promise<string> {
  const { data, error } = await supabase.rpc("client_create_transfer_order", { p_code: code });
  if (error) fail("No se pudo crear el pedido", error);
  return data as string;
}

export async function reportTransfer(paymentId: string, reference: string): Promise<void> {
  const { error } = await supabase.rpc("client_report_transfer", { p_payment_id: paymentId, p_reference: reference });
  if (error) fail("No se pudo guardar la referencia", error);
}

export async function cancelPaymentOrder(paymentId: string): Promise<void> {
  const { error } = await supabase.rpc("client_cancel_payment_order", { p_payment_id: paymentId });
  if (error) fail("No se pudo cancelar", error);
}

/* ------------------------------ Cliente ------------------------------ */

export async function listMyPayments(): Promise<PaymentOrder[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data, error } = await supabase.from("payment_orders").select("*").eq("user_id", u.user.id).order("created_at", { ascending: false }).limit(50);
  if (error) fail("No se pudieron cargar tus pagos", error);
  return (data ?? []).map(normalize);
}

export async function getMyCreditBalance(): Promise<number> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return 0;
  const { data } = await supabase.from("credit_balances").select("balance").eq("user_id", u.user.id).maybeSingle();
  return Number(data?.balance ?? 0);
}

/* ------------------------------- Admin ------------------------------- */

export async function listPaymentsForAdmin(status?: PaymentOrder["status"]): Promise<Array<PaymentOrder & { email: string | null }>> {
  let q = supabase.from("payment_orders").select("*").order("created_at", { ascending: false }).limit(100);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) fail("No se pudieron cargar los pagos", error);
  const rows = (data ?? []).map(normalize);
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const emails = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await supabase.from("profiles").select("user_id, email").in("user_id", ids);
    for (const p of profiles ?? []) emails.set(p.user_id, p.email);
  }
  return rows.map((r) => ({ ...r, email: emails.get(r.user_id) ?? null }));
}

export async function confirmTransfer(paymentId: string, bankReference: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc("admin_confirm_transfer", { p_payment_id: paymentId, p_bank_reference: bankReference, p_note: note ?? null });
  if (error) fail("No se pudo confirmar", error);
}

export async function rejectPayment(paymentId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_reject_payment_order", { p_payment_id: paymentId });
  if (error) fail("No se pudo rechazar", error);
}

export async function savePaymentMethods(value: PaymentMethods): Promise<void> {
  const { error } = await supabase.from("pricing_settings").upsert({ key: "payment_methods", value }, { onConflict: "key" });
  if (error) fail("No se pudieron guardar los métodos de pago", error);
}
