import { OS4_THRESHOLDS, clampScore } from "./config";
import type {
  Os4AgentName,
  Os4AgentReview,
  Os4QualityDimensions,
  Os4QualityReport,
} from "./types";

function words(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function countParagraphs(text: string): number {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean).length;
}

function countHeadings(text: string): number {
  return (String(text || "").match(/^\s{0,3}#{2,4}\s+/gm) || []).length;
}

function repeatedNgramPenalty(text: string, n = 5): number {
  const ws = words(text);
  if (ws.length < n * 3) return 0;

  const map = new Map<string, number>();
  for (let i = 0; i <= ws.length - n; i++) {
    const key = ws.slice(i, i + n).join(" ");
    map.set(key, (map.get(key) || 0) + 1);
  }

  let repeated = 0;
  for (const value of map.values()) {
    if (value > 1) repeated += value - 1;
  }

  return Math.min(2.5, repeated / Math.max(30, ws.length / 70));
}

function genericPhrasePenalty(text: string): number {
  const patterns = [
    /en el mundo actual/gi,
    /a lo largo de la historia/gi,
    /es importante destacar/gi,
    /cabe destacar/gi,
    /en conclusión/gi,
    /en resumen/gi,
    /sin lugar a dudas/gi,
    /desde tiempos inmemoriales/gi,
    /en este capítulo exploraremos/gi,
  ];

  const hits = patterns.reduce((sum, re) => sum + (String(text || "").match(re) || []).length, 0);
  return Math.min(2.5, hits * 0.2);
}

export function deterministicChapterSignals(text: string) {
  const wc = words(text).length;
  const paragraphCount = countParagraphs(text);
  const headingCount = countHeadings(text);
  const repetitionPenalty = repeatedNgramPenalty(text);
  const genericPenalty = genericPhrasePenalty(text);

  const lengthScore =
    wc >= 2500 ? 10 :
    wc >= 1800 ? 9 :
    wc >= 1200 ? 8 :
    wc >= 800 ? 6.5 :
    4;

  const structureScore =
    paragraphCount >= 12 && headingCount >= 3 ? 10 :
    paragraphCount >= 8 ? 8.5 :
    paragraphCount >= 5 ? 7 :
    5;

  return {
    words: wc,
    paragraph_count: paragraphCount,
    heading_count: headingCount,
    repetition_penalty: Math.round(repetitionPenalty * 100) / 100,
    generic_phrase_penalty: Math.round(genericPenalty * 100) / 100,
    deterministic_score: clampScore(
      lengthScore * 0.45 +
      structureScore * 0.25 +
      (10 - repetitionPenalty) * 0.2 +
      (10 - genericPenalty) * 0.1
    ),
  };
}

export function normalizeAgentReview(
  agent: Os4AgentName,
  raw: any
): Os4AgentReview {
  return {
    agent,
    score: clampScore(raw?.score ?? raw?.global_score ?? raw?.quality_score ?? 0),
    blocking: Boolean(raw?.blocking || raw?.block || raw?.status === "BLOCKED"),
    issues: Array.isArray(raw?.issues) ? raw.issues.map(String).slice(0, 30) : [],
    strengths: Array.isArray(raw?.strengths) ? raw.strengths.map(String).slice(0, 20) : [],
    rewrite_instructions: Array.isArray(raw?.rewrite_instructions)
      ? raw.rewrite_instructions.map(String).slice(0, 30)
      : [],
    facts_to_verify: Array.isArray(raw?.facts_to_verify)
      ? raw.facts_to_verify.map(String).slice(0, 30)
      : [],
  };
}

function dimension(raw: any, key: keyof Os4QualityDimensions, fallback: number): number {
  return clampScore(raw?.dimensions?.[key] ?? raw?.[key] ?? fallback, fallback);
}

export function buildQualityReport(args: {
  chapterNumber: number;
  text: string;
  iteration: number;
  reviews: Os4AgentReview[];
  judge: any;
}): Os4QualityReport {
  const deterministic = deterministicChapterSignals(args.text);

  const averageReview =
    args.reviews.length > 0
      ? args.reviews.reduce((sum, x) => sum + x.score, 0) / args.reviews.length
      : deterministic.deterministic_score;

  const judgeScore = clampScore(args.judge?.global_score ?? args.judge?.score ?? averageReview, averageReview);

  const globalScore = clampScore(
    judgeScore * 0.72 +
    averageReview * 0.2 +
    deterministic.deterministic_score * 0.08
  );

  const blockers = [
    ...args.reviews.filter((x) => x.blocking).flatMap((x) => x.issues),
    ...(Array.isArray(args.judge?.blocking_issues) ? args.judge.blocking_issues.map(String) : []),
  ].filter(Boolean);

  const rewriteInstructions = Array.from(
    new Set([
      ...args.reviews.flatMap((x) => x.rewrite_instructions),
      ...(Array.isArray(args.judge?.rewrite_instructions)
        ? args.judge.rewrite_instructions.map(String)
        : []),
    ])
  ).slice(0, 40);

  const dimensions: Os4QualityDimensions = {
    factuality: dimension(args.judge, "factuality", averageReview),
    depth: dimension(args.judge, "depth", averageReview),
    clarity: dimension(args.judge, "clarity", averageReview),
    narrative: dimension(args.judge, "narrative", averageReview),
    originality: dimension(args.judge, "originality", averageReview),
    coherence: dimension(args.judge, "coherence", averageReview),
    continuity: dimension(args.judge, "continuity", averageReview),
    sourcing: dimension(args.judge, "sourcing", averageReview),
    non_repetition: dimension(
      args.judge,
      "non_repetition",
      10 - deterministic.repetition_penalty
    ),
    author_dna: dimension(args.judge, "author_dna", averageReview),
    commercial_value: dimension(args.judge, "commercial_value", averageReview),
  };

  const blocked = blockers.length > 0;
  const approved =
    !blocked &&
    globalScore >= OS4_THRESHOLDS.chapterApproval &&
    dimensions.factuality >= OS4_THRESHOLDS.factualityMinimum &&
    dimensions.continuity >= OS4_THRESHOLDS.continuityMinimum;

  return {
    chapter_number: args.chapterNumber,
    global_score: globalScore,
    status: blocked ? "BLOCKED" : approved ? "APPROVED" : "REWRITE_REQUIRED",
    dimensions,
    deterministic: {
      words: deterministic.words,
      paragraph_count: deterministic.paragraph_count,
      heading_count: deterministic.heading_count,
      repetition_penalty: deterministic.repetition_penalty,
      generic_phrase_penalty: deterministic.generic_phrase_penalty,
    },
    council: args.reviews,
    blocking_issues: blockers.slice(0, 30),
    rewrite_instructions: rewriteInstructions,
    iteration: args.iteration,
  };
}
