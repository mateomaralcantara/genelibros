import { GoogleGenAI } from "@google/genai";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import type {
  ResearchClaim,
  ResearchContradiction,
  ResearchDossier,
  ResearchEvidence,
  ResearchGap,
  ResearchQuery,
  ResearchQuestion,
  ResearchSource,
  ResearchUsage,
  SourceClass,
} from "../lib/research-intelligence/types.js";

type AnyRow = Record<string, any>;
const MODEL = process.env.RESEARCH_DEEP_MODEL || process.env.REFINERY_DEEP_MODEL || process.env.OS4_DEEP_MODEL || "gemini-3.6-flash";
const MAX_EXTRACT_CHARS = 14000;
const MAX_FETCH_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

const clean = (v: unknown) => typeof v === "string" ? v.trim() : "";
const makeId = (prefix: string, seed: string) => `${prefix}_${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;


/**
 * ============================================================
 * 11D.5 — CRITICAL EVIDENCE RESOLVER
 * ============================================================
 */

function normalizeGapFingerprintText(value: unknown) {
  const stop = new Set([
    "the","and","for","with","from","that",
    "de","del","la","las","el","los","y",
    "para","por","con","que","una","uno",
    "missing","lack","required","requires"
  ]);

  return Array.from(
    new Set(
      String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/g)
        .filter(
          token =>
            token.length > 2 &&
            !stop.has(token)
        )
    )
  )
    .sort()
    .join("|");
}

function stableGapFingerprint(value: unknown) {
  const normalized =
    normalizeGapFingerprintText(value);

  return makeId(
    "gapfp",
    normalized ||
      clean(value) ||
      "unknown-gap"
  );
}

function researchSourceAuthorityKey(source: any) {
  const raw =
    clean(source?.url);

  if (!raw) {
    return String(
      source?.id || "unknown"
    );
  }

  try {
    const url =
      new URL(raw);

    return url.hostname
      .toLowerCase()
      .replace(/^www\./, "");
  }
  catch {
    return raw.toLowerCase();
  }
}

function evidenceContainsNumber(
  evidence: any,
  value: number
) {
  if (!Number.isFinite(value)) {
    return false;
  }

  const text =
    String(evidence?.evidence || "")
      .replace(/\s+/g, " ");

  const variants = [
    String(value),
    value.toFixed(1),
    value.toFixed(2),
    value.toFixed(3)
  ];

  return variants.some(
    variant =>
      text.includes(variant)
  );
}

function calculateResolverDerivations(
  proposals: any[],
  evidence: any[]
) {
  const evidenceMap =
    new Map(
      (evidence || []).map(
        item => [
          String(item?.id || ""),
          item
        ]
      )
    );

  const calculations: any[] = [];

  for (
    const proposal of
    Array.isArray(proposals)
      ? proposals
      : []
  ) {
    const operation =
      clean(proposal?.operation)
        .toUpperCase();

    if (
      ![
        "RATIO_PERCENT",
        "SUM",
        "DIFFERENCE"
      ].includes(operation)
    ) {
      continue;
    }

    const leftValue =
      Number(proposal?.left?.value);

    const rightValue =
      Number(proposal?.right?.value);

    const leftEvidenceId =
      clean(proposal?.left?.evidenceId);

    const rightEvidenceId =
      clean(proposal?.right?.evidenceId);

    const leftEvidence =
      evidenceMap.get(leftEvidenceId);

    const rightEvidence =
      evidenceMap.get(rightEvidenceId);

    if (
      !leftEvidence ||
      !rightEvidence ||
      !Number.isFinite(leftValue) ||
      !Number.isFinite(rightValue)
    ) {
      continue;
    }

    if (
      !evidenceContainsNumber(
        leftEvidence,
        leftValue
      ) ||
      !evidenceContainsNumber(
        rightEvidence,
        rightValue
      )
    ) {
      continue;
    }

    let result: number | null = null;

    if (operation === "RATIO_PERCENT") {
      if (rightValue === 0) continue;

      result =
        (leftValue / rightValue) * 100;
    }

    if (operation === "SUM") {
      result =
        leftValue + rightValue;
    }

    if (operation === "DIFFERENCE") {
      result =
        leftValue - rightValue;
    }

    if (
      result === null ||
      !Number.isFinite(result)
    ) {
      continue;
    }

    calculations.push({
      id: makeId(
        "calc",
        [
          operation,
          leftEvidenceId,
          rightEvidenceId,
          leftValue,
          rightValue
        ].join(":")
      ),

      type:
        "DERIVED_OFFICIAL_CALCULATION",

      operation,

      left: {
        value: leftValue,
        evidenceId: leftEvidenceId
      },

      right: {
        value: rightValue,
        evidenceId: rightEvidenceId
      },

      result:
        Number(result.toFixed(6)),

      expectedUnit:
        clean(proposal?.expectedUnit) ||
        (
          operation === "RATIO_PERCENT"
            ? "%"
            : null
        ),

      note:
        clean(proposal?.note)
    });
  }

  return calculations;
}

function usageOf(response: AnyRow): ResearchUsage {
  const u = response?.usageMetadata || {};
  return {
    calls: 1,
    inputTokens: Number(u.promptTokenCount || 0),
    outputTokens: Number(u.candidatesTokenCount || 0),
    totalTokens: Number(u.totalTokenCount || 0),
  };
}

export function addUsage(a?: ResearchUsage, b?: ResearchUsage): ResearchUsage {
  return {
    calls: Number(a?.calls || 0) + Number(b?.calls || 0),
    inputTokens: Number(a?.inputTokens || 0) + Number(b?.inputTokens || 0),
    outputTokens: Number(a?.outputTokens || 0) + Number(b?.outputTokens || 0),
    totalTokens: Number(a?.totalTokens || 0) + Number(b?.totalTokens || 0),
  };
}

function ai() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY server-side.");
  return new GoogleGenAI({ apiKey: key });
}

function balancedJson(text: string) {
  const raw = clean(text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const positions = [raw.indexOf("{"), raw.indexOf("[")].filter((x) => x >= 0).sort((a, b) => a - b);
  if (!positions.length) return raw;
  const start = positions[0];
  const opener = raw[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const c = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === opener) depth += 1;
    if (c === closer) depth -= 1;
    if (depth === 0) return raw.slice(start, i + 1);
  }
  return raw.slice(start);
}

function parseJson(text: string): AnyRow {
  const candidate = balancedJson(text);
  try { return JSON.parse(candidate); }
  catch (first: any) {
    const repaired = candidate.replace(/,\s*([}\]])/g, "$1").replace(/\u0000/g, "");
    try { return JSON.parse(repaired); }
    catch {
      throw new Error(`Research Intelligence: respuesta JSON inválida. ${first?.message || first}. Preview: ${repaired.slice(0, 500).replace(/\s+/g, " ")}`);
    }
  }
}

async function generateJson(input: { system: string; prompt: string; temperature?: number; maxOutputTokens?: number }) {
  let maxOutputTokens = Math.max(2048, Number(input.maxOutputTokens || 8192));
  let aggregate: ResearchUsage = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await ai().models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: input.prompt }] }],
      config: {
        systemInstruction: input.system,
        responseMimeType: "application/json",
        temperature: input.temperature ?? 0.2,
        maxOutputTokens,
      } as any,
    });
    aggregate = addUsage(aggregate, usageOf(response as AnyRow));
    const text = clean((response as AnyRow)?.text);
    try { return { data: parseJson(text), usage: aggregate, model: MODEL }; }
    catch (error: any) {
      lastError = error;
      const finish = clean((response as AnyRow)?.candidates?.[0]?.finishReason).toUpperCase();
      const truncated = finish.includes("MAX_TOKENS") || /unterminated string|unexpected end/i.test(String(error?.message || error));
      if (!truncated || attempt >= 3 || maxOutputTokens >= 32768) throw error;
      maxOutputTokens = Math.min(32768, Math.max(maxOutputTokens + 4096, Math.ceil(maxOutputTokens * 1.7)));
    }
  }
  throw lastError || new Error("Research Intelligence: generación falló.");
}

function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a,b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const n = ip.toLowerCase();
  return n === "::1" || n === "::" || n.startsWith("fc") || n.startsWith("fd") || n.startsWith("fe80:");
}

async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Solo http/https.");
  if (url.username || url.password) throw new Error("URLs con credenciales no permitidas.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || (net.isIP(host) && isPrivateIp(host))) throw new Error("Host privado/local bloqueado.");
  const records = await dns.lookup(host, { all: true });
  if (!records.length || records.some((r) => isPrivateIp(r.address))) throw new Error("Destino DNS privado bloqueado.");
  return url;
}


async function readResponseTextLimited(
  response: Response,
): Promise<string> {

  const contentType = (
    response.headers.get("content-type") || ""
  ).toLowerCase();

  const textual =
    contentType.includes("text/") ||
    contentType.includes("application/json") ||
    contentType.includes("application/xml") ||
    contentType.includes("application/xhtml+xml") ||
    contentType.includes("application/rss+xml") ||
    contentType.includes("application/atom+xml");

  if (!textual) {
    throw new Error(
      `Tipo de contenido no textual bloqueado: ${contentType || "desconocido"}`
    );
  }

  const declaredLength = Number(
    response.headers.get("content-length") || 0
  );

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_FETCH_BYTES
  ) {
    throw new Error(
      `Fuente demasiado grande: ${declaredLength} bytes.`
    );
  }

  if (!response.body) {
    throw new Error(
      "La fuente no contiene cuerpo legible."
    );
  }

  const reader = response.body.getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {

    while (true) {

      const {
        done,
        value
      } = await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      total += value.byteLength;

      if (total > MAX_FETCH_BYTES) {

        try {
          await reader.cancel(
            "GENELIBROS_MAX_FETCH_BYTES"
          );
        } catch {}

        throw new Error(
          `Fuente supera límite seguro de ${MAX_FETCH_BYTES} bytes.`
        );
      }

      chunks.push(value);
    }

  } finally {

    try {
      reader.releaseLock();
    } catch {}

  }

  const combined =
    new Uint8Array(total);

  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder(
    "utf-8",
    { fatal: false }
  ).decode(combined);
}

async function fetchPublicText(inputUrl: string) {
  let current = inputUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const url = await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "GenelibrosResearchBot/1.0", accept: "text/html,text/plain,application/json;q=0.8,*/*;q=0.2" },
      });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Redirect ${response.status} sin Location.`);
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const length = Number(response.headers.get("content-length") || 0);
      if (length > 2_000_000) throw new Error("Fuente demasiado grande.");
      const raw = await readResponseTextLimited(response);
      const type = response.headers.get("content-type") || "";
      const text = type.includes("html")
        ? raw.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<noscript[\s\S]*?<\/noscript>/gi," ").replace(/<!--([\s\S]*?)-->/g," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g," ").trim()
        : raw.replace(/\s+/g," ").trim();
      return { finalUrl: response.url || url.toString(), text: text.slice(0, MAX_EXTRACT_CHARS) };
    } finally { clearTimeout(timer); }
  }
  throw new Error("Demasiados redirects.");
}

