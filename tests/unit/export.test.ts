import { describe, expect, it } from "vitest";
import { Packer } from "docx";
import { unzipSync, strFromU8 } from "fflate";
import { buildDocx, buildExportBook, buildPdf, fileNameFor, markdownToText } from "../../utils/download";

const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");

function book(extra: any = {}): any {
  return {
    id: "p1",
    title: "Título del proyecto",
    state: {
      book_title: "El relevo del micrófono",
      proposal: { text: "## Propuesta\n\nUna **propuesta** editorial." },
      introduction: { text: "¿Por qué este libro? ¡Porque sí! Ñandú y acentos: áéíóú." },
      chapters: [
        { chapter_number: 2, title: "La decisión de ser distinto", text: `${words(3000, "dos")}.\n\nSegundo párrafo.` },
        { chapter_number: 1, title: "El peso de la herencia invisible", text: words(3000, "uno") },
        { chapter_number: 3, title: "Capítulo 3", text: "" },
      ],
      ...extra,
    },
  };
}

describe("buildExportBook", () => {
  it("ordena propuesta, introducción y capítulos con texto", () => {
    const b = buildExportBook(book());
    expect(b.title).toBe("El relevo del micrófono");
    expect(b.sections.map((s) => s.heading)).toEqual([
      "Propuesta editorial",
      "Introducción",
      "Capítulo 1: El peso de la herencia invisible",
      "Capítulo 2: La decisión de ser distinto",
    ]);
  });

  it("no falla si faltan propuesta o introducción (antes lanzaba un error)", () => {
    const b = buildExportBook(book({ proposal: undefined, introduction: undefined }));
    expect(b.sections.map((s) => s.heading)).toEqual([
      "Capítulo 1: El peso de la herencia invisible",
      "Capítulo 2: La decisión de ser distinto",
    ]);
  });

  it("usa el documento maestro si el estado no tiene secciones con texto", () => {
    const b = buildExportBook({ id: "p", title: "Libro", state: {}, master_document: { text: "# Libro\n\nTexto maestro" } } as any);
    expect(b.sections).toEqual([{ heading: "", markdown: "# Libro\n\nTexto maestro" }]);
  });
});

describe("markdownToText y fileNameFor", () => {
  it("quita marcas de Markdown conservando el texto", () => {
    expect(markdownToText("## Título\n\nTexto con **negrita**, *cursiva* y [enlace](https://x.com).\n- punto")).toBe(
      "Título\n\nTexto con negrita, cursiva y enlace.\n• punto"
    );
  });

  it("genera nombres de archivo seguros", () => {
    expect(fileNameFor("El relevo del micrófono: ¿y ahora?", "pdf")).toBe("El_relevo_del_microfono_y_ahora.pdf");
    expect(fileNameFor("", "docx")).toBe("libro.docx");
  });
});

describe("PDF", () => {
  it("genera un PDF de varias páginas con el contenido del libro largo", () => {
    const pdf = buildPdf(buildExportBook(book()));
    // portada + propuesta + intro + 2 capítulos largos (3.000 palabras cada uno)
    expect(pdf.getNumberOfPages()).toBeGreaterThan(10);
    const raw = pdf.output();
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(raw).toContain("El relevo del micr");
    expect(raw).toContain("Cap");
  });
});

describe("Word", () => {
  it("genera un .docx válido con título, secciones y acentos", async () => {
    const buffer = await Packer.toBuffer(buildDocx(buildExportBook(book())));
    const files = unzipSync(new Uint8Array(buffer));
    const xml = strFromU8(files["word/document.xml"]);
    expect(xml).toContain("El relevo del micrófono");
    expect(xml).toContain("Capítulo 1: El peso de la herencia invisible");
    expect(xml).toContain("¿Por qué este libro? ¡Porque sí! Ñandú y acentos: áéíóú.");
  });
});
