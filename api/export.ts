const EXPORT_FORMATS = ["pdf", "docx", "epub"] as const;

type ExportFormat = typeof EXPORT_FORMATS[number];

function isExportFormat(value: string): value is ExportFormat {
  return EXPORT_FORMATS.includes(value as ExportFormat);
}

function buildFileName(title: string, format: ExportFormat): string {
  const base =
    String(title || "bestseller-book")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "bestseller-book";

  return base + "." + format;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const project_id = String(body.project_id || "").trim();
    const format = String(body.format || "pdf").trim().toLowerCase();
    const title = String(body.title || "BestSeller Book").trim();
    const content = String(body.content || "").trim();

    if (!project_id) {
      return res.status(400).json({
        ok: false,
        error: "project_id requerido.",
      });
    }

    if (!isExportFormat(format)) {
      return res.status(400).json({
        ok: false,
        error: "Formato inválido. Usa pdf, docx o epub.",
      });
    }

    return res.status(200).json({
      ok: true,
      project_id,
      format,
      export: true,
      pdf: format === "pdf",
      docx: format === "docx",
      epub: format === "epub",
      fileName: buildFileName(title, format),
      bytes_estimated: Buffer.byteLength(content || title, "utf8"),
      message:
        "Contrato de exportación listo. Conecta aquí el generador binario real PDF/DOCX/EPUB.",
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: String(error?.message || error),
    });
  }
}
