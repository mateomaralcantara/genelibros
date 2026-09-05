import * as XLSX from "xlsx";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const DEFAULT_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const HARD_MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_DOCUMENT_CHARS = 60_000;
const HARD_MAX_DOCUMENT_CHARS = 120_000;
const DEFAULT_MAX_PDF_PAGES = 80;
const HARD_MAX_PDF_PAGES = 250;
const DEFAULT_MAX_SHEETS = 12;
const HARD_MAX_SHEETS = 40;
const DEFAULT_MAX_ROWS_PER_SHEET = 4_000;
const HARD_MAX_ROWS_PER_SHEET = 15_000;

function boundedEnvNumber(name: string, fallback: number, hardMax: number) {
  const raw = Number(process.env[name] || fallback);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(hardMax, Math.max(1, Math.round(raw)));
}

export function researchDocumentLimits() {
  return {
    maxBytes: boundedEnvNumber(
      "RESEARCH_DOCUMENT_MAX_BYTES",
      DEFAULT_MAX_DOCUMENT_BYTES,
      HARD_MAX_DOCUMENT_BYTES,
    ),
    maxChars: boundedEnvNumber(
      "RESEARCH_DOCUMENT_MAX_CHARS",
      DEFAULT_MAX_DOCUMENT_CHARS,
      HARD_MAX_DOCUMENT_CHARS,
    ),
    maxPdfPages: boundedEnvNumber(
      "RESEARCH_PDF_MAX_PAGES",
      DEFAULT_MAX_PDF_PAGES,
      HARD_MAX_PDF_PAGES,
    ),
    maxSheets: boundedEnvNumber(
      "RESEARCH_SHEET_MAX_SHEETS",
      DEFAULT_MAX_SHEETS,
      HARD_MAX_SHEETS,
    ),
    maxRowsPerSheet: boundedEnvNumber(
      "RESEARCH_SHEET_MAX_ROWS",
      DEFAULT_MAX_ROWS_PER_SHEET,
      HARD_MAX_ROWS_PER_SHEET,
    ),
  };
}

function normalizedContentType(value: string) {
  return String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function normalizedPath(value: string) {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return String(value || "").toLowerCase();
  }
}

export type ResearchDocumentKind = "PDF" | "SPREADSHEET" | null;

export function detectResearchDocumentKind(
  contentType: string,
  url: string,
): ResearchDocumentKind {
  const type = normalizedContentType(contentType);
  const path = normalizedPath(url);

  if (
    type === "application/pdf" ||
    path.endsWith(".pdf")
  ) {
    return "PDF";
  }

  if (
    type === "application/vnd.ms-excel" ||
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    type === "application/vnd.ms-excel.sheet.binary.macroenabled.12" ||
    type === "application/vnd.ms-excel.sheet.macroenabled.12" ||
    /\.(xls|xlsx|xlsm|xlsb)$/.test(path)
  ) {
    return "SPREADSHEET";
  }

  return null;
}

function clipText(value: string, maxChars: number) {
  const text = String(value || "").replace(/\u0000/g, "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[GENELIBROS_DOCUMENT_TRUNCATED]`;
}

function sheetNameSafe(value: string) {
  return String(value || "Sheet")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 120);
}

export function extractSpreadsheetText(bytes: Uint8Array) {
  const limits = researchDocumentLimits();
  if (!bytes?.byteLength) throw new Error("Spreadsheet vacío.");
  if (bytes.byteLength > limits.maxBytes) {
    throw new Error(
      `Spreadsheet supera RESEARCH_DOCUMENT_MAX_BYTES (${bytes.byteLength} > ${limits.maxBytes}).`,
    );
  }

  const workbook = XLSX.read(bytes, {
    type: "array",
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellText: true,
    sheetRows: limits.maxRowsPerSheet,
    dense: true,
  } as XLSX.ParsingOptions);

  const parts: string[] = [];
  let chars = 0;

  for (const rawName of workbook.SheetNames.slice(0, limits.maxSheets)) {
    const sheet = workbook.Sheets[rawName];
    if (!sheet) continue;

    const csv = XLSX.utils.sheet_to_csv(sheet, {
      FS: "\t",
      RS: "\n",
      blankrows: false,
      strip: true,
    });

    const block = `### SHEET: ${sheetNameSafe(rawName)}\n${csv.trim()}`.trim();
    if (!block) continue;

    const remaining = limits.maxChars - chars;
    if (remaining <= 0) break;

    const clipped = block.slice(0, remaining);
    parts.push(clipped);
    chars += clipped.length + 2;

    if (clipped.length < block.length) {
      parts.push("[GENELIBROS_SPREADSHEET_TRUNCATED]");
      break;
    }
  }

  const text = clipText(parts.join("\n\n"), limits.maxChars);
  if (!text) throw new Error("Spreadsheet sin celdas legibles.");
  return text;
}

export async function extractPdfText(bytes: Uint8Array) {
  const limits = researchDocumentLimits();
  if (!bytes?.byteLength) throw new Error("PDF vacío.");
  if (bytes.byteLength > limits.maxBytes) {
    throw new Error(
      `PDF supera RESEARCH_DOCUMENT_MAX_BYTES (${bytes.byteLength} > ${limits.maxBytes}).`,
    );
  }

  const loadingTask = getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
  } as any);

  const pdf = await loadingTask.promise;
  const parts: string[] = [];
  let chars = 0;

  try {
    const pageCount = Math.min(pdf.numPages, limits.maxPdfPages);

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let current = "";

      for (const item of content.items as any[]) {
        const token = typeof item?.str === "string" ? item.str.trim() : "";
        if (token) current += `${current ? " " : ""}${token}`;
        if (item?.hasEOL && current) {
          lines.push(current);
          current = "";
        }
      }
      if (current) lines.push(current);

      const block = `### PAGE ${pageNumber}\n${lines.join("\n")}`.trim();
      const remaining = limits.maxChars - chars;
      if (remaining <= 0) break;

      const clipped = block.slice(0, remaining);
      if (clipped) parts.push(clipped);
      chars += clipped.length + 2;

      if (clipped.length < block.length) {
        parts.push("[GENELIBROS_PDF_TRUNCATED]");
        break;
      }
    }

    if (pdf.numPages > limits.maxPdfPages && chars < limits.maxChars) {
      parts.push(`[GENELIBROS_PDF_PAGE_LIMIT ${limits.maxPdfPages}/${pdf.numPages}]`);
    }
  } finally {
    await pdf.destroy().catch(() => undefined);
  }

  const text = clipText(parts.join("\n\n"), limits.maxChars);
  if (!text) throw new Error("PDF sin texto extraíble. Puede ser un escaneo sin capa de texto.");
  return text;
}

export async function extractResearchDocumentText(input: {
  bytes: Uint8Array;
  contentType: string;
  url: string;
}) {
  const kind = detectResearchDocumentKind(input.contentType, input.url);
  if (kind === "PDF") return extractPdfText(input.bytes);
  if (kind === "SPREADSHEET") return extractSpreadsheetText(input.bytes);
  throw new Error("Formato documental no soportado por Research.");
}
