import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickSingletonSection } from "../../src/lib/editor";

const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ") + ".";

describe("pickSingletonSection (carga con filas duplicadas)", () => {
  // Caso real: 3 propuestas y 6 introducciones en el mismo libro.
  const rows = [
    { type: "PROPOSAL", content: "", updated_at: "2026-10-22T00:23:02Z" },
    { type: "PROPOSAL", content: "", updated_at: "2026-10-22T00:23:14Z" },
    { type: "PROPOSAL", content: words(961, "prop"), updated_at: "2026-10-22T00:23:24Z" },
    { type: "INTRODUCTION", content: "", updated_at: "2026-10-22T00:23:15Z" },
    { type: "INTRODUCTION", content: words(709, "i709"), updated_at: "2026-10-22T00:23:36Z" },
    { type: "INTRODUCTION", content: words(1165, "i1165"), updated_at: "2026-11-12T05:06:43Z" },
    { type: "INTRODUCTION", content: words(787, "i787"), updated_at: "2026-11-12T18:58:28Z" },
    { type: "CHAPTER", chapter_number: 1, content: "cap" },
  ];

  it("nunca elige una propuesta vacía si hay una con texto", () => {
    expect(pickSingletonSection(rows, "PROPOSAL")?.content.startsWith("prop")).toBe(true);
  });

  it("elige la introducción más reciente con texto", () => {
    expect(pickSingletonSection(rows, "INTRODUCTION")?.content.startsWith("i787")).toBe(true);
  });

  it("funciona con una sola fila o ninguna", () => {
    expect(pickSingletonSection([rows[2]], "PROPOSAL")).toBe(rows[2]);
    expect(pickSingletonSection([], "PROPOSAL")).toBeUndefined();
  });
});

// ---------- upsertSection: actualiza la propuesta existente en vez de duplicarla ----------
const calls = vi.hoisted(() => ({ log: [] as string[], existingId: null as string | null }));

vi.mock("../../src/lib/supabase", () => {
  const chain = (table: string): any => {
    const q: any = {};
    for (const m of ["select", "eq", "is", "order", "limit"]) q[m] = (...a: any[]) => (calls.log.push(`${table}.${m}(${a.map(String).join(",")})`), q);
    q.single = async () => ({ data: { id: table === "projects" ? "p1" : calls.existingId ?? "nuevo" }, error: null });
    q.maybeSingle = async () =>
      q.isUpsert ? { data: { id: "cap" }, error: null } : { data: calls.existingId ? { id: calls.existingId } : null, error: null };
    q.update = (row: any) => (calls.log.push(`${table}.update`), q);
    q.insert = (row: any) => (calls.log.push(`${table}.insert`), q);
    q.upsert = (row: any, opts: any) => ((q.isUpsert = true), calls.log.push(`${table}.upsert(${opts?.onConflict})`), q);
    return q;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }), getSession: async () => ({ data: { session: { user: { id: "u1" } } }, error: null }) },
      from: (table: string) => chain(table),
    },
  };
});

import { upsertSection } from "../../src/data/repo";

describe("upsertSection", () => {
  beforeEach(() => {
    calls.log = [];
    calls.existingId = null;
  });

  const proposal = { project_id: "p1", type: "PROPOSAL" as const, chapter_number: null, title: "Propuesta editorial", content: "x", status: "COMPLETED" as const };

  it("si la propuesta ya existe, la actualiza (no crea otra fila)", async () => {
    calls.existingId = "prop-1";
    await expect(upsertSection(proposal)).resolves.toBe("prop-1");
    expect(calls.log).toContain("sections.is(chapter_number,null)");
    expect(calls.log).toContain("sections.update");
    expect(calls.log).not.toContain("sections.insert");
  });

  it("si no existe, la inserta una vez", async () => {
    await upsertSection(proposal);
    expect(calls.log.filter((l) => l === "sections.insert")).toHaveLength(1);
    expect(calls.log).not.toContain("sections.update");
  });

  it("los capítulos siguen usando upsert por (proyecto, tipo, número)", async () => {
    await upsertSection({ ...proposal, type: "CHAPTER", chapter_number: 3 });
    expect(calls.log).toContain("sections.upsert(project_id,type,chapter_number)");
  });
});
