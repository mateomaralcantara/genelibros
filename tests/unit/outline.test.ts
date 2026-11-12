import { describe, expect, it } from "vitest";
import {
  buildFallbackOutline,
  clampInt,
  extractBookTitleFromIdea,
  extractDesiredChapterCount,
  extractDesiredChapterCountSafe,
  hasPromptLeak,
  stripChapterPrefix,
  truncateEditorialTitle,
} from "../../src/lib/outline";

describe("número de capítulos pedido por el autor", () => {
  it("detecta '22 capítulos', 'capítulos 15' y '8 chapters'", () => {
    expect(extractDesiredChapterCount("Escríbeme un libro de 22 capítulos")).toBe(22);
    expect(extractDesiredChapterCount("capítulos 15 sobre liderazgo")).toBe(15);
    expect(extractDesiredChapterCount("A book with 8 chapters")).toBe(8);
  });

  it("devuelve null si no se pide un número", () => {
    expect(extractDesiredChapterCount("Un libro sobre liderazgo")).toBeNull();
  });

  it("limita el número entre 1 y 120", () => {
    expect(extractDesiredChapterCount("libro de 500 capítulos")).toBe(120);
    expect(clampInt(0, 1, 120)).toBe(1);
    expect(clampInt(Number.NaN, 1, 120)).toBe(1);
  });

  it("si no hay número explícito, lo deduce del último 'CAPÍTULO N' del encargo", () => {
    // Regresión: "CAPÍTULO 1:" se confundía con "1 capítulo" y el índice salía con 1.
    const brief = ["CAPÍTULO 1: Inicio", "CAPÍTULO 2: Medio", "CAPÍTULO 7: Final"].join("\n");
    expect(extractDesiredChapterCountSafe(brief)).toBe(7);
  });

  it("un número pedido mayor que los capítulos listados gana", () => {
    const brief = ["Quiero un libro de 22 capítulos.", "CAPÍTULO 1: Inicio", "CAPÍTULO 2: Medio"].join("\n");
    expect(extractDesiredChapterCountSafe(brief)).toBe(22);
  });

  it("sin número ni capítulos listados devuelve null (la app usa 12)", () => {
    expect(extractDesiredChapterCountSafe("Un libro sobre liderazgo")).toBeNull();
  });
});

describe("título del libro a partir del encargo", () => {
  it("usa el campo 'Título:' cuando existe", () => {
    expect(extractBookTitleFromIdea("Título: El relevo del micrófono\nTema: radio")).toBe("El relevo del micrófono");
  });

  it("usa el bloque 'TÍTULO DE TRABAJO' en formato markdown", () => {
    expect(extractBookTitleFromIdea("## TÍTULO DE TRABAJO\n**La factura invisible**\n\nMás texto")).toBe("La factura invisible");
  });

  it("nunca devuelve instrucciones del prompt como título", () => {
    const title = extractBookTitleFromIdea("Actúa como un escritor experto. Objetivo general: escribir sobre economía.");
    expect(hasPromptLeak(title)).toBe(false);
    expect(title).not.toMatch(/act[uú]a como/i);
  });

  it("si no hay nada útil, devuelve 'Nuevo libro'", () => {
    expect(extractBookTitleFromIdea("")).toBe("Nuevo libro");
  });

  it("recorta títulos excesivamente largos sin cortar palabras", () => {
    const long = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(" ");
    const out = truncateEditorialTitle(long, "fallback");
    expect(out.length).toBeLessThanOrEqual(110);
    expect(long.startsWith(out)).toBe(true);
  });
});

describe("hasPromptLeak", () => {
  it.each(["Actúa como editor", "Objetivo general del libro", "Formato final: markdown", "task: GENERATE", "system: eres"])(
    "detecta '%s'",
    (text) => expect(hasPromptLeak(text)).toBe(true)
  );

  it("no marca títulos normales", () => {
    expect(hasPromptLeak("La decisión de ser distinto")).toBe(false);
  });
});

describe("buildFallbackOutline", () => {
  it("crea exactamente N capítulos numerados con su objetivo de palabras", () => {
    const outline = buildFallbackOutline(5, "Un libro sobre liderazgo", 3000);
    expect(outline).toHaveLength(5);
    expect(outline.map((o) => o.chapter_number)).toEqual([1, 2, 3, 4, 5]);
    expect(outline.every((o) => o.target_words === 3000 && o.status === "PENDING")).toBe(true);
  });

  it("respeta los títulos explícitos del encargo", () => {
    const brief = ["CAPÍTULO 1: El peso de la herencia invisible", "CAPÍTULO 2: La decisión de ser distinto"].join("\n");
    const outline = buildFallbackOutline(2, brief, 3000);
    expect(outline[0].chapter_title).toBe("El peso de la herencia invisible");
    expect(outline[1].chapter_title).toBe("La decisión de ser distinto");
  });

  it("ningún título del índice contiene el prompt ni el prefijo 'Capítulo N'", () => {
    const brief = "Actúa como un escritor experto. Objetivo general: escribir un libro de 12 capítulos sobre finanzas personales.";
    const outline = buildFallbackOutline(12, brief, 2500);
    for (const item of outline) {
      expect(item.chapter_title.trim()).not.toBe("");
      expect(hasPromptLeak(item.chapter_title)).toBe(false);
      expect(item.chapter_title).not.toMatch(/^cap[ií]tulo\s*\d+/i);
    }
  });

  it("stripChapterPrefix quita solo el prefijo del número correcto", () => {
    expect(stripChapterPrefix("Capítulo 3: Conceptos", 3)).toBe("Conceptos");
    expect(stripChapterPrefix("Capítulo 4: Conceptos", 3)).toBe("Capítulo 4: Conceptos");
  });
});
