// Exportación del libro a PDF y Word.
// Este módulo y sus librerías (jspdf, docx: ~750 KB) se cargan solo al
// exportar (import() dinámico desde BookViewer).

import { jsPDF } from 'jspdf';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { Project } from '../types';

export type ExportSection = {
  /** Título de la sección ("Propuesta editorial", "Capítulo 3: ..."). Vacío = texto sin título. */
  heading: string;
  /** Texto en Markdown. */
  markdown: string;
};

export type ExportBook = {
  title: string;
  sections: ExportSection[];
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Markdown → texto plano conservando párrafos y viñetas. */
export const markdownToText = (markdown: string): string =>
  String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Reúne el libro a exportar: propuesta, introducción y capítulos en orden.
 * Si el estado no tiene secciones con texto, usa el documento maestro.
 * Tolera libros incompletos (antes fallaba si faltaba la propuesta).
 */
export function buildExportBook(project: Project): ExportBook {
  const st: any = (project as any)?.state ?? {};
  const title = str(st.book_title).trim() || str((project as any)?.title).trim() || 'Libro';
  const sections: ExportSection[] = [];

  const proposal = str(st.proposal?.text).trim();
  if (proposal) sections.push({ heading: 'Propuesta editorial', markdown: proposal });

  const intro = str(st.introduction?.text).trim();
  if (intro) sections.push({ heading: 'Introducción', markdown: intro });

  const chapters = (Array.isArray(st.chapters) ? st.chapters : [])
    .filter((c: any) => str(c?.text).trim())
    .sort((a: any, b: any) => (Number(a?.chapter_number) || 0) - (Number(b?.chapter_number) || 0));

  for (const ch of chapters) {
    const n = Number(ch?.chapter_number) || 0;
    const chTitle = str(ch?.title).trim();
    const heading = n ? `Capítulo ${n}${chTitle && chTitle !== `Capítulo ${n}` ? `: ${chTitle}` : ''}` : chTitle;
    sections.push({ heading, markdown: str(ch.text).trim() });
  }

  if (!sections.length) {
    const master = str((project as any)?.master_document?.text).trim();
    if (master) sections.push({ heading: '', markdown: master });
  }

  return { title, sections };
}

export const fileNameFor = (title: string, ext: 'pdf' | 'docx'): string => {
  const base = String(title || 'libro')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${base || 'libro'}.${ext}`;
};

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* ------------------------------------------------------------------ PDF -- */

/**
 * PDF con texto real (A4, márgenes, saltos de página automáticos).
 * Sustituye a la "foto" de la pantalla con html2canvas, que no encontraba
 * el contenedor y además no puede capturar libros largos.
 */
export function buildPdf(book: ExportBook): jsPDF {
  const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 64;
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - margin) {
      pdf.addPage();
      y = margin;
    }
  };

  const write = (text: string, size: number, style: 'normal' | 'bold', gapAfter: number) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    const lineH = size * 1.4;
    for (const line of pdf.splitTextToSize(text, maxW) as string[]) {
      ensureSpace(lineH);
      pdf.text(line, margin, y + size);
      y += lineH;
    }
    y += gapAfter;
  };

  // Portada
  y = pageH / 3;
  write(book.title, 26, 'bold', 0);

  for (const section of book.sections) {
    pdf.addPage();
    y = margin;
    if (section.heading) write(section.heading, 18, 'bold', 14);
    for (const paragraph of markdownToText(section.markdown).split(/\n{2,}/)) {
      const p = paragraph.replace(/\n/g, ' ').trim();
      if (p) write(p, 11, 'normal', 8);
    }
  }

  return pdf;
}

export const generatePdf = async (project: Project): Promise<void> => {
  const book = buildExportBook(project);
  if (!book.sections.length) throw new Error('El libro aún no tiene contenido para exportar.');
  buildPdf(book).save(fileNameFor(book.title, 'pdf'));
};

/* ----------------------------------------------------------------- Word -- */

export function buildDocx(book: ExportBook): Document {
  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: book.title, bold: true, size: 48 })],
      heading: HeadingLevel.TITLE,
      spacing: { after: 400 },
    }),
  ];

  for (const section of book.sections) {
    if (section.heading) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: section.heading, bold: true, size: 32 })],
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: true,
          spacing: { after: 200 },
        })
      );
    }
    for (const paragraph of markdownToText(section.markdown).split(/\n{2,}/)) {
      const p = paragraph.replace(/\n/g, ' ').trim();
      if (p) children.push(new Paragraph({ children: [new TextRun(p)], spacing: { after: 160 } }));
    }
  }

  return new Document({ sections: [{ properties: {}, children }] });
}

export const generateDocx = async (project: Project): Promise<void> => {
  const book = buildExportBook(project);
  if (!book.sections.length) throw new Error('El libro aún no tiene contenido para exportar.');
  const blob = await Packer.toBlob(buildDocx(book));
  triggerDownload(blob, fileNameFor(book.title, 'docx'));
};