const CLASS_A_DOMAINS = [".gov", ".gov.do", ".edu", ".edu.do", "who.int", "worldbank.org", "imf.org", "oecd.org", "un.org", "europa.eu", "iadb.org", "bancentral.gov.do", "one.gob.do"];
const CLASS_B_DOMAINS = ["reuters.com", "apnews.com", "nature.com", "science.org", "iea.org", "brookings.edu", "cfr.org", "pewresearch.org"];

export function classifySource(url: string, publisher = ""): { sourceClass: SourceClass; credibilityScore: number } {
  const combined = `${new URL(url).hostname.toLowerCase()} ${publisher}`.toLowerCase();
  if (CLASS_A_DOMAINS.some((d) => combined.includes(d))) return { sourceClass: "A", credibilityScore: 9.5 };
  if (CLASS_B_DOMAINS.some((d) => combined.includes(d))) return { sourceClass: "B", credibilityScore: 8.4 };
  if (/newspaper|journal|institute|foundation|association|universidad|university/i.test(publisher)) return { sourceClass: "B", credibilityScore: 7.8 };
  if (/news|press|times|post|diario|hoy|listin|acento/i.test(combined)) return { sourceClass: "C", credibilityScore: 6.5 };
  return { sourceClass: "D", credibilityScore: 5.0 };
}

