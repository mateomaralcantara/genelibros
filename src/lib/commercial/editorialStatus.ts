// Modalidad D — etapas del encargo editorial (deben coincidir con el CHECK de
// editorial_orders.status en 20261118_roles_editorial_payments.sql).

export const EDITORIAL_STAGES = [
  { code: "RECIBIDA", label: "Solicitud recibida", client: "Recibimos tu idea. Un asesor editorial la revisará." },
  { code: "EN_EVALUACION", label: "En evaluación", client: "Un asesor está evaluando tu proyecto." },
  { code: "PROPUESTA_ENVIADA", label: "Propuesta enviada", client: "Te enviamos una propuesta de trabajo. Revísala y apruébala si estás de acuerdo." },
  { code: "PENDIENTE_APROBACION", label: "Aprobada, pendiente de pago", client: "Aprobaste la propuesta. El proyecto empieza al confirmarse el pago." },
  { code: "CONTRATADO", label: "Proyecto contratado", client: "Pago confirmado. Estamos asignando tu equipo editorial." },
  { code: "INVESTIGACION", label: "Investigación", client: "El equipo está investigando y documentando el tema." },
  { code: "ESTRUCTURACION", label: "Estructuración", client: "Estamos construyendo el índice y la arquitectura de capítulos." },
  { code: "REDACCION", label: "Redacción", client: "El equipo está redactando el manuscrito." },
  { code: "CORRECCION", label: "Corrección editorial", client: "Revisión editorial, corrección y verificación de referencias." },
  { code: "REVISION_CLIENTE", label: "Tu revisión", client: "La versión preliminar está lista para que la revises." },
  { code: "AJUSTES", label: "Ajustes solicitados", client: "Estamos aplicando las observaciones que nos enviaste." },
  { code: "DISENO", label: "Diseño y diagramación", client: "Diagramación del interior y diseño de portada." },
  { code: "APROBACION_FINAL", label: "Aprobación final", client: "Revisión final antes de la entrega." },
  { code: "ENTREGADO", label: "Entregado", client: "¡Tu libro está entregado! Descarga los archivos finales." },
] as const;

export type EditorialStatus = (typeof EDITORIAL_STAGES)[number]["code"] | "CANCELADO";

export const EDITORIAL_STATUS_CODES: EditorialStatus[] = [...EDITORIAL_STAGES.map((s) => s.code), "CANCELADO"];

export function stageIndex(status: string): number {
  return EDITORIAL_STAGES.findIndex((s) => s.code === status);
}

export function stageLabel(status: string): string {
  if (status === "CANCELADO") return "Cancelado";
  return EDITORIAL_STAGES.find((s) => s.code === status)?.label ?? status;
}

export function stageClientText(status: string): string {
  if (status === "CANCELADO") return "Este encargo fue cancelado.";
  return EDITORIAL_STAGES.find((s) => s.code === status)?.client ?? "";
}

/** Porcentaje de avance para la barra de progreso del cliente (0–100). */
export function progressPercent(status: string): number {
  if (status === "CANCELADO") return 0;
  const i = stageIndex(status);
  if (i < 0) return 0;
  return Math.round((i / (EDITORIAL_STAGES.length - 1)) * 100);
}

/** ¿Puede el cliente aprobar la propuesta ahora? (lo valida también la base de datos) */
export function canClientApprove(order: { status: string; proposal_amount?: number | null; client_approved_at?: string | null }): boolean {
  return order.status === "PROPUESTA_ENVIADA" && order.proposal_amount != null && !order.client_approved_at;
}

/** ¿Puede el cliente pedir ajustes ahora? */
export function canClientRequestChanges(order: { status: string }): boolean {
  return order.status === "REVISION_CLIENTE";
}

/** Formatea un importe con su moneda sin asumir ninguna moneda por defecto. */
export function formatAmount(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null || !currency) return "—";
  try {
    return new Intl.NumberFormat("es-DO", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
