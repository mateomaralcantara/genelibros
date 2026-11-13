import { describe, expect, it } from "vitest";
import { buildBookPrompt, emptyPlan, planProblems } from "../../src/lib/promptPlanner";
import { extractBookTitleFromIdea, extractDesiredChapterCountSafe, extractChapterTitlesFromIdea } from "../../src/lib/outline";

const plan = {
  ...emptyPlan(),
  bookType: "Negocios y emprendimiento",
  idea: "Cómo pasé de empleado a emprendedor y los errores que todo principiante debe evitar.",
  workingTitle: "De empleado a dueño",
  audience: "Jóvenes que quieren emprender",
  chapters: 9,
  wordsPerChapter: 2500,
};

describe("planificador de prompt", () => {
  it("el motor entiende el título y el número de capítulos", () => {
    const prompt = buildBookPrompt(plan);
    expect(extractBookTitleFromIdea(prompt)).toBe("De empleado a dueño");
    expect(extractDesiredChapterCountSafe(prompt)).toBe(9);
    expect(prompt).toContain("PÚBLICO LECTOR: Jóvenes que quieren emprender");
    expect(prompt).not.toContain("PUNTO DE VISTA");
  });

  it("respeta los títulos de capítulos del autor", () => {
    const prompt = buildBookPrompt({ ...plan, chapters: 3, chapterTitles: "El día que renuncié\n2. Los números no mienten\nCapítulo 3: Mi primer cliente\nSobra" });
    expect(prompt).toContain("CAPÍTULO 1: El día que renuncié");
    expect(prompt).toContain("CAPÍTULO 2: Los números no mienten");
    expect(prompt).toContain("CAPÍTULO 3: Mi primer cliente");
    expect(prompt).not.toContain("Sobra");
    expect(extractDesiredChapterCountSafe(prompt)).toBe(3);
    const titles = extractChapterTitlesFromIdea(prompt);
    expect(titles.get(1)).toBe("El día que renuncié");
    expect(titles.get(3)).toBe("Mi primer cliente");
  });

  it("sin título pide proponer uno; en novelas añade el punto de vista", () => {
    const prompt = buildBookPrompt({ ...plan, workingTitle: "", bookType: "Novela" });
    expect(prompt).not.toContain("TÍTULO DE TRABAJO");
    expect(prompt).toContain("Propón un título editorial");
    expect(prompt).toContain("PUNTO DE VISTA: Primera persona");
  });

  it("acota capítulos y avisa de lo que falta", () => {
    expect(extractDesiredChapterCountSafe(buildBookPrompt({ ...plan, chapters: 500 }))).toBe(40);
    expect(planProblems(emptyPlan()).length).toBe(2);
    expect(planProblems(plan)).toEqual([]);
  });
});