export async function buildResearchStrategy(input: { topic: string; objective: string; projectTitle: string; chapterTitle?: string | null; chapterContent?: string | null }) {
  const r = await generateJson({
    system: "You are RESEARCH_STRATEGIST. Design rigorous nonfiction research. Never invent sources, dates, studies, statistics, institutions or citations. Return JSON only.",
    prompt: JSON.stringify({ ...input, chapterContent: clean(input.chapterContent).slice(0,12000), output_schema: { thesis:"string", scope:"string", exclusions:["string"], questions:[{id:"Q1",question:"string",importance:"CRITICAL|HIGH|MEDIUM",evidenceNeeded:["string"]}] } }),
  });
  const questions: ResearchQuestion[] = Array.isArray(r.data?.questions) ? r.data.questions.map((q: AnyRow,i:number)=>({
    id: clean(q.id)||`Q${i+1}`, question: clean(q.question), importance: ["CRITICAL","HIGH","MEDIUM"].includes(clean(q.importance)) ? q.importance : "HIGH", evidenceNeeded: Array.isArray(q.evidenceNeeded)?q.evidenceNeeded.map(clean).filter(Boolean):[],
  })).filter((q:ResearchQuestion)=>q.question) : [];
  return { strategy: { thesis:clean(r.data?.thesis), scope:clean(r.data?.scope), exclusions:Array.isArray(r.data?.exclusions)?r.data.exclusions.map(clean).filter(Boolean):[], questions }, usage:r.usage, model:r.model };
}

export async function buildQueries(input:{topic:string;questions:ResearchQuestion[]}) {
  const r = await generateJson({
    system:"You are QUERY_ARCHITECT. Create precise web research queries. Prefer official/primary sources, statistics, papers, universities and recognized institutions. Do not invent URLs. Return JSON only.",
    prompt:JSON.stringify({ ...input, output_schema:{queries:[{id:"SQ1",query:"string",purpose:"string",questionIds:["Q1"]}]} }),
  });
  const queries:ResearchQuery[] = Array.isArray(r.data?.queries)?r.data.queries.map((q:AnyRow,i:number)=>({id:clean(q.id)||`SQ${i+1}`,query:clean(q.query),purpose:clean(q.purpose),questionIds:Array.isArray(q.questionIds)?q.questionIds.map(clean).filter(Boolean):[]})).filter((q:ResearchQuery)=>q.query).slice(0,18):[];
  return { queries, usage:r.usage, model:r.model };
}

