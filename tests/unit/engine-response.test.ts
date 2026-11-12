import { describe, expect, it } from "vitest";
import {
  chapterIsComplete,
  countWordsQuick,
  isPlaceholderText,
  safeJsonParse,
  validateEngineResult,
} from "../../src/lib/editor";

describe("safeJsonParse — respuestas imperfectas del modelo", () => {
  it("parsea JSON limpio", () => {
    expect(safeJsonParse('{"ok":true,"n":1}')).toEqual({ ok: true, n: 1 });
  });

  it("quita bloques ```json del modelo", () => {
    expect(safeJsonParse('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("extrae el JSON aunque venga rodeado de texto", () => {
    expect(safeJsonParse('Aquí tienes el resultado:\n{"ok":true,"x":"y"}\nEspero que sirva.')).toEqual({ ok: true, x: "y" });
  });

  it("tolera comas finales", () => {
    expect(safeJsonParse('{"a":[1,2,],"b":2,}')).toEqual({ a: [1, 2], b: 2 });
  });

  it("falla con un mensaje claro si no hay JSON", () => {
    expect(() => safeJsonParse("")).toThrow(/vacía/);
    expect(() => safeJsonParse("sin json aquí")).toThrow();
  });
});

describe("validateEngineResult", () => {
  const valid = { ok: true, project_state_updated: {}, master_document: {}, dashboard: {} };

  it("acepta una respuesta completa", () => {
    expect(validateEngineResult(valid)).toBe(valid);
  });

  it("devuelve el mensaje del motor cuando ok=false", () => {
    expect(() => validateEngineResult({ ok: false, needs_input: { message: "Falta el tema" } })).toThrow("Falta el tema");
  });

  it("rechaza respuestas incompletas", () => {
    expect(() => validateEngineResult({ ok: true, master_document: {}, dashboard: {} })).toThrow(/project_state_updated/);
    expect(() => validateEngineResult("texto")).toThrow(/JSON object/);
  });
});

describe("detección de capítulos completos", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

  it("cuenta palabras", () => {
    expect(countWordsQuick("  uno  dos\ntres ")).toBe(3);
    expect(countWordsQuick("")).toBe(0);
  });

  it("marca como marcador de posición los textos vacíos o con '...'", () => {
    expect(isPlaceholderText("")).toBe(true);
    expect(isPlaceholderText("…")).toBe(true);
    expect(isPlaceholderText("Aquí irá el capítulo...")).toBe(true);
    expect(isPlaceholderText(words(300))).toBe(false);
  });

  it("exige al menos 2000 palabras, o el objetivo si es mayor", () => {
    expect(chapterIsComplete(words(1999))).toBe(false);
    expect(chapterIsComplete(words(2000))).toBe(true);
    expect(chapterIsComplete(words(2500), 3000)).toBe(false);
    expect(chapterIsComplete(words(3000), 3000)).toBe(true);
    expect(chapterIsComplete(words(2000), 1000)).toBe(true);
  });
});
