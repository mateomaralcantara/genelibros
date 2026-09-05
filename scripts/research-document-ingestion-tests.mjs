import fs from "node:fs";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const moduleText = fs.readFileSync("src/server/research-document-ingestion.ts", "utf8");
const patchText = fs.readFileSync("scripts/patch-research-document-ingestion.mjs", "utf8");
const checks = [];
function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
}

check("SheetJS XLS/XLSX import exists", moduleText.includes('from "xlsx"'));
check("PDF.js import exists", moduleText.includes('pdfjs-dist/legacy/build/pdf.mjs'));
check("legacy XLS detection exists", moduleText.includes('/\\.(xls|xlsx|xlsm|xlsb)$/'));
check("PDF detection exists", moduleText.includes('type === "application/pdf"'));
check("document default max is 25MB", moduleText.includes("25 * 1024 * 1024"));
check("document hard max is 100MB", moduleText.includes("100 * 1024 * 1024"));
check("spreadsheet formulas are disabled", moduleText.includes("cellFormula: false"));
check("spreadsheet rows are capped", moduleText.includes("sheetRows: limits.maxRowsPerSheet"));
check("spreadsheet sheets are capped", moduleText.includes("slice(0, limits.maxSheets)"));
check("PDF eval is disabled", moduleText.includes("isEvalSupported: false"));
check("PDF pages are capped", moduleText.includes("Math.min(pdf.numPages, limits.maxPdfPages)"));
check("runtime patch preserves public URL validation", patchText.includes("await assertPublicUrl(current)"));
check("runtime patch preserves redirect validation", patchText.includes("MAX_REDIRECTS"));
check("runtime patch has binary streaming cap", patchText.includes("readResponseBytesLimited"));
check("runtime patch is idempotent", patchText.includes("ya estaba instalado y validado"));

// Real legacy .XLS round-trip, entirely local.
const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.aoa_to_sheet([
  ["Año", "Subsidio eléctrico RD$ millones"],
  [2022, 87944.3],
  [2025, 103231.3],
]);
XLSX.utils.book_append_sheet(workbook, sheet, "Subsidio");
const xlsBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xls" });
const parsedWorkbook = XLSX.read(xlsBuffer, { type: "buffer", cellFormula: false });
const parsedCsv = XLSX.utils.sheet_to_csv(parsedWorkbook.Sheets[parsedWorkbook.SheetNames[0]], {
  FS: "\t",
  blankrows: false,
});
check("real legacy XLS parses locally", parsedCsv.includes("87944.3") && parsedCsv.includes("103231.3"));

// Real PDF round-trip, entirely local.
const pdfWriter = new jsPDF();
pdfWriter.text("Subsidio electrico RD 103231.3 millones", 10, 20);
const pdfBytes = new Uint8Array(pdfWriter.output("arraybuffer"));
const loadingTask = getDocument({
  data: pdfBytes,
  isEvalSupported: false,
  useSystemFonts: false,
  useWorkerFetch: false,
});
const pdf = await loadingTask.promise;
let pdfText = "";
try {
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  pdfText = content.items.map((item) => typeof item?.str === "string" ? item.str : "").join(" ");
} finally {
  await pdf.destroy().catch(() => undefined);
}
check("real PDF text parses locally", pdfText.includes("103231.3"));

const failed = checks.filter((x) => !x.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} Research Document Ingestion checks passed.`);
console.log("LLM calls: 0 | Network calls: 0");
if (failed.length) process.exit(1);