export async function discoverGroundedSources(input: {
  query: ResearchQuery;
}) {
  const response = await ai().models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Research this query carefully using Google Search: ${input.query.query}
Research purpose: ${input.query.purpose || "General research"}
Target question IDs: ${(input.query.questionIds || []).join(", ") || "none"}

This may be a targeted gap-closure search.
If the purpose describes a missing fact or evidence gap, prioritize sources
that DIRECTLY resolve that exact gap instead of merely discussing the broad topic.

For numerical, financial or historical gaps, prioritize:
- current official statistics,
- official historical series,
- budget execution reports,
- audited financial statements,
- regulatory publications,
- primary contracts or legislation,
- institutional annual reports,
- exact figures with dates and measurement periods.

Prefer official and primary sources, statistics, government publications,
universities, international organizations and recognized institutions.

Distinguish current figures from historical figures.
Do not substitute an old statistic when the request asks for current data.
Do not fabricate URLs, statistics, dates or citations.
Summarize only evidence explicitly supported by Google Search grounding.`,
          },
        ],
      },
    ],
    config: {
      temperature: 0.1,
      tools: [{ googleSearch: {} }],
    } as any,
  });

  const candidate =
    (response as AnyRow)?.candidates?.[0] || {};

  const metadata =
    candidate?.groundingMetadata ||
    candidate?.grounding_metadata ||
    {};

  const chunks =
    metadata?.groundingChunks ||
    metadata?.grounding_chunks ||
    [];

  const supports =
    metadata?.groundingSupports ||
    metadata?.grounding_supports ||
    [];

  /*
   * Cada groundingSupport enlaza un segmento concreto de la
   * respuesta con uno o varios groundingChunks.
   *
   * Esto permite conservar evidencia vinculada a la fuente
   * aunque la página posteriormente bloquee HTTP directo.
   */
  const supportByChunk =
    new Map<number, string[]>();

  for (const support of supports) {

    const segmentText = clean(
      support?.segment?.text ||
      support?.segment?.content
    );

    const indices =
      support?.groundingChunkIndices ||
      support?.grounding_chunk_indices ||
      [];

    if (
      !segmentText ||
      !Array.isArray(indices)
    ) {
      continue;
    }

    for (const rawIndex of indices) {

      const chunkIndex = Number(rawIndex);

      if (
        !Number.isInteger(chunkIndex) ||
        chunkIndex < 0
      ) {
        continue;
      }

      const current =
        supportByChunk.get(chunkIndex) || [];

      current.push(segmentText);

      supportByChunk.set(
        chunkIndex,
        current
      );
    }
  }

  const sources: ResearchSource[] = [];

  for (
    let chunkIndex = 0;
    chunkIndex < chunks.length;
    chunkIndex += 1
  ) {

    const chunk = chunks[chunkIndex];

    const web =
      chunk?.web ||
      chunk?.groundingChunk?.web;

    const url = clean(
      web?.uri ||
      web?.url
    );

    if (!url) {
      continue;
    }

    try {

      const normalized =
        new URL(url).toString();

      const title =
        clean(web?.title) ||
        new URL(normalized).hostname;

      const rating =
        classifySource(
          normalized,
          title
        );

      const supportSegments =
        Array.from(
          new Set(
            (supportByChunk.get(chunkIndex) || [])
              .map(clean)
              .filter(Boolean)
          )
        );

      const groundingExcerpt =
        supportSegments.length
          ? supportSegments
              .join("\n")
              .slice(0, 6000)
          : null;

      sources.push({
        id: makeId("src", normalized),
        url: normalized,
        title,
        publisher: null,
        author: null,
        publishedAt: null,
        retrievedAt:
          new Date().toISOString(),

        sourceClass:
          rating.sourceClass,

        credibilityScore:
          rating.credibilityScore,

        queryIds: [
          input.query.id
        ],

        grounded: true,

        groundingExcerpt,

        groundingSupportCount:
          supportSegments.length,

        extractionStatus:
          "PENDING",
      });

    } catch {
      // URL grounding inválida: ignorar.
    }
  }

  return {
    sources,
    groundingSupports:
      supports.length,

    groundedSources:
      sources.filter(
        source =>
          Boolean(
            clean(source.groundingExcerpt)
          )
      ).length,

    usage:
      usageOf(response as AnyRow),

    model: MODEL,
  };
}

export function sourceFromManualUrl(url:string):ResearchSource {
  const normalized=new URL(url).toString(); const rating=classifySource(normalized);
  return {id:makeId("src",normalized),url:normalized,title:new URL(normalized).hostname,publisher:null,author:null,publishedAt:null,retrievedAt:new Date().toISOString(),sourceClass:rating.sourceClass,credibilityScore:rating.credibilityScore,queryIds:[],grounded:false,extractionStatus:"PENDING"};
}

export function mergeSources(
  current: ResearchSource[],
  incoming: ResearchSource[],
) {
  const map =
    new Map<string, ResearchSource>();

  for (
    const source of [
      ...current,
      ...incoming
    ]
  ) {

    const existing =
      map.get(source.url);

    if (!existing) {

      map.set(
        source.url,
        {
          ...source,
        }
      );

      continue;
    }

    existing.queryIds =
      Array.from(
        new Set([
          ...existing.queryIds,
          ...source.queryIds,
        ])
      );

    if (
      source.credibilityScore >
      existing.credibilityScore
    ) {
      existing.credibilityScore =
        source.credibilityScore;

      existing.sourceClass =
        source.sourceClass;
    }

    const groundingParts =
      Array.from(
        new Set([
          ...clean(
            existing.groundingExcerpt
          )
            .split(/\n+/)
            .map(clean)
            .filter(Boolean),

          ...clean(
            source.groundingExcerpt
          )
            .split(/\n+/)
            .map(clean)
            .filter(Boolean),
        ])
      );

    existing.groundingExcerpt =
      groundingParts.length
        ? groundingParts
            .join("\n")
            .slice(0, 6000)
        : null;

    existing.groundingSupportCount =
      groundingParts.length;
  }

  return [...map.values()];
}

export function rankSources(sources:ResearchSource[],maxSources:number){
  const w:Record<SourceClass,number>={A:4,B:3,C:2,D:1};
  return [...sources].sort((a,b)=>w[b.sourceClass]-w[a.sourceClass]||b.credibilityScore-a.credibilityScore||b.queryIds.length-a.queryIds.length).slice(0,Math.max(3,Math.min(30,maxSources)));
}

export async function extractSource(source:ResearchSource){
  const fetched=await fetchPublicText(source.url);
  return {...source,url:fetched.finalUrl,retrievedAt:new Date().toISOString(),excerpt:fetched.text,extractionStatus:"EXTRACTED" as const,extractionError:null};
}

export async function analyzeEvidence(input: {
  source: ResearchSource;
  questions: ResearchQuestion[];
}) {
  const directText =
    clean(input.source.excerpt);

  const groundingText =
    clean(
      input.source.groundingExcerpt
    );

  const sourceText =
    directText ||
    groundingText;

  const evidenceOrigin =
    directText
      ? "DIRECT_EXTRACT"
      : groundingText
        ? "GOOGLE_SEARCH_GROUNDING_SUPPORT"
        : "NONE";

  if (!sourceText) {
    return {
      evidence:
        [] as ResearchEvidence[],

      usage: {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },

      model: MODEL,
    };
  }

  const result =
    await generateJson({

      system: `
You are EVIDENCE_ANALYST for Genelibros.

Extract ONLY evidence explicitly supported by the supplied source material.

The material can originate from:
1. DIRECT_EXTRACT: text retrieved directly from the public source.
2. GOOGLE_SEARCH_GROUNDING_SUPPORT: a segment explicitly linked by
   Google Search grounding metadata to this source.

Both are usable evidence, but they are NOT permission to invent missing
context.

Never infer missing numbers, dates, quotes, causal relationships,
institutions or conclusions.

Never convert an interpretation into a factual claim.

If the supplied evidence is incomplete or ambiguous:
- lower confidence,
- state the limitation,
- do not fill the gap from memory.

Do not reproduce long copyrighted passages.
Paraphrase compactly.

Return JSON only.
`,

      prompt: JSON.stringify({
        source: {
          id:
            input.source.id,

          url:
            input.source.url,

          title:
            input.source.title,

          class:
            input.source.sourceClass,

          credibility:
            input.source.credibilityScore,

          origin:
            evidenceOrigin,

          grounding_support_count:
            input.source
              .groundingSupportCount || 0,

          text:
            sourceText,
        },

        questions:
          input.questions,

        output_schema: {
          evidence: [
            {
              questionIds: ["Q1"],
              evidence: "string",
              relevanceScore: 0,
              confidenceScore: 0,
              supports: ["string"],
              limitations: ["string"],
            },
          ],
        },
      }),

      maxOutputTokens: 9000,
    });

  const evidence: ResearchEvidence[] =
    Array.isArray(
      result.data?.evidence
    )
      ? result.data.evidence
          .map(
            (
              e: AnyRow,
              index: number
            ) => ({
              id: makeId(
                "ev",
                `${input.source.id}:${index}:${clean(
                  e.evidence
                )}`
              ),

              sourceId:
                input.source.id,

              questionIds:
                Array.isArray(
                  e.questionIds
                )
                  ? e.questionIds
                      .map(clean)
                      .filter(Boolean)
                  : [],

              evidence:
                clean(e.evidence),

              relevanceScore:
                Math.max(
                  0,
                  Math.min(
                    10,
                    Number(
                      e.relevanceScore || 0
                    )
                  )
                ),

              confidenceScore:
                Math.max(
                  0,
                  Math.min(
                    10,
                    Number(
                      e.confidenceScore || 0
                    )
                  )
                ),

              supports:
                Array.isArray(
                  e.supports
                )
                  ? e.supports
                      .map(clean)
                      .filter(Boolean)
                  : [],

              limitations:
                Array.from(
                  new Set([
                    ...(Array.isArray(
                      e.limitations
                    )
                      ? e.limitations
                          .map(clean)
                          .filter(Boolean)
                      : []),

                    ...(
                      evidenceOrigin ===
                      "GOOGLE_SEARCH_GROUNDING_SUPPORT"
                        ? [
                            "Evidence derived from Google Search grounding support because direct extraction was unavailable.",
                          ]
                        : []
                    ),
                  ])
                ),
            })
          )
          .filter(
            (e: ResearchEvidence) =>
              Boolean(e.evidence)
          )
      : [];

  return {
    evidence,
    usage:
      result.usage,

    model:
      result.model,
  };
}

export async function buildClaims(input:{topic:string;evidence:ResearchEvidence[];sources:ResearchSource[]}){
  const r=await generateJson({system:"You are CLAIM_BUILDER. Build factual claims ONLY from supplied evidence. Every claim must list exact evidence IDs and source IDs. No unsupported synthesis. Return JSON only.",prompt:JSON.stringify({topic:input.topic,evidence:input.evidence,sources:input.sources.map(s=>({id:s.id,url:s.url,sourceClass:s.sourceClass,credibilityScore:s.credibilityScore})),output_schema:{claims:[{claim:"string",status:"VERIFIED|PARTIALLY_VERIFIED|CONFLICTED|UNVERIFIED",confidenceScore:0,evidenceIds:["ev_x"],sourceIds:["src_x"],citationReady:true}]}}),maxOutputTokens:12000});
  const validE=new Set(input.evidence.map(e=>e.id));const validS=new Set(input.sources.map(s=>s.id));
  const claims:ResearchClaim[]=Array.isArray(r.data?.claims)?r.data.claims.map((c:AnyRow,i:number)=>{const evidenceIds=Array.isArray(c.evidenceIds)?c.evidenceIds.map(clean).filter((x:string)=>validE.has(x)):[];const sourceIds=Array.isArray(c.sourceIds)?c.sourceIds.map(clean).filter((x:string)=>validS.has(x)):[];const status=["VERIFIED","PARTIALLY_VERIFIED","CONFLICTED","UNVERIFIED"].includes(clean(c.status))?c.status:"UNVERIFIED";return {id:makeId("claim",`${i}:${clean(c.claim)}`),claim:clean(c.claim),status,confidenceScore:Math.max(0,Math.min(10,Number(c.confidenceScore||0))),evidenceIds,sourceIds,contradictionIds:[],citationReady:Boolean(c.citationReady)&&evidenceIds.length>0&&sourceIds.length>0} as ResearchClaim;}).filter((c:ResearchClaim)=>c.claim):[];
  return {claims,usage:r.usage,model:r.model};
}

export async function detectContradictions(input:{claims:ResearchClaim[];evidence:ResearchEvidence[];sources:ResearchSource[]}){
  const r=await generateJson({system:"You are CONTRADICTION_ENGINE. Find material conflicts between supplied evidence and claims. Do not invent disagreements. Use only supplied IDs. Return JSON only.",prompt:JSON.stringify({...input,sources:input.sources.map(s=>({id:s.id,url:s.url,sourceClass:s.sourceClass})),output_schema:{contradictions:[{topic:"string",description:"string",sourceIds:["src_x"],resolution:"string|null",severity:"HIGH|MEDIUM|LOW"}]}})});
  const valid=new Set(input.sources.map(s=>s.id));
  const contradictions:ResearchContradiction[]=Array.isArray(r.data?.contradictions)?r.data.contradictions.map((c:AnyRow,i:number)=>({id:makeId("con",`${i}:${clean(c.topic)}:${clean(c.description)}`),topic:clean(c.topic),description:clean(c.description),sourceIds:Array.isArray(c.sourceIds)?c.sourceIds.map(clean).filter((x:string)=>valid.has(x)):[],resolution:clean(c.resolution)||null,severity:["HIGH","MEDIUM","LOW"].includes(clean(c.severity))?c.severity:"MEDIUM"})).filter((c:ResearchContradiction)=>c.description):[];
  return {contradictions,usage:r.usage,model:r.model};
}

export async function verifyClaims(input:{claims:ResearchClaim[];contradictions:ResearchContradiction[];evidence:ResearchEvidence[];sources:ResearchSource[]}){
  const r=await generateJson({system:"You are FACT_VERIFIER. Verify each supplied claim against supplied evidence only. Prefer independent Class A/B corroboration. Never upgrade unsupported claims. Return JSON only.",prompt:JSON.stringify({...input,sources:input.sources.map(s=>({id:s.id,class:s.sourceClass,credibility:s.credibilityScore})),output_schema:{claims:[{id:"claim_x",status:"VERIFIED|PARTIALLY_VERIFIED|CONFLICTED|UNVERIFIED",confidenceScore:0,contradictionIds:["con_x"],citationReady:true}]}})});
  const updates=new Map<string,AnyRow>((Array.isArray(r.data?.claims)?r.data.claims:[]).map((x:AnyRow)=>[clean(x.id),x]));const validC=new Set(input.contradictions.map(c=>c.id));
  const claims=input.claims.map(c=>{const u=updates.get(c.id);if(!u)return c;const status=["VERIFIED","PARTIALLY_VERIFIED","CONFLICTED","UNVERIFIED"].includes(clean(u.status))?u.status:c.status;return {...c,status,confidenceScore:Math.max(0,Math.min(10,Number(u.confidenceScore??c.confidenceScore))),contradictionIds:Array.isArray(u.contradictionIds)?u.contradictionIds.map(clean).filter((x:string)=>validC.has(x)):c.contradictionIds,citationReady:Boolean(u.citationReady)&&c.evidenceIds.length>0&&c.sourceIds.length>0&&status!=="UNVERIFIED"} as ResearchClaim;});
  return {claims,usage:r.usage,model:r.model};
}


export async function auditCitations(
  input:{
    claims:ResearchClaim[];
    sources:ResearchSource[]
  }
){
  const map =
    new Map(
      input.sources.map(
        source => [
          source.id,
          source
        ]
      )
    );

  return input.claims.map(
    claim => {

      const sources =
        (
          claim.sourceIds
            .map(id => map.get(id))
            .filter(Boolean)
        ) as ResearchSource[];

      const strong =
        sources.filter(
          source =>
            ["A","B"].includes(
              source.sourceClass
            ) &&
            source.credibilityScore >= 7.5
        );

      const authorities =
        new Set(
          strong.map(
            source =>
              researchSourceAuthorityKey(
                source
              )
          )
        );

      const primaryA =
        sources.some(
          source =>
            source.sourceClass === "A" &&
            source.credibilityScore >= 8
        );

      const sourceIntegrity =
        primaryA ||
        authorities.size >= 2;

      return {
        ...claim,

        citationReady:
          Boolean(claim.citationReady) &&
          sources.length > 0 &&
          claim.evidenceIds.length > 0 &&
          sourceIntegrity &&
          claim.status !== "UNVERIFIED"
      };
    }
  );
}



export async function detectResearchGaps(
  input:{
    topic:string;
    questions:ResearchQuestion[];
    claims:ResearchClaim[];
    evidence:ResearchEvidence[];
    sources:ResearchSource[]
  }
){
  const r =
    await generateJson({
      system:
        "You are RESEARCH_GAP_DETECTOR. " +
        "Re-evaluate the FULL CURRENT evidence set after every research pass. " +
        "Identify only material gaps that remain insufficiently supported. " +
        "Missing primary source, stale statistic, single-source dependency or unresolved contradiction is a gap. " +
        "Do not repeat a gap already resolved by newer explicit evidence. " +
        "A CRITICAL gap must represent an essential factual requirement still missing for safe writing. " +
        "Never downgrade or close a gap without explicit supplied evidence. " +
        "Never fill missing facts from memory. Do not invent facts. Return JSON only.",

      prompt:
        JSON.stringify({
          ...input,

          sources:
            input.sources.map(
              source => ({
                id: source.id,
                url: source.url,
                class:
                  source.sourceClass,
                credibility:
                  source.credibilityScore
              })
            ),

          output_schema: {
            gaps: [
              {
                gap: "string",
                severity:
                  "CRITICAL|HIGH|MEDIUM|LOW",
                recommendedQueries: [
                  "string"
                ]
              }
            ]
          }
        })
    });

  const severityRank: Record<string, number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1
  };

  const byFingerprint =
    new Map<string, any>();

  for (
    const raw of
    Array.isArray(r.data?.gaps)
      ? r.data.gaps
      : []
  ) {
    const gapText =
      clean(raw?.gap);

    if (!gapText) continue;

    const rawSeverity =
      clean(raw?.severity);

    const severity =
      [
        "CRITICAL",
        "HIGH",
        "MEDIUM",
        "LOW"
      ].includes(rawSeverity)
        ? rawSeverity
        : "MEDIUM";

    const fingerprint =
      stableGapFingerprint(
        gapText
      );

    const item: any = {
      id:
        makeId(
          "gap",
          fingerprint
        ),

      fingerprint,

      gap:
        gapText,

      severity,

      recommendedQueries:
        Array.isArray(
          raw?.recommendedQueries
        )
          ? raw.recommendedQueries
              .map(clean)
              .filter(Boolean)
          : []
    };

    const existing =
      byFingerprint.get(
        fingerprint
      );

    if (
      !existing ||
      severityRank[item.severity] >
      severityRank[existing.severity]
    ) {
      byFingerprint.set(
        fingerprint,
        item
      );
    }
  }

  return {
    gaps:
      Array.from(
        byFingerprint.values()
      ) as ResearchGap[],

    usage:
      r.usage,

    model:
      r.model
  };
}


/**
 * 11D.5 — CRITICAL EVIDENCE RESOLVER
 */
export async function resolveBlockingResearchGaps(
  input:{
    topic:string;
    gaps:ResearchGap[];
    evidence:ResearchEvidence[];
    sources:ResearchSource[];
    claims:ResearchClaim[];
    contradictions:ResearchContradiction[];
  }
){
  const blockers =
    (input.gaps || [])
      .filter(
        gap =>
          ["CRITICAL","HIGH"]
            .includes(
              gap.severity
            )
      );

  if (!blockers.length) {
    return {
      resolutions: [],
      calculations: [],
      usage: {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      } as ResearchUsage,
      model: MODEL
    };
  }

  const r =
    await generateJson({
      system:
        "You are CRITICAL_EVIDENCE_RESOLVER. " +
        "Resolve only supplied CRITICAL/HIGH blockers. " +
        "Use ONLY supplied sources and evidence. " +
        "Do not fill facts from memory. " +
        "RESOLVED requires explicit evidence satisfying the full requirement. " +
        "A required official or primary source cannot be replaced by secondary commentary. " +
        "For apparent contradictions normalize amount, currency, unit, as-of date, period, entity scope, obligation type and status. " +
        "Different periods, scopes or definitions are not automatically contradictions. " +
        "If insufficient, return OPEN or PARTIAL and at most two targeted search queries. " +
        "Do not invent URLs. Return JSON only.",

      prompt:
        JSON.stringify({
          topic:
            input.topic,

          gaps:
            blockers.map(
              (gap: any) => ({
                id:
                  gap.id,

                fingerprint:
                  gap.fingerprint ||
                  stableGapFingerprint(
                    gap.gap
                  ),

                severity:
                  gap.severity,

                gap:
                  gap.gap,

                recommendedQueries:
                  gap.recommendedQueries
              })
            ),

          evidence:
            input.evidence.map(
              evidence => ({
                id:
                  evidence.id,

                sourceId:
                  evidence.sourceId,

                confidence:
                  evidence.confidenceScore,

                evidence:
                  String(
                    evidence.evidence || ""
                  ).slice(0, 2000)
              })
            ),

          sources:
            input.sources.map(
              source => ({
                id:
                  source.id,

                title:
                  source.title,

                url:
                  source.url,

                sourceClass:
                  source.sourceClass,

                credibility:
                  source.credibilityScore
              })
            ),

          claims:
            input.claims,

          contradictions:
            input.contradictions,

          output_schema: {
            resolutions: [
              {
                gapId: "gap_x",

                status:
                  "OPEN|PARTIAL|RESOLVED",

                requirementType:
                  "PRIMARY_SOURCE|CORROBORATION|CONTRADICTION|NUMERIC_METRIC|CONTRACTUAL|OTHER",

                rationale:
                  "string",

                evidenceIds: [
                  "ev_x"
                ],

                sourceIds: [
                  "src_x"
                ],

                contradictionStatus:
                  "NOT_APPLICABLE|CONTRADICTION_CONFIRMED|APPARENT_CONTRADICTION_RESOLVED_BY_SCOPE|NOT_COMPARABLE",

                targetedQueries: [
                  "string"
                ]
              }
            ],

            calculations: [
              {
                operation:
                  "RATIO_PERCENT|SUM|DIFFERENCE",

                left: {
                  value: 0,
                  evidenceId: "ev_x"
                },

                right: {
                  value: 0,
                  evidenceId: "ev_y"
                },

                expectedUnit:
                  "string",

                note:
                  "string"
              }
            ]
          }
        }),

      maxOutputTokens:
        12000
    });

  const gapMap =
    new Map(
      blockers.map(
        gap => [
          gap.id,
          gap
        ]
      )
    );

  const evidenceMap =
    new Map(
      input.evidence.map(
        item => [
          item.id,
          item
        ]
      )
    );

  const sourceMap =
    new Map(
      input.sources.map(
        item => [
          item.id,
          item
        ]
      )
    );

  const resolutions: any[] = [];

  for (
    const raw of
    Array.isArray(r.data?.resolutions)
      ? r.data.resolutions
      : []
  ) {
    const gapId =
      clean(raw?.gapId);

    const gap: any =
      gapMap.get(gapId);

    if (!gap) continue;

    const evidenceIds =
      Array.isArray(
        raw?.evidenceIds
      )
        ? raw.evidenceIds
            .map(clean)
            .filter(
              (id: string) =>
                evidenceMap.has(id)
            )
        : [];

    const sourceIds =
      Array.from(
        new Set<string>(
          Array.isArray(
            raw?.sourceIds
          )
            ? raw.sourceIds
                .map(clean)
                .filter(
                  (id: string) =>
                    sourceMap.has(id)
                )
            : []
        )
      );

    const sources =
      (
        sourceIds
          .map(
            id =>
              sourceMap.get(id)
          )
          .filter(Boolean)
      ) as ResearchSource[];

    const authorities =
      new Set(
        sources
          .filter(
            source =>
              ["A","B"].includes(
                source.sourceClass
              ) &&
              source.credibilityScore >= 7.5
          )
          .map(
            source =>
              researchSourceAuthorityKey(
                source
              )
          )
      );

    const primaryA =
      sources.some(
        source =>
          source.sourceClass === "A" &&
          source.credibilityScore >= 8
      );

    const gapText =
      clean(gap.gap)
        .toLowerCase();

    const requiresPrimary =
      /official|primary|audit|audited|estado financiero|ministerio|superintendencia|digepres|agreement|contract|contrato/.test(
        gapText
      );

    const requiresIndependent =
      /corrobor|contradict|conflict|single-source|independent|dependenc/.test(
        gapText
      );

    const rawStatus =
      clean(raw?.status);

    let status =
      [
        "OPEN",
        "PARTIAL",
        "RESOLVED"
      ].includes(rawStatus)
        ? rawStatus
        : "OPEN";

    if (status === "RESOLVED") {
      const baseEvidence =
        evidenceIds.length > 0 &&
        sourceIds.length > 0;

      const primarySatisfied =
        !requiresPrimary ||
        primaryA;

      const independentSatisfied =
        !requiresIndependent ||
        authorities.size >= 2;

      const strongSatisfied =
        primaryA ||
        authorities.size >= 1;

      if (
        !baseEvidence ||
        !primarySatisfied ||
        !independentSatisfied ||
        !strongSatisfied
      ) {
        status =
          baseEvidence
            ? "PARTIAL"
            : "OPEN";
      }
    }

    resolutions.push({
      gapId,

      fingerprint:
        gap.fingerprint ||
        stableGapFingerprint(
          gap.gap
        ),

      severity:
        gap.severity,

      status,

      requirementType:
        clean(
          raw?.requirementType
        ) || "OTHER",

      rationale:
        clean(raw?.rationale),

      evidenceIds,

      sourceIds,

      independentStrongAuthorities:
        authorities.size,

      primarySourceSatisfied:
        primaryA,

      contradictionStatus:
        clean(
          raw?.contradictionStatus
        ) ||
        "NOT_APPLICABLE",

      targetedQueries:
        status === "RESOLVED"
          ? []
          : Array.from(
              new Set<string>(
                Array.isArray(
                  raw?.targetedQueries
                )
                  ? raw.targetedQueries
                      .map(clean)
                      .filter(Boolean)
                  : []
              )
            ).slice(0, 2)
    });
  }

  for (
    const blocker
    of blockers
  ) {
    if (
      resolutions.some(
        item =>
          item.gapId === blocker.id
      )
    ) {
      continue;
    }

    resolutions.push({
      gapId:
        blocker.id,

      fingerprint:
        stableGapFingerprint(
          blocker.gap
        ),

      severity:
        blocker.severity,

      status:
        "OPEN",

      requirementType:
        "OTHER",

      rationale:
        "Resolver returned no validated disposition.",

      evidenceIds:
        [],

      sourceIds:
        [],

      independentStrongAuthorities:
        0,

      primarySourceSatisfied:
        false,

      contradictionStatus:
        "NOT_APPLICABLE",

      targetedQueries:
        Array.isArray(
          blocker.recommendedQueries
        )
          ? blocker.recommendedQueries
              .map(clean)
              .filter(Boolean)
              .slice(0, 2)
          : []
    });
  }

  return {
    resolutions,

    calculations:
      calculateResolverDerivations(
        r.data?.calculations,
        input.evidence
      ),

    usage:
      r.usage,

    model:
      r.model
  };
}


export async function buildDossier(input:{title:string;questions:ResearchQuestion[];sources:ResearchSource[];evidence:ResearchEvidence[];claims:ResearchClaim[];contradictions:ResearchContradiction[];gaps:ResearchGap[]}){
  const verified=input.claims.filter(c=>c.status==="VERIFIED"&&c.citationReady);const critical=input.gaps.filter(g=>["CRITICAL","HIGH"].includes(g.severity));const classAB=input.sources.filter(s=>["A","B"].includes(s.sourceClass));
  const coverage=input.questions.length?Math.min(10,(new Set(input.evidence.flatMap(e=>e.questionIds)).size/input.questions.length)*10):0;
  const evidence=input.evidence.length?input.evidence.reduce((s,e)=>s+e.confidenceScore,0)/input.evidence.length:0;
  const factual=input.claims.length?input.claims.reduce((s,c)=>s+c.confidenceScore,0)/input.claims.length:0;
  const r=await generateJson({system:"You are CITATION_AUDITOR and research dossier editor. Use ONLY verified/partially verified claims. Explicitly prohibit unsupported claims. Do not invent references. Return JSON only.",prompt:JSON.stringify({...input,verifiedClaims:verified,sources:input.sources.map(s=>({id:s.id,title:s.title,url:s.url,class:s.sourceClass,credibility:s.credibilityScore})),metrics:{coverage,evidence,factual},output_schema:{executiveSummary:"string",writingInstructions:["string"],prohibitedClaims:["string"],citationPlan:[{claimId:"claim_x",sourceIds:["src_x"],note:"string"}]}})});
  const claimIds=new Set(input.claims.map(c=>c.id));const sourceIds=new Set(input.sources.map(s=>s.id));
  const dossier:ResearchDossier={title:input.title,executiveSummary:clean(r.data?.executiveSummary),questions:input.questions,sources:input.sources.map(s=>({...s,excerpt:s.excerpt?s.excerpt.slice(0,1200):s.excerpt})),evidence:input.evidence,claims:input.claims,contradictions:input.contradictions,gaps:input.gaps,writingInstructions:Array.isArray(r.data?.writingInstructions)?r.data.writingInstructions.map(clean).filter(Boolean):[],prohibitedClaims:Array.isArray(r.data?.prohibitedClaims)?r.data.prohibitedClaims.map(clean).filter(Boolean):[],citationPlan:Array.isArray(r.data?.citationPlan)?r.data.citationPlan.map((p:AnyRow)=>({claimId:clean(p.claimId),sourceIds:Array.isArray(p.sourceIds)?p.sourceIds.map(clean).filter((x:string)=>sourceIds.has(x)):[],note:clean(p.note)})).filter((p:AnyRow)=>claimIds.has(p.claimId)&&p.sourceIds.length):[],coverageScore:Number(coverage.toFixed(2)),evidenceScore:Number(evidence.toFixed(2)),factualConfidenceScore:Number(factual.toFixed(2)),readyForWriting:verified.length>=3&&classAB.length>=2&&critical.length===0&&coverage>=7.5&&factual>=7.5};
  return {dossier,usage:r.usage,model:r.model};
}
