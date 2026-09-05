import fs from "node:fs";
import path from "node:path";

const runtimeFile = path.resolve(process.cwd(), "src/server/research-intelligence-runtime.ts");
let runtime = fs.readFileSync(runtimeFile, "utf8").replace(/\r\n?/g, "\n");
const MARKER = "RESEARCH_DOCUMENT_INGESTION_V1";

function assertInstalled(source) {
  const checks = [
    ["marker", source.includes(MARKER)],
    ["document import", source.includes('from "./research-document-ingestion.js"')),
    ["binary reader", source.includes("readResponseBytesLimited")),
    ["document detection", source.includes("detectResearchDocumentKind(type, url.toString())")),
    ["document extraction", source.includes("extractResearchDocumentText")),
    ["document byte limit", source.includes("researchDocumentLimits().maxBytes")],
    ["text byte limit preserved", source.includes("MAX_FETCH_BYTES")],
    ["ssrf validation preserved", source.includes("await assertPublicUrl(current)"))
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) throw new Error(`RESEARCH_DOCUMENT_INGESTION_PATCH_INCOMPLETE: ${missing.join(", ")}`);
}

if (runtime.includes(MARKER)) {
  assertInstalled(runtime);
  console.log("[Genelibros] RESEARCH DOCUMENT INGESTION V1 ya estaba instalado y validado.");
  process.exit(0);
}

const importNeedle = 'import net from "node:net";';
const importReplacement = `${importNeedle}\nimport {\n  detectResearchDocumentKind,\n  extractResearchDocumentText,\n  researchDocumentLimits,\n} from "./research-document-ingestion.js";`;
if (!runtime.includes(importNeedle)) throw new Error("RESEARCH_DOCUMENT_INGESTION_PATCH_INCOMPLETE: import marker no encontrado.");
runtime = runtime.replace(importNeedle, importReplacement);

runtime = runtime.replace("const MAX_EXTRACT_CHARS = 14000;", "const MAX_EXTRACT_CHARS = 30000;");

const fetchStart = runtime.indexOf("async function fetchPublicText(inputUrl: string) {");
const classMarker = runtime.indexOf("\nconst CLASS_A_DOMAINS", fetchStart);
if (fetchStart < 0 || classMarker < 0) {
  throw new Error("RESEARCH_DOCUMENT_INGESTION_PATCH_INCOMPLETE: fetchPublicText bounds no encontrados.");
}

const replacement = `// ${MARKER}\nasync function readResponseBytesLimited(response: Response, maxBytes: number): Promise<Uint8Array> {\n  const declaredLength = Number(response.headers.get("content-length") || 0);\n  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {\n    throw new Error(\`Documento demasiado grande: \${declaredLength} bytes > \${maxBytes}.\`);\n  }\n  if (!response.body) throw new Error("La fuente no contiene cuerpo legible.");\n\n  const reader = response.body.getReader();\n  const chunks: Uint8Array[] = [];\n  let total = 0;\n  try {\n    while (true) {\n      const { done, value } = await reader.read();\n      if (done) break;\n      if (!value) continue;\n      total += value.byteLength;\n      if (total > maxBytes) {\n        try { await reader.cancel("GENELIBROS_DOCUMENT_MAX_BYTES"); } catch {}\n        throw new Error(\`Documento supera límite seguro de \${maxBytes} bytes.\`);\n      }\n      chunks.push(value);\n    }\n  } finally {\n    try { reader.releaseLock(); } catch {}\n  }\n\n  const combined = new Uint8Array(total);\n  let offset = 0;\n  for (const chunk of chunks) {\n    combined.set(chunk, offset);\n    offset += chunk.byteLength;\n  }\n  return combined;\n}\n\nasync function fetchPublicText(inputUrl: string) {\n  let current = inputUrl;\n  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {\n    const url = await assertPublicUrl(current);\n    const controller = new AbortController();\n    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);\n    try {\n      const response = await fetch(url, {\n        redirect: "manual",\n        signal: controller.signal,\n        headers: {\n          "user-agent": "GenelibrosResearchBot/1.0",\n          accept: "text/html,text/plain,application/json,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;q=0.9,*/*;q=0.2",\n        },\n      });\n      if ([301,302,303,307,308].includes(response.status)) {\n        const location = response.headers.get("location");\n        if (!location) throw new Error(\`Redirect \${response.status} sin Location.\`);\n        current = new URL(location, url).toString();\n        continue;\n      }\n      if (!response.ok) throw new Error(\`HTTP \${response.status}\`);\n\n      const type = response.headers.get("content-type") || "";\n      const documentKind = detectResearchDocumentKind(type, url.toString());\n      const length = Number(response.headers.get("content-length") || 0);\n\n      if (documentKind) {\n        const maxBytes = researchDocumentLimits().maxBytes;\n        if (Number.isFinite(length) && length > maxBytes) {\n          throw new Error(\`Documento \${documentKind} demasiado grande: \${length} bytes > \${maxBytes}.\`);\n        }\n        const bytes = await readResponseBytesLimited(response, maxBytes);\n        const text = await extractResearchDocumentText({\n          bytes,\n          contentType: type,\n          url: response.url || url.toString(),\n        });\n        return { finalUrl: response.url || url.toString(), text: text.slice(0, MAX_EXTRACT_CHARS) };\n      }\n\n      if (Number.isFinite(length) && length > MAX_FETCH_BYTES) throw new Error("Fuente textual demasiado grande.");\n      const raw = await readResponseTextLimited(response);\n      const text = type.includes("html")\n        ? raw.replace(/<script[\\s\\S]*?<\\/script>/gi," ").replace(/<style[\\s\\S]*?<\\/style>/gi," ").replace(/<noscript[\\s\\S]*?<\\/noscript>/gi," ").replace(/<!--([\\s\\S]*?)-->/g," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\\s+/g," ").trim()\n        : raw.replace(/\\s+/g," ").trim();\n      return { finalUrl: response.url || url.toString(), text: text.slice(0, MAX_EXTRACT_CHARS) };\n    } finally {\n      clearTimeout(timer);\n    }\n  }\n  throw new Error("Demasiados redirects.");\n}\n`;

runtime = runtime.slice(0, fetchStart) + replacement + runtime.slice(classMarker);
assertInstalled(runtime);
fs.writeFileSync(runtimeFile, runtime, "utf8");
console.log("[Genelibros] RESEARCH DOCUMENT INGESTION V1 instalado: PDF + XLS/XLSX con límites seguros.");
console.log("[Genelibros] SSRF/DNS/redirect guards preservados; 0 LLM durante extracción documental.");
