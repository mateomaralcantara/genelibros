import { describe, expect, it } from "vitest";
import { processEngineResult } from "../../src/lib/editor";

// GENELIBROS_SEALED_SECTIONS: cada generación solo cambia SU sección.
const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ") + ".";

function current(): any {
  return {
    id: "p1",
    title: "Libro",
    generation_progress: {},
    state: {
      book_topic: "Encargo",
      outline_12: [1, 2, 3].map((n) => ({ chapter_number: n, chapter_title: `C${n}`, target_words: 5000 })),
      proposal: { text: words(2100, "propReal") },
      introduction: { text: "" },
      chapters: [
        { chapter_number: 1, title: "C1", text: words(1137, "cap1Real") },
        { chapter_number: 2, title: "C2", text: words(967, "cap2Real") },
      ],
    },
  };
}

// La IA devuelve el estado completo, con versiones nuevas de todo.
function aiResult(extra: any = {}): any {
  return {
    ok: true,
    dashboard: {},
    master_document: {},
    project_state_updated: {
      proposal: { text: words(2100, "propIA") },
      introduction: { text: words(1300, "introIA") },
      chapters: [
        { chapter_number: 1, title: "C1", text: words(1100, "cap1IA") },
        { chapter_number: 2, title: "C2", text: words(950, "cap2IA") },
      ],
      ...extra,
    },
  };
}

const text = (p: any, n: number) => p.state.chapters.find((c: any) => c.chapter_number === n)?.text ?? "";

describe("sello de secciones generadas", () => {
  it("generar la introducción no toca la propuesta ni los capítulos escritos", () => {
    const next: any = processEngineResult(aiResult(), current(), { action: "GENERATE_INTRODUCTION" });
    expect(next.state.introduction.text.startsWith("introIA")).toBe(true);
    expect(next.state.proposal.text.startsWith("propReal")).toBe(true);
    expect(text(next, 1).startsWith("cap1Real")).toBe(true);
    expect(text(next, 2).startsWith("cap2Real")).toBe(true);
  });

  it("generar la propuesta no toca la introducción ni los capítulos", () => {
    const cur = current();
    cur.state.introduction.text = words(1300, "introReal");
    const next: any = processEngineResult(aiResult(), cur, { action: "GENERATE_PROPOSAL" });
    expect(next.state.proposal.text.startsWith("propIA")).toBe(true);
    expect(next.state.introduction.text.startsWith("introReal")).toBe(true);
    expect(text(next, 1).startsWith("cap1Real")).toBe(true);
  });

  it("regenerar el capítulo 2 (Editar) solo cambia el capítulo 2", () => {
    const next: any = processEngineResult(aiResult(), current(), { action: "GENERATE_CHAPTER", chapterNum: 2 });
    expect(text(next, 2).startsWith("cap2IA")).toBe(true);
    expect(text(next, 1).startsWith("cap1Real")).toBe(true);
    expect(next.state.proposal.text.startsWith("propReal")).toBe(true);
  });

  it("un capítulo escrito que la IA omite o vacía se conserva", () => {
    const next: any = processEngineResult(
      aiResult({ chapters: [{ chapter_number: 2, title: "C2", text: "" }] }),
      current(),
      { action: "GENERATE_INTRODUCTION" }
    );
    expect(text(next, 1).startsWith("cap1Real")).toBe(true);
    expect(text(next, 2).startsWith("cap2Real")).toBe(true);
  });

  it("las secciones vacías sí se pueden generar", () => {
    const next: any = processEngineResult(
      aiResult({ chapters: [{ chapter_number: 3, title: "C3", text: words(1200, "cap3IA") }] }),
      current(),
      { action: "GENERATE_CHAPTER", chapterNum: 3 }
    );
    expect(text(next, 3).startsWith("cap3IA")).toBe(true);
    expect(text(next, 1).startsWith("cap1Real")).toBe(true);
  });
});
