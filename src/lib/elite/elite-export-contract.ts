export type EliteExportFormat = "pdf" | "docx" | "epub";

export type EliteExportRequest = {
  project_id: string;
  format: EliteExportFormat;
  includeCover?: boolean;
  includeTableOfContents?: boolean;
  includeBibliography?: boolean;
  includeResearchNotes?: boolean;
  fileName?: string;
};

export type EliteExportResult = {
  ok: boolean;
  format: EliteExportFormat;
  fileName: string;
  path?: string;
  error?: string;
};

export const ELITE_EXPORT_FORMATS: EliteExportFormat[] = [
  "pdf",
  "docx",
  "epub",
];

export function validateExportRequest(req: EliteExportRequest): string[] {
  const errors: string[] = [];

  if (!req.project_id) errors.push("project_id requerido.");
  if (!ELITE_EXPORT_FORMATS.includes(req.format)) {
    errors.push("Formato inválido. Usa pdf, docx o epub.");
  }

  return errors;
}

export function buildExportFileName(args: {
  title: string;
  format: EliteExportFormat;
}): string {
  const base = String(args.title || "bestseller-book")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "bestseller-book";

  return base + "." + args.format;
}
