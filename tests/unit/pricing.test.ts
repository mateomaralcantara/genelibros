import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  byKind,
  formatUsd,
  grossMarginOf,
  pricePerCredit,
  priceFromCost,
  quoteEditorial,
  type EditorialQuoteSettings,
} from "../../src/lib/commercial/pricing";

// Los parámetros salen de la carga inicial de la migración (no del código).
const sql = readFileSync("supabase/migrations/20261119_pricing_catalog.sql", "utf8");
const settings: EditorialQuoteSettings = JSON.parse(/\('editorial_quote', '([\s\S]*?)'\)/.exec(sql)![1]);

describe("quoteEditorial", () => {
  it("autobiografía de 30.000 palabras con entrevistas, investigación básica, diseño y portada", () => {
    const q = quoteEditorial(
      { complexity: "MEDIA", words: 30000, interviews: 4, research: "BASICA", designLayout: true, coverDesign: true, revisionRounds: 2, rush: false },
      settings
    );
    // 150 base + 30×12 + 4×25 + 100 + 120 + 80 + 2×40 = 990
    expect(q.total).toBe(990);
    expect(q.aboveMax).toBe(false);
    expect(q.lines.map((l) => l.usd).reduce((a, b) => a + b, 0)).toBe(990);
  });

  it("aplica el mínimo de US$100 a encargos muy pequeños", () => {
    const q = quoteEditorial(
      { complexity: "BAJA", words: 1000, interviews: 0, research: "NINGUNA", designLayout: false, coverDesign: false, revisionRounds: 0, rush: false },
      settings
    );
    expect(q.total).toBe(100);
    expect(q.atMin).toBe(true);
  });

  it("limita a US$2.000 y marca 'a medida' los proyectos que lo superan", () => {
    const q = quoteEditorial(
      { complexity: "MUY_ALTA", words: 80000, interviews: 6, research: "AMPLIA", designLayout: true, coverDesign: true, revisionRounds: 3, rush: true },
      settings
    );
    expect(q.total).toBe(2000);
    expect(q.aboveMax).toBe(true);
    expect(q.subtotal).toBeGreaterThan(2000);
  });

  it("la urgencia suma el porcentaje configurado", () => {
    const base = { complexity: "MEDIA" as const, words: 20000, interviews: 2, research: "NINGUNA" as const, designLayout: false, coverDesign: false, revisionRounds: 1, rush: false };
    const normal = quoteEditorial(base, settings).total;
    const rush = quoteEditorial({ ...base, rush: true }, settings).total;
    expect(rush).toBeCloseTo(normal * 1.25, 2);
  });
});

describe("fórmula de precio y márgenes", () => {
  it("P = costo / (1 − margen)", () => {
    expect(priceFromCost(6, 0.6)).toBe(15);
    expect(grossMarginOf(15, 6)).toBe(0.6);
    expect(() => priceFromCost(10, 1)).toThrow();
  });
});

describe("catálogo inicial en US$ (datos de la migración)", () => {
  const prices = (code: string) => Number(new RegExp(`\\('${code}',\\s*'[A-Z_]+',\\s*'[^']*',\\s*'[^']*',\\s*([\\d.]+)`).exec(sql)?.[1]);

  it("respeta los rangos definidos por el autor", () => {
    expect(prices("BOOK_ONE_CLICK")).toBe(15);
    for (const c of ["CREDITS_100", "CREDITS_275", "CREDITS_600", "CREDITS_1300"]) {
      expect(prices(c)).toBeGreaterThanOrEqual(10);
      expect(prices(c)).toBeLessThanOrEqual(100);
    }
    for (const c of ["SUB_AUTOR_INICIAL", "SUB_AUTOR_PROFESIONAL", "SUB_AUTOR_PREMIUM", "SUB_EDITORIAL"]) {
      expect(prices(c)).toBeGreaterThanOrEqual(25);
      expect(prices(c)).toBeLessThanOrEqual(200);
    }
    for (const c of ["EDITORIAL_GUIA", "EDITORIAL_MEDIA", "EDITORIAL_EMPRESARIAL", "EDITORIAL_DOCUMENTADO", "EDITORIAL_ESPECIALIZADO"]) {
      expect(prices(c)).toBeGreaterThanOrEqual(100);
      expect(prices(c)).toBeLessThanOrEqual(2000);
    }
  });

  it("los paquetes grandes salen más baratos por crédito", () => {
    const pp = [
      { price_usd: 10, credits: 100 },
      { price_usd: 25, credits: 275 },
      { price_usd: 50, credits: 600 },
      { price_usd: 100, credits: 1300 },
    ].map(pricePerCredit) as number[];
    for (let i = 1; i < pp.length; i += 1) expect(pp[i]).toBeLessThan(pp[i - 1]);
  });
});

describe("utilidades", () => {
  it("formatea dólares", () => {
    expect(formatUsd(15)).toBe("US$15");
    expect(formatUsd(1300)).toBe("US$1,300");
    expect(formatUsd(9.5)).toBe("US$9.50");
    expect(formatUsd(null)).toBe("—");
  });

  it("filtra por tipo, activos y en orden", () => {
    const items: any[] = [
      { code: "b", kind: "CREDIT_PACK", active: true, sort_order: 2 },
      { code: "a", kind: "CREDIT_PACK", active: true, sort_order: 1 },
      { code: "x", kind: "CREDIT_PACK", active: false, sort_order: 0 },
      { code: "s", kind: "SUBSCRIPTION", active: true, sort_order: 0 },
    ];
    expect(byKind(items, "CREDIT_PACK").map((i) => i.code)).toEqual(["a", "b"]);
  });
});

import { cardLines } from "../../components/commercial/PricingSections";

describe("tarjetas de precios", () => {
  const base = { code: "X", name: "X", description: null, max_price_usd: null, billing_interval: null, limits: {}, sort_order: 0, active: true } as any;
  it("usa las características del producto (máx. 4)", () => {
    const book = { ...base, kind: "BOOK", price_usd: 15, credits: 150, features: ["a", "b", "c", "d", "e"] };
    expect(cardLines(book)).toEqual(["a", "b", "c", "d"]);
  });
  it("describe un paquete de créditos sin características", () => {
    const pack = { ...base, kind: "CREDIT_PACK", price_usd: 25, credits: 275, features: [], limits: { bonus_percent: 10 } };
    const lines = cardLines(pack);
    expect(lines[0]).toBe("275 créditos");
    expect(lines[1]).toBe("+10 % de regalo");
    expect(lines.length).toBeLessThanOrEqual(4);
  });
});
