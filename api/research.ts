import { requireUserOrWorker } from "../src/server/request-auth.js";
import { safeFetchText } from "../src/server/safe-fetch.js";
import { applyRetryAfter, enforceQuota } from "../src/server/rate-limit.js";

type ResearchSource = {
  title: string;
  url: string;
  source_type: string;
  extracted_text: string;
  reliability_score: number;
};

type ResearchFact = {
  claim: string;
  status: "VERIFIED" | "PARTIALLY_VERIFIED" | "DISPUTED" | "UNVERIFIED" | "REJECTED";
  confidence: number;
  source_titles: string[];
  notes: string;
};

const COLLECT_SOURCES = "COLLECT_SOURCES";
const EXTRACT_FACTS = "EXTRACT_FACTS";
const VERIFY_FACTS = "VERIFY_FACTS";

function stripHtml(html: string): string {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function estimateReliability(url: string): number {
  const value = String(url || "").toLowerCase();

  if (/\.gov|gob\.do|who\.int|worldbank\.org|imf\.org|un\.org|oecd\.org/.test(value)) return 9;
  if (/\.edu|universidad|research|journal|scielo|jstor|doi\.org/.test(value)) return 8.5;
  if (/bbc|reuters|apnews|nytimes|elpais|listindiario|diariolibre/.test(value)) return 7.5;
  if (/wikipedia/.test(value)) return 6.5;
  if (/facebook|instagram|tiktok|youtube|x\.com|twitter/.test(value)) return 4;

  return 6;
}

async function extractHtml(url: string): Promise<ResearchSource> {
  const response = await safeFetchText(url, {
    headers: {
      "user-agent": "BestSellerAI-ResearchBot/1.0",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error("No se pudo leer la fuente: " + response.status);
  }

  const html = response.text;

  const title =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      ?.trim() || url;

  return {
    title,
    url,
    source_type: "web_page",
    extracted_text: stripHtml(html).slice(0, 25000),
    reliability_score: estimateReliability(url),
  };
}

async function searchExternalProvider(query: string, maxResults: number): Promise<Array<{ title: string; url: string }>> {
  const endpoint = process.env.RESEARCH_SEARCH_ENDPOINT;
  const apiKey = process.env.RESEARCH_API_KEY;

  if (!endpoint) return [];

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: "Bearer " + apiKey } : {}),
    },
    body: JSON.stringify({
      query,
      search: query,
      max_results: maxResults,
      limit: maxResults,
    }),
  });

  if (!response.ok) {
    throw new Error("Search provider falló: " + response.status);
  }

  const data = await response.json();

  const raw =
    Array.isArray(data?.results) ? data.results :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.items) ? data.items :
    [];

  return raw
    .map((item: any) => ({
      title: String(item?.title || item?.name || item?.url || "").trim(),
      url: String(item?.url || item?.link || "").trim(),
    }))
    .filter((item: any) => item.url)
    .slice(0, maxResults);
}

function extractFactsFromSources(sources: ResearchSource[]): ResearchFact[] {
  const facts: ResearchFact[] = [];

  for (const source of sources) {
    const sentences = source.extracted_text
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 80 && x.length <= 320)
      .slice(0, 8);

    for (const sentence of sentences) {
      const status =
        source.reliability_score >= 8
          ? "VERIFIED"
          : source.reliability_score >= 6
            ? "PARTIALLY_VERIFIED"
            : "UNVERIFIED";

      facts.push({
        claim: sentence,
        status,
        confidence: Number(Math.min(0.95, source.reliability_score / 10).toFixed(2)),
        source_titles: [source.title],
        notes: "Extraído automáticamente desde fuente web. Requiere revisión editorial si se usará como dato sensible.",
      });
    }
  }

  return facts.slice(0, 80);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const principal = await requireUserOrWorker(req);
    await enforceQuota(principal, "research");
  } catch (error: any) {
    const status = typeof error?.statusCode === "number" ? error.statusCode : 401;
    applyRetryAfter(res, error);
    const message =
      status === 429 ? error.message :
      status === 401 ? "Unauthorized" :
      status === 503 ? error.message :
      "Server auth misconfigured";
    return res.status(status).json({ ok: false, error: message, ...(status === 429 ? { code: "USER_QUOTA_EXCEEDED" } : {}) });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const query = String(body.query || body.topic || "").trim();

    const urls = Array.isArray(body.urls)
      ? body.urls.map(String).filter(Boolean).slice(0, 10)
      : [];

    const maxSources = Math.max(1, Math.min(10, Number(body.maxSources || 5) || 5));

    let searchResults: Array<{ title: string; url: string }> = [];

    if (query && urls.length === 0) {
      searchResults = await searchExternalProvider(query, maxSources);
    }

    const allUrls = [
      ...urls,
      ...searchResults.map((x) => x.url),
    ]
      .filter(Boolean)
      .slice(0, maxSources);

    const sources: ResearchSource[] = [];

    for (const url of allUrls) {
      try {
        sources.push(await extractHtml(url));
      } catch (error: any) {
        sources.push({
          title: String(url),
          url: String(url),
          source_type: "web_page_error",
          extracted_text: "No se pudo extraer esta fuente: " + String(error?.message || error),
          reliability_score: 1,
        });
      }
    }

    const facts = extractFactsFromSources(sources);

    const research_context = [
      "EXPEDIENTE DE INVESTIGACIÓN REAL",
      "",
      "QUERY:",
      query || "(sin query)",
      "",
      "FUENTES:",
      ...sources.map((source, index) =>
        [
          index + 1 + ". " + source.title,
          "URL: " + source.url,
          "Tipo: " + source.source_type,
          "Confiabilidad: " + source.reliability_score + "/10",
          "Extracto: " + source.extracted_text.slice(0, 1200),
        ].join("\n")
      ),
      "",
      "HECHOS EXTRAÍDOS:",
      ...facts.slice(0, 30).map((fact) =>
        "- [" + fact.status + "] " + fact.claim
      ),
    ].join("\n");

    return res.status(200).json({
      ok: true,
      action: {
        collect: COLLECT_SOURCES,
        extract: EXTRACT_FACTS,
        verify: VERIFY_FACTS,
      },
      query,
      sources,
      facts,
      research_context,
      needs_input:
        !process.env.RESEARCH_SEARCH_ENDPOINT && urls.length === 0
          ? {
              type: "RESEARCH_URLS_REQUIRED",
              message:
                "No hay RESEARCH_SEARCH_ENDPOINT configurado. Envía URLs manuales o configura un proveedor de búsqueda.",
            }
          : null,
    });
  } catch (error: any) {
    console.error("[research] failed", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo completar la investigación.",
    });
  }
}
