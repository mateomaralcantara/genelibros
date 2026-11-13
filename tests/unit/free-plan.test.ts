import { describe, expect, it } from "vitest";
import { FREE_PLAN_ACTIONS, assertFreePlanAllows, countWordsDeep } from "../../src/server/free-plan";

describe("plan gratis (servidor)", () => {
  it("solo incluye el expediente con el índice", () => {
    expect([...FREE_PLAN_ACTIONS]).toEqual(["BUILD_FULL_DOSSIER"]);
  });

  it("pide pasar a un plan de pago para propuesta, introducción y capítulos", async () => {
    for (const action of ["GENERATE_PROPOSAL", "GENERATE_INTRODUCTION", "GENERATE_CHAPTER", ""]) {
      await expect(assertFreePlanAllows("11111111-1111-1111-1111-111111111111", action)).rejects.toMatchObject({ statusCode: 402, code: "FREE_PLAN_UPGRADE" });
    }
  });

  it("cuenta las palabras de todos los textos", () => {
    expect(countWordsDeep({ a: "uno dos", b: [{ c: "tres" }, 4, null], d: { e: " cuatro  cinco " } })).toBe(5);
  });
});
