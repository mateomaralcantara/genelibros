// Pricing Engine — cálculos puros. Los PRECIOS no están aquí: vienen de
// pricing_catalog / pricing_settings (Supabase), editables desde el panel.

export type CatalogKind = "BOOK" | "CREDIT_PACK" | "SUBSCRIPTION" | "EDITORIAL_TIER" | "CREDIT_COST";

export type CatalogItem = {
  code: string;
  kind: CatalogKind;
  name: string;
  description: string | null;
  price_usd: number | null;
  max_price_usd: number | null;
  credits: number | null;
  billing_interval: "month" | "year" | null;
  features: string[];
  limits: Record<string, any>;
  sort_order: number;
  active: boolean;
};

export type Complexity = "BAJA" | "MEDIA" | "MEDIA_ALTA" | "ALTA" | "MUY_ALTA";
export type ResearchLevel = "NINGUNA" | "BASICA" | "AMPLIA";

export type EditorialQuoteSettings = {
  currency: string;
  min_usd: number;
  max_usd: number;
  base_by_complexity: Record<Complexity, number>;
  per_1000_words_by_complexity: Record<Complexity, number>;
  per_interview: number;
  research: Record<ResearchLevel, number>;
  design_layout: number;
  cover_design: number;
  per_revision_round: number;
  rush_multiplier: number;
};

export type EditorialQuoteInput = {
  complexity: Complexity;
  words: number;
  interviews: number;
  research: ResearchLevel;
  designLayout: boolean;
  coverDesign: boolean;
  revisionRounds: number;
  rush: boolean;
};

export type QuoteLine = { label: string; usd: number };

export type EditorialQuote = {
  lines: QuoteLine[];
  subtotal: number;
  total: number;
  /** El cálculo superó el máximo configurado: requiere cotización a medida. */
  aboveMax: boolean;
  /** Se aplicó el mínimo configurado. */
  atMin: boolean;
};

export const COMPLEXITY_LABELS: Record<Complexity, string> = {
  BAJA: "Baja (guía, ebook corto)",
  MEDIA: "Media (autobiografía, motivacional)",
  MEDIA_ALTA: "Media-alta (empresarial)",
  ALTA: "Alta (histórico documentado)",
  MUY_ALTA: "Muy alta (científico, académico, técnico)",
};

export const RESEARCH_LABELS: Record<ResearchLevel, string> = {
  NINGUNA: "Sin investigación",
  BASICA: "Investigación básica",
  AMPLIA: "Investigación documental amplia",
};

const money = (n: number) => Math.round(n * 100) / 100;
const nonNeg = (n: unknown) => Math.max(0, Number(n) || 0);

/**
 * Cotizador del servicio editorial: base por complejidad + palabras +
 * entrevistas + investigación + diseño + portada + revisiones, con recargo
 * por urgencia. El total se limita al rango [min_usd, max_usd]; si lo supera
 * se marca aboveMax (proyecto a medida). Es una ESTIMACIÓN para el equipo:
 * el precio final lo fija el editor en la propuesta.
 */
export function quoteEditorial(input: EditorialQuoteInput, s: EditorialQuoteSettings): EditorialQuote {
  const lines: QuoteLine[] = [];
  const add = (label: string, usd: number) => {
    if (usd > 0) lines.push({ label, usd: money(usd) });
  };

  add(`Base · complejidad ${COMPLEXITY_LABELS[input.complexity] ?? input.complexity}`, nonNeg(s.base_by_complexity?.[input.complexity]));
  const words = nonNeg(input.words);
  add(`Redacción · ${words.toLocaleString("es-DO")} palabras`, (words / 1000) * nonNeg(s.per_1000_words_by_complexity?.[input.complexity]));
  add(`Entrevistas · ${nonNeg(input.interviews)}`, nonNeg(input.interviews) * nonNeg(s.per_interview));
  add(RESEARCH_LABELS[input.research] ?? "Investigación", nonNeg(s.research?.[input.research]));
  if (input.designLayout) add("Diseño y diagramación", nonNeg(s.design_layout));
  if (input.coverDesign) add("Diseño de portada", nonNeg(s.cover_design));
  add(`Rondas de revisión · ${nonNeg(input.revisionRounds)}`, nonNeg(input.revisionRounds) * nonNeg(s.per_revision_round));

  let subtotal = money(lines.reduce((acc, l) => acc + l.usd, 0));
  if (input.rush && nonNeg(s.rush_multiplier) > 1) {
    const extra = money(subtotal * (s.rush_multiplier - 1));
    lines.push({ label: `Entrega urgente (+${Math.round((s.rush_multiplier - 1) * 100)} %)`, usd: extra });
    subtotal = money(subtotal + extra);
  }

  const min = nonNeg(s.min_usd);
  const max = nonNeg(s.max_usd) || Infinity;
  const aboveMax = subtotal > max;
  const atMin = subtotal < min;
  const total = money(Math.min(Math.max(subtotal, min), max));
  return { lines, subtotal, total, aboveMax, atMin };
}

/**
 * Precio a partir del costo y el margen bruto deseado: P = costo / (1 − m).
 * Ej.: costo US$6 con margen 60 % → US$15.
 */
export function priceFromCost(totalCost: number, grossMargin: number): number {
  if (!(grossMargin >= 0 && grossMargin < 1)) throw new Error("El margen debe estar entre 0 y 0,99.");
  return money(nonNeg(totalCost) / (1 - grossMargin));
}

/** Margen bruto real de un precio: (P − costo) / P. */
export function grossMarginOf(price: number, totalCost: number): number {
  const p = nonNeg(price);
  return p > 0 ? Math.round(((p - nonNeg(totalCost)) / p) * 1000) / 1000 : 0;
}

/** Precio por crédito de un paquete (para comparar paquetes). */
export function pricePerCredit(item: Pick<CatalogItem, "price_usd" | "credits">): number | null {
  if (item.price_usd == null || !item.credits) return null;
  return Math.round((item.price_usd / item.credits) * 10000) / 10000;
}

export function formatUsd(amount: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const decimals = opts.decimals ?? !Number.isInteger(amount);
  return `US$${amount.toLocaleString("en-US", { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function byKind(items: CatalogItem[], kind: CatalogKind): CatalogItem[] {
  return items.filter((i) => i.kind === kind && i.active).sort((a, b) => a.sort_order - b.sort_order);
}
