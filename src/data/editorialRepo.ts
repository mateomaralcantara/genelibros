// Acceso a datos de la Modalidad D (encargos editoriales) y pagos.
// La seguridad la aplica la base de datos (RLS + RPC): el cliente solo crea
// su solicitud, comenta, aprueba propuestas y pide ajustes; el equipo
// gestiona estados, etapas, archivos y pagos.

import { supabase } from "../lib/supabase";

export type EditorialOrder = {
  id: string;
  user_id: string;
  status: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  working_title: string | null;
  idea: string;
  purpose: string | null;
  audience: string | null;
  genre: string | null;
  details: Record<string, any>;
  assigned_to: string | null;
  proposal_terms: string | null;
  proposal_amount: number | null;
  proposal_currency: string | null;
  proposal_sent_at: string | null;
  client_approved_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EditorialEvent = {
  id: string;
  order_id: string;
  actor_id: string | null;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  body: string | null;
  visible_to_client: boolean;
  created_at: string;
};

export type EditorialStage = {
  id: string;
  order_id: string;
  stage: string;
  assignee: string | null;
  due_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
};

export type EditorialDeliverable = {
  id: string;
  order_id: string;
  stage: string | null;
  file_path: string;
  file_name: string;
  description: string | null;
  visible_to_client: boolean;
  created_at: string;
};

export type PaymentOrder = {
  id: string;
  purpose: string;
  reference_id: string | null;
  amount: number;
  currency: string;
  status: string;
  provider: string | null;
  paid_at: string | null;
  created_at: string;
};

const BUCKET = "editorial-files";

function fail(context: string, error: any): never {
  throw new Error(`${context}: ${error?.message || error}`);
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data?.user?.id;
  if (!id) throw new Error("Inicia sesión para continuar.");
  return id;
}

/* ------------------------------- Cliente ------------------------------- */

export type NewEditorialRequest = {
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  working_title?: string;
  idea: string;
  purpose?: string;
  audience?: string;
  genre?: string;
  details?: Record<string, any>;
};

export async function createEditorialOrder(input: NewEditorialRequest): Promise<EditorialOrder> {
  const user_id = await currentUserId();
  if (!input.idea?.trim()) throw new Error("Cuéntanos tu idea para el libro.");
  const { data, error } = await supabase
    .from("editorial_orders")
    .insert({ ...input, user_id, idea: input.idea.trim(), details: input.details ?? {} })
    .select("*")
    .single();
  if (error) fail("No se pudo enviar la solicitud", error);
  return data as EditorialOrder;
}

export async function listMyEditorialOrders(): Promise<EditorialOrder[]> {
  const user_id = await currentUserId();
  const { data, error } = await supabase
    .from("editorial_orders")
    .select("*")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });
  if (error) fail("No se pudieron cargar tus encargos", error);
  return (data ?? []) as EditorialOrder[];
}

export type EditorialOrderDetail = {
  order: EditorialOrder;
  events: EditorialEvent[];
  stages: EditorialStage[];
  deliverables: EditorialDeliverable[];
  payments: PaymentOrder[];
};

export async function getEditorialOrderDetail(orderId: string): Promise<EditorialOrderDetail> {
  const [o, e, s, d, p] = await Promise.all([
    supabase.from("editorial_orders").select("*").eq("id", orderId).single(),
    supabase.from("editorial_order_events").select("*").eq("order_id", orderId).order("created_at", { ascending: true }),
    supabase.from("editorial_order_stages").select("*").eq("order_id", orderId),
    supabase.from("editorial_deliverables").select("*").eq("order_id", orderId).order("created_at", { ascending: false }),
    supabase.from("payment_orders").select("*").eq("purpose", "EDITORIAL_ORDER").eq("reference_id", orderId),
  ]);
  if (o.error) fail("No se pudo cargar el encargo", o.error);
  for (const r of [e, s, d, p]) if (r.error) fail("No se pudo cargar el encargo", r.error);
  return {
    order: o.data as EditorialOrder,
    events: (e.data ?? []) as EditorialEvent[],
    stages: (s.data ?? []) as EditorialStage[],
    deliverables: (d.data ?? []) as EditorialDeliverable[],
    payments: (p.data ?? []) as PaymentOrder[],
  };
}

export async function addClientComment(orderId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc("editorial_add_client_comment", { p_order_id: orderId, p_body: body });
  if (error) fail("No se pudo enviar el comentario", error);
}

export async function approveProposal(orderId: string): Promise<void> {
  const { error } = await supabase.rpc("editorial_client_approve_proposal", { p_order_id: orderId });
  if (error) fail("No se pudo aprobar la propuesta", error);
}

