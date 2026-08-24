import type {
  BrainContextBundle,
  BrainContextInput,
  BrainDepth,
} from "./types";

const APPROX_CHARS_PER_TOKEN = 4;

const DEPTH_TOKEN_BUDGET: Record<BrainDepth, number> = {
  FAST: 24_000,
  DEEP: 90_000,
  SUPREME: 220_000,
  ULTRA: 500_000,
};

function approxTokens(value: string): number {
  return Math.ceil(String(value || "").length / APPROX_CHARS_PER_TOKEN);
}

function trimApproxTokens(value: string, maxTokens: number): string {
  const text = String(value || "");
  const maxChars = Math.max(0, maxTokens * APPROX_CHARS_PER_TOKEN);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[TRUNCATED_BY_GENELIBROS_BRAIN]`;
}

export function buildBrainContext(
  input: BrainContextInput,
  depth: BrainDepth,
): BrainContextBundle {
  const maxTokens = DEPTH_TOKEN_BUDGET[depth];
  const sections: Array<[string, string, number]> = [
    ["REQUEST", JSON.stringify(input.request), 0.08],
    ["SERIES_MEMORY", input.seriesMemory || "", 0.14],
    ["BOOK_MEMORY", input.bookMemory || "", 0.14],
    ["KNOWLEDGE_GRAPH", input.knowledgeGraph || "", 0.12],
    ["RESEARCH", input.researchContext || "", 0.20],
    ["CHAPTER_CONTEXT", input.chapterContext || "", 0.10],
    ["MANUSCRIPT", input.manuscript || "", 0.22],
  ];

  const included: string[] = [];
  const trimmed: string[] = [];
  const rendered: string[] = [];

  for (const [name, raw, ratio] of sections) {
    if (!raw) continue;
    const budget = Math.max(500, Math.floor(maxTokens * ratio));
    const clipped = trimApproxTokens(raw, budget);

    if (clipped.length < raw.length) trimmed.push(name);
    included.push(name);
    rendered.push(`## ${name}\n${clipped}`);
  }

  const text = rendered.join("\n\n");

  return {
    text,
    approxTokens: approxTokens(text),
    sectionsIncluded: included,
    sectionsTrimmed: trimmed,
  };
}
