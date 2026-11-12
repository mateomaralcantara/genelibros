import { describe, expect, it } from "vitest";
import {
  generatedProgress,
  hasGeneratedText,
  isBookComplete,
  sectionIsGenerated,
} from "../../src/lib/bookCompletion";

const words = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ") + ".";

// Caso real: objetivo de 5.000 palabras y capítulos generados más cortos.
function book(overrides: any = {}): any {
  return {
    id: "p1",
    title: "Libro",
    generation_progress: {},
    state: {
      proposal: { text: words(2100) },
      introduction: { text: words(1300) },
      outline_12: [1, 2, 3, 4].map((n) => ({ chapter_number: n, chapter_title: `C${n}`, target_words: 5000 })),
      chapters: [
        { chapter_number: 1, text: words(1137) },
        { chapter_number: 2, text: words(967) },
        { chapter_number: 3, text: words(1120) },
        { chapter_number: 4, text: words(3897) },
      ],
      ...overrides,
    },
  };
}

describe("hasGeneratedText / sectionIsGenerated", () => {
  it("considera generado cualquier texto real, aunque no llegue al objetivo", () => {
    expect(hasGeneratedText(words(967))).toBe(true);
    expect(sectionIsGenerated(book(), "chap-2")).toBe(true);
    expect(sectionIsGenerated(book(), "proposal")).toBe(true);
  });

  it("no considera generado lo vacío, muy corto o un marcador de posición", () => {
    expect(hasGeneratedText("")).toBe(false);
    expect(hasGeneratedText("Aquí irá el capítulo...")).toBe(false);
    expect(hasGeneratedText(words(20))).toBe(false);
    expect(sectionIsGenerated(book(), "chap-9")).toBe(false);
  });
});

describe("generatedProgress (lo que muestra el panel)", () => {
  it("marca como listos (cerrados) los capítulos generados por debajo del objetivo", () => {
    const p = generatedProgress(book());
    expect([p.proposal, p.intro, p["chap-1"], p["chap-2"], p["chap-3"], p["chap-4"]]).toEqual(
      Array(6).fill("completed")
    );
  });

  it("deja pendientes los capítulos sin texto", () => {
    const p = generatedProgress(book({ chapters: [{ chapter_number: 1, text: words(1137) }] }));
    expect(p["chap-1"]).toBe("completed");
    expect(p["chap-2"]).toBe("pending");
  });

  it("respeta una generación en curso", () => {
    const b = book();
    b.generation_progress = { "chap-2": "generating" };
    expect(generatedProgress(b)["chap-2"]).toBe("generating");
  });
});

describe("isBookComplete", () => {
  it("es true cuando propuesta, introducción y todos los capítulos tienen texto", () => {
    expect(isBookComplete(book())).toBe(true);
  });

  it("es false si falta algún capítulo del índice o la introducción", () => {
    expect(isBookComplete(book({ chapters: [{ chapter_number: 1, text: words(1137) }] }))).toBe(false);
    expect(isBookComplete(book({ introduction: { text: "" } }))).toBe(false);
  });

  it("es false sin índice o sin proyecto", () => {
    expect(isBookComplete(book({ outline_12: [] }))).toBe(false);
    expect(isBookComplete(null)).toBe(false);
  });
});