export async function requestChanges(orderId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc("editorial_client_request_changes", { p_order_id: orderId, p_body: body });
  if (error) fail("No se pudieron enviar los ajustes", error);
}

/** Enlace temporal (10 min) para descargar un archivo privado. */
export async function deliverableUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, 600);
  if (error || !data?.signedUrl) fail("No se pudo preparar la descarga", error);
  return data!.signedUrl;
}

/* -------------------------------- Equipo -------------------------------- */

export type StaffRole = "admin" | "editor";

export async function getMyStaffRoles(): Promise<StaffRole[]> {
  const user_id = await currentUserId();
  const { data, error } = await supabase.from("app_roles").select("role").eq("user_id", user_id);
  if (error) return [];
  return (data ?? []).map((r: any) => r.role as StaffRole);
}

export type StaffMember = { user_id: string; role: StaffRole; email: string | null; name: string | null };

export async function listStaff(): Promise<StaffMember[]> {
  const { data: roles, error } = await supabase.from("app_roles").select("user_id, role");
  if (error) fail("No se pudo cargar el equipo", error);
  const ids = Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("user_id, email, full_name").in("user_id", ids)
    : { data: [] as any[] };
  const byId = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
  return (roles ?? []).map((r: any) => ({
    user_id: r.user_id,
    role: r.role,
    email: byId.get(r.user_id)?.email ?? null,
    name: byId.get(r.user_id)?.full_name ?? null,
  }));
}

export async function listAllEditorialOrders(status?: string): Promise<EditorialOrder[]> {
  let q = supabase.from("editorial_orders").select("*").order("updated_at", { ascending: false }).limit(200);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) fail("No se pudieron cargar los encargos", error);
  return (data ?? []) as EditorialOrder[];
}

export type StaffOrderPatch = Partial<
  Pick<EditorialOrder, "status" | "assigned_to" | "proposal_terms" | "proposal_amount" | "proposal_currency" | "proposal_sent_at" | "delivered_at">
>;

export async function updateEditorialOrder(orderId: string, patch: StaffOrderPatch): Promise<void> {
  const { error } = await supabase.from("editorial_orders").update(patch).eq("id", orderId);
  if (error) fail("No se pudo actualizar el encargo", error);
}

export async function saveStage(orderId: string, stage: string, patch: Partial<Omit<EditorialStage, "id" | "order_id" | "stage">>): Promise<void> {
  const { error } = await supabase
    .from("editorial_order_stages")
    .upsert({ order_id: orderId, stage, ...patch, updated_at: new Date().toISOString() }, { onConflict: "order_id,stage" });
  if (error) fail("No se pudo guardar la etapa", error);
}

export async function addStaffNote(orderId: string, body: string, visibleToClient: boolean): Promise<void> {
  const actor_id = await currentUserId();
  const { error } = await supabase
    .from("editorial_order_events")
    .insert({ order_id: orderId, actor_id, kind: "COMMENT", body, visible_to_client: visibleToClient });
  if (error) fail("No se pudo guardar la nota", error);
}

export async function uploadDeliverable(input: {
  orderId: string;
  file: File;
  stage?: string | null;
  description?: string;
  visibleToClient: boolean;
}): Promise<void> {
  const uploaded_by = await currentUserId();
  const safeName = input.file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const file_path = `${input.orderId}/${Date.now()}_${safeName}`;
  const up = await supabase.storage.from(BUCKET).upload(file_path, input.file, { upsert: false });
  if (up.error) fail("No se pudo subir el archivo", up.error);
  const { error } = await supabase.from("editorial_deliverables").insert({
    order_id: input.orderId,
    stage: input.stage ?? null,
    file_path,
    file_name: input.file.name,
    description: input.description ?? null,
    visible_to_client: input.visibleToClient,
    uploaded_by,
  });
  if (error) fail("No se pudo registrar el archivo", error);
}

export async function setDeliverableVisibility(id: string, visible: boolean): Promise<void> {
  const { error } = await supabase.from("editorial_deliverables").update({ visible_to_client: visible }).eq("id", id);
  if (error) fail("No se pudo cambiar la visibilidad", error);
}

/** Admin: registra un pago por transferencia verificado. Idempotente por referencia bancaria. */
export async function recordManualPayment(input: {
  orderId: string;
  amount: number;
  currency: string;
  bankReference: string;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("admin_record_manual_payment", {
    p_order_id: input.orderId,
    p_amount: input.amount,
    p_currency: input.currency,
    p_bank_reference: input.bankReference,
    p_note: input.note ?? null,
  });
  if (error) fail("No se pudo registrar el pago", error);
}
