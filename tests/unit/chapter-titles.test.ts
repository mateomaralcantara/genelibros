import { describe, expect, it } from "vitest";
import {
  extractBookTitleFromBrief,
  extractChapterTitlesFromBrief,
  pickCanonicalChapterTitle,
} from "../../src/lib/editor";

describe("extractChapterTitlesFromBrief", () => {
  it("lee títulos en la misma línea, con comillas tipográficas", () => {
    const brief = [
      "CAPÍTULO 1: El peso de la herencia invisible",
      "CAPÍTULO 3: “Colombia Alcántara: la entrevista como escenario de autoridad”",
    ].join("\n");

    const titles = extractChapterTitlesFromBrief(brief);
    expect(titles.get(1)).toBe("El peso de la herencia invisible");
    expect(titles.get(3)).toBe("Colombia Alcántara: la entrevista como escenario de autoridad");
  });

  it("lee el título de la línea siguiente cuando el encabezado va solo", () => {
    const brief = ["Capítulo 2", "", "La decisión de ser distinto", "Texto del capítulo..."].join("\n");
    expect(extractChapterTitlesFromBrief(brief).get(2)).toBe("La decisión de ser distinto");
  });

  it("rechaza títulos genéricos y fragmentos del prompt", () => {
    const brief = [
      "Capítulo 4: Capítulo 4",
      "Capítulo 5: Actúa como un editor experto y escribe un libro",
      "Capítulo 6: Misión general del proyecto",
    ].join("\n");

    const titles = extractChapterTitlesFromBrief(brief);
    expect(titles.has(4)).toBe(false);
    expect(titles.has(5)).toBe(false);
    expect(titles.has(6)).toBe(false);
  });

  it("conserva el primer título si un capítulo aparece repetido", () => {
    const brief = ["Capítulo 1: Título original", "Capítulo 1: Otro título"].join("\n");
    expect(extractChapterTitlesFromBrief(brief).get(1)).toBe("Título original");
  });

  it("no inventa nada con un encargo vacío", () => {
    expect(extractChapterTitlesFromBrief("").size).toBe(0);
  });
});

describe("pickCanonicalChapterTitle", () => {
  it("elige el primer candidato válido y quita el prefijo 'Capítulo N:'", () => {
    expect(pickCanonicalChapterTitle(4, "Capítulo 4: El método", "Otro")).toBe("El método");
  });

  it("salta candidatos genéricos o contaminados por el prompt", () => {
    expect(
      pickCanonicalChapterTitle(4, "Capítulo 4", "Actúa como experto", undefined, 42, "La pausa estratégica")
    ).toBe("La pausa estratégica");
  });

  it("si no hay ninguno válido, devuelve 'Capítulo N' en lugar de basura", () => {
    expect(pickCanonicalChapterTitle(7, "", "Capítulo 7", "Objetivo general del libro")).toBe("Capítulo 7");
  });
});

describe("extractBookTitleFromBrief", () => {
  it("usa el bloque 'Título de trabajo' saltando el subtítulo", () => {
    const brief = ["## Título de trabajo:", "Subtítulo: algo", "**El relevo del micrófono**", "Títulos alternativos:", "Otro"].join("\n");
    expect(extractBookTitleFromBrief(brief)).toBe("El relevo del micrófono");
  });

  it("acepta 'Título: ...' en una sola línea", () => {
    expect(extractBookTitleFromBrief("Título: «La factura invisible»")).toBe("La factura invisible");
  });

  it("devuelve vacío si el encargo no declara título", () => {
    expect(extractBookTitleFromBrief("Escribe un libro sobre liderazgo")).toBe("");
  });
});
