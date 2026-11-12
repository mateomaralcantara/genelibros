import { beforeEach, describe, expect, it, vi } from "vitest";

// Acceso a datos simulado: registramos lo que se guardaría en Supabase.
const repo = vi.hoisted(() => ({
  sections: [] as any[],
  versions: [] as any[],
  projects: [] as any[],
  snapshots: [] as any[],
}));

vi.mock("../../src/data/repo", () => ({
  upsertSection: async (row: any) => {
    repo.sections.push(row);
    return `sec-${repo.sections.length}`;
  },
  insertSectionVersion: async (sectionId: string, content: string) => {
    repo.versions.push({ sectionId, content });
  },
  updateProject: async (id: string, patch: any) => {
    repo.projects.push({ id, patch });
  },
  buildMasterServer: async () => "MASTER",
  insertMasterSnapshot: async (projectId: string, title: string, text: string) => {
    repo.snapshots.push({ projectId, title, text });
  },
}));

import {
  applyLegacyRepair,
  persistProjectMeta,
  rebuildAndSnapshotMaster,
  upsertOneSectionFromState,
} from "../../src/data/projectPersistence";

const project = (state: any = {}, extra: any = {}): any => ({ id: "p1", title: "Mi libro", state, ...extra });

beforeEach(() => {
  repo.sections = [];
  repo.versions = [];
  repo.projects = [];
  repo.snapshots = [];
});

describe("upsertOneSectionFromState", () => {
  it("guarda un capítulo con su título, texto y estado, y una versión en el historial", async () => {
    const p = project({
      chapters: [
        { chapter_number: 1, title: "Uno", text: "Texto uno", status: "COMPLETED" },
        { chapter_number: 2, title: "Dos", text: "Texto dos", status: "DRAFT" },
      ],
    });

    await upsertOneSectionFromState(p, "chapter", 2);

    expect(repo.sections).toEqual([
      { project_id: "p1", type: "CHAPTER", chapter_number: 2, title: "Dos", content: "Texto dos", status: "PENDING" },
    ]);
    expect(repo.versions).toEqual([{ sectionId: "sec-1", content: "Texto dos" }]);
  });

  it("marca COMPLETED solo si el capítulo lo está", async () => {
    await upsertOneSectionFromState(project({ chapters: [{ chapter_number: 1, title: "Uno", text: "x", status: "COMPLETED" }] }), "chapter", 1);
    expect(repo.sections[0].status).toBe("COMPLETED");
  });

  it("usa 'Capítulo N' y texto vacío si el capítulo aún no existe", async () => {
    await upsertOneSectionFromState(project({ chapters: [] }), "chapter", 3);
    expect(repo.sections[0]).toMatchObject({ chapter_number: 3, title: "Capítulo 3", content: "", status: "PENDING" });
  });

  it("no guarda nada si falta el número de capítulo", async () => {
    await upsertOneSectionFromState(project({ chapters: [] }), "chapter");
    expect(repo.sections).toHaveLength(0);
  });

  it("guarda la propuesta y la introducción con su tipo y título fijo", async () => {
    const p = project({
      proposal: { text: "Propuesta", status: "COMPLETED" },
      introduction: { text: "Intro" },
    });
    await upsertOneSectionFromState(p, "proposal");
    await upsertOneSectionFromState(p, "intro");

    expect(repo.sections).toEqual([
      { project_id: "p1", type: "PROPOSAL", chapter_number: null, title: "Propuesta editorial", content: "Propuesta", status: "COMPLETED" },
      { project_id: "p1", type: "INTRODUCTION", chapter_number: null, title: "Introducción", content: "Intro", status: "PENDING" },
    ]);
  });
});

describe("persistProjectMeta", () => {
  it("guarda los metadatos del libro con valores seguros por defecto", async () => {
    await persistProjectMeta(project({ book_topic: "Tema", outline_12: [{ chapter_number: 1 }] }, { dashboard: { a: 1 } }));
    expect(repo.projects).toEqual([
      {
        id: "p1",
        patch: {
          title: "Mi libro",
          topic: "Tema",
          audience: null,
          tone_style: null,
          dossier: { a: 1 },
          outline_12: [{ chapter_number: 1 }],
          continuity_pack: {},
        },
      },
    ]);
  });
});

describe("rebuildAndSnapshotMaster", () => {
  it("reconstruye el documento maestro y guarda una instantánea", async () => {
    await expect(rebuildAndSnapshotMaster(project())).resolves.toBe("MASTER");
    expect(repo.snapshots).toEqual([{ projectId: "p1", title: "Mi libro", text: "MASTER" }]);
  });
});

describe("applyLegacyRepair", () => {
  it("no hace nada en proyectos normales", async () => {
    await expect(applyLegacyRepair("p1", project())).resolves.toBe(false);
    expect(repo.projects).toHaveLength(0);
  });

  it("repara un proyecto legacy: índice, capítulos y documento maestro", async () => {
    const full = project(
      { chapters: [{ chapter_number: 1, title: "Real", text: "Texto", status: "COMPLETED" }] },
      { __legacyRepair: { title: "Título real", topic: "Tema", outline_12: [{ chapter_number: 1 }], continuity_pack: {} } }
    );

    await expect(applyLegacyRepair("p1", full)).resolves.toBe(true);
    expect(repo.projects[0].patch).toMatchObject({ title: "Título real", outline_12: [{ chapter_number: 1 }] });
    expect(repo.sections[0]).toMatchObject({ type: "CHAPTER", chapter_number: 1, title: "Real", status: "COMPLETED" });
    expect(full.master_document.text).toBe("MASTER");
    expect(full.__legacyRepair).toBeUndefined();
  });
});
