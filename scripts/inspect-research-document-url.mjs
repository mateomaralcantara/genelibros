import dns from "node:dns/promises";
import net from "node:net";
import * as XLSX from "xlsx";
import { PDFParse } from "pdf-parse";

const MAX_BYTES = Math.min(
  100 * 1024 * 1024,
  Math.max(1024, Number(process.env.RESEARCH_DOCUMENT_MAX_BYTES || 25 * 1024 * 1024)),
);
const MAX_CHARS = Math.min(
  120_000,
  Math.max(5_000, Number(process.env.RESEARCH_DOCUMENT_MAX_CHARS || 60_000)),
);
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;

function argValue(name, fallback = "") {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? String(args[i + 1]).trim() : fallback;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
  }
  const n = String(ip || "").toLowerCase();
  return n === "::1" || n === "::" || n.startsWith("fc") || n.startsWith("fd") || n.startsWith("fe80:");
}

async function assertPublicUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Solo http/https.");
  if (url.username || url.password) throw new Error("URLs con credenciales no permitidas.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Host local bloqueado.");
  }
  if (net.isIP(host) && isPrivateIp(host)) throw new Error("IP privada bloqueada.");
  const records = await dns.lookup(host, { all: true });
  if (!records.length || records.some((r) => isPrivateIp(r.address))) {
    throw new Error("Destino DNS privado bloqueado.");
  }
  return url;
}

async function readBytes(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new Error(`Documento demasiado grande: ${declared} bytes > ${MAX_BYTES}.`);
  }
  if (!response.body) throw new Error("Respuesta sin cuerpo.");

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        try { await reader.cancel("GENELIBROS_DOCUMENT_MAX_BYTES"); } catch {}
        throw new Error(`Documento supera límite de ${MAX_BYTES} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function detectKind(type, url) {
  const contentType = String(type || "").split(";", 1)[0].trim().toLowerCase();
  const path = new URL(url).pathname.toLowerCase();
  if (contentType === "application/pdf" || path.endsWith(".pdf")) return "PDF";
  if (
    contentType === "application/vnd.ms-excel" ||
    contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    /\.(xls|xlsx|xlsm|xlsb)$/.test(path)
  ) return "SPREADSHEET";
  return null;
}

function clip(value) {
  const text = String(value || "").replace(/\u0000/g, "").trim();
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[TRUNCATED]` : text;
}

function parseSpreadsheet(bytes) {
  const workbook = XLSX.read(bytes, {
    type: "array",
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellText: true,
    sheetRows: 4000,
    dense: true,
  });
  const parts = [];
  for (const name of workbook.SheetNames.slice(0, 12)) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, {
      FS: "\t",
      RS: "\n",
      blankrows: false,
      strip: true,
    });
    if (csv.trim()) parts.push(`### SHEET: ${name}\n${csv.trim()}`);
    if (parts.join("\n\n").length >= MAX_CHARS) break;
  }
  return clip(parts.join("\n\n"));
}

async function parsePdf(bytes) {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText({
      first: 80,
      lineEnforce: true,
      cellSeparator: "\t",
      pageJoiner: "\n### PAGE page_number / total_number\n",
    });
    return clip(result?.text || "");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function fetchDocument(inputUrl) {
  let current = inputUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const url = await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "GenelibrosResearchDocumentInspector/1.0",
          accept: "application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.2",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Redirect ${response.status} sin Location.`);
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const finalUrl = response.url || url.toString();
      const contentType = response.headers.get("content-type") || "";
      const kind = detectKind(contentType, finalUrl);
      if (!kind) throw new Error(`Formato no soportado: ${contentType || "desconocido"}`);
      const bytes = await readBytes(response);
      const text = kind === "PDF" ? await parsePdf(bytes) : parseSpreadsheet(bytes);
      return { finalUrl, contentType, kind, bytes: bytes.byteLength, text };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Demasiados redirects.");
}

const url = argValue("--url", "");
if (!url) {
  console.error("Uso: node scripts/inspect-research-document-url.mjs --url <https://...pdf|xls|xlsx>");
  process.exit(2);
}

const result = await fetchDocument(url);
console.log("\n================================================");
console.log(" GENELIBROS — RESEARCH DOCUMENT URL INSPECT / READ ONLY");
console.log("================================================");
console.log({
  llmCalls: 0,
  mutations: 0,
  networkFetches: 1,
  kind: result.kind,
  bytes: result.bytes,
  contentType: result.contentType,
  finalUrl: result.finalUrl,
  extractedChars: result.text.length,
});
console.log("\n--- EXTRACT PREVIEW ---");
console.log(result.text.slice(0, 5000));
console.log("\n[Genelibros] DOCUMENT INSPECT terminado. 0 llamadas LLM | 0 mutaciones.");
