import { describe, expect, it } from "vitest";
import { isBookComplete } from "../../src/lib/bookCompletion";

const words = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ") + ".";

function book(overrides: any = {}): any {
  return {
    id: "p1",
    title: "Libro",
    generation_progress: {},
    state: {
      proposal: { text: words(2100) },
      introduction: { text: words(1300) },
      outline_12: [
        { chapter_number: 1, chapter_title: "Uno", target_words: 3000 },
        { chapter_number: 2, chapter_title: "Dos", target_words: 3000 },
      ],
      chapters: [
        { chapter_number: 1, text: words(3000) },
        { chapter_number: 2, text: words(3100) },
      ],
      ...overrides,
    },
  };
}

describe("isBookComplete", () => {
  it("es true con propuesta, introducción y todos los capítulos completos", () => {
    expect(isBookComplete(book())).toBe(true);
  });

  it("es false si falta un capítulo del índice", () => {
    expect(isBookComplete(book({ chapters: [{ chapter_number: 1, text: words(3000) }] }))).toBe(false);
  });

  it("es false si un capítulo no llega a su objetivo de palabras", () => {
    expect(isBookComplete(book({ chapters: [{ chapter_number: 1, text: words(3000) }, { chapter_number: 2, text: words(2500) }] }))).toBe(false);
  });

  it("es false si la propuesta o la introducción son cortas", () => {
    expect(isBookComplete(book({ proposal: { text: words(500) } }))).toBe(false);
    expect(isBookComplete(book({ introduction: { text: words(300) } }))).toBe(false);
  });

  it("es false si un capítulo es un marcador de posición", () => {
    expect(isBookComplete(book({ chapters: [{ chapter_number: 1, text: words(3000) }, { chapter_number: 2, text: "..." }] }))).toBe(false);
  });

  it("es false sin índice o sin proyecto", () => {
    expect(isBookComplete(book({ outline_12: [] }))).toBe(false);
    expect(isBookComplete(null)).toBe(false);
  });

  it("no se deja engañar por un 'generating' en curso: cuenta el contenido guardado", () => {
    const b = book();
    b.generation_progress = { "chap-2": "generating" };
    expect(isBookComplete(b)).toBe(true);
  });
});
