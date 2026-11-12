import { describe, expect, it } from "vitest";
import { mergeProjectState } from "../../src/lib/editor";

const longText = (words: number, seed = "palabra") =>
  Array.from({ length: words }, (_, i) => `${seed}${i}`).join(" ") + ".";

function state(overrides: Record<string, any> = {}): any {
  return {
    book_topic: "Encargo original del autor",
    outline_12: [
      { chapter_number: 1, chapter_title: "El peso de la herencia invisible" },
      { chapter_number: 2, chapter_title: "La decisión de ser distinto" },
    ],
    chapters: [
      { chapter_number: 1, title: "El peso de la herencia invisible", text: longText(2500, "uno"), status: "DONE", words: 2500 },
      { chapter_number: 2, title: "La decisión de ser distinto", text: longText(2400, "dos"), status: "DONE", words: 2400 },
    ],
    continuity_pack: { style_guide: "Guía de estilo", canon: "Canon" },
    ...overrides,
  };
}

describe("mergeProjectState — no perder trabajo del autor", () => {
  it("conserva un capítulo completo si el modelo devuelve un texto mucho más corto", () => {
    const prev = state();
    const next = state({ chapters: [{ chapter_number: 1, text: "Resumen breve del capítulo.", status: "DRAFT" }] });

    const merged: any = mergeProjectState(prev, next);
    const ch1 = merged.chapters.find((c: any) => c.chapter_number === 1);
    expect(ch1.text).toBe(prev.chapters[0].text);
    expect(ch1.status).toBe("DONE");
  });

  it("conserva el capítulo si el modelo devuelve un marcador de posición ('...')", () => {
    const prev = state();
    const next = state({ chapters: [{ chapter_number: 2, text: "..." }] });

    const merged: any = mergeProjectState(prev, next);
    expect(merged.chapters.find((c: any) => c.chapter_number === 2).text).toBe(prev.chapters[1].text);
  });

  it("no borra capítulos que el modelo no incluyó en su respuesta", () => {
    const prev = state();
    const next = state({ chapters: [{ chapter_number: 1, text: longText(2600, "nuevo") }] });

    const merged: any = mergeProjectState(prev, next);
    expect(merged.chapters.map((c: any) => c.chapter_number)).toEqual([1, 2]);
    expect(merged.chapters[1].text).toBe(prev.chapters[1].text);
  });

  it("sí acepta una versión nueva y completa del capítulo", () => {
    const prev = state();
    const nuevo = longText(2600, "nuevo");
    const next = state({ chapters: [{ chapter_number: 1, text: nuevo, status: "DONE" }] });

    const merged: any = mergeProjectState(prev, next);
    expect(merged.chapters[0].text).toBe(nuevo);
  });

  it("nunca degrada un título real a 'Capítulo N'", () => {
    const prev = state();
    const next = state({
      outline_12: [{ chapter_number: 1, chapter_title: "Capítulo 1" }],
      chapters: [{ chapter_number: 1, title: "Capítulo 1", text: longText(2600, "nuevo") }],
    });

    const merged: any = mergeProjectState(prev, next);
    expect(merged.outline_12[0].chapter_title).toBe("El peso de la herencia invisible");
    expect(merged.chapters[0].title).toBe("El peso de la herencia invisible");
  });

  it("el encargo original del autor no puede ser reescrito por el modelo", () => {
    const merged: any = mergeProjectState(state(), state({ book_topic: "Texto inventado por el modelo" }));
    expect(merged.book_topic).toBe("Encargo original del autor");
  });

  it("conserva la guía de estilo si la respuesta la trae vacía", () => {
    const merged: any = mergeProjectState(state(), state({ continuity_pack: { style_guide: "" } }));
    expect(merged.continuity_pack.style_guide).toBe("Guía de estilo");
    expect(merged.continuity_pack.canon).toBe("Canon");
  });

  it("ordena capítulos y outline por número", () => {
    const prev = state();
    const next = state({
      outline_12: [{ chapter_number: 3, chapter_title: "Conceptos fundamentales" }],
      chapters: [{ chapter_number: 3, title: "Conceptos fundamentales", text: longText(2100, "tres") }],
    });

    const merged: any = mergeProjectState(prev, next);
    expect(merged.outline_12.map((o: any) => o.chapter_number)).toEqual([1, 2, 3]);
    expect(merged.chapters.map((c: any) => c.chapter_number)).toEqual([1, 2, 3]);
  });
});
