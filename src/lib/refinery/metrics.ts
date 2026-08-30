import type {
  ChapterOverlap,
  DeterministicChapterMetrics,
  ManuscriptChapterInput,
} from "./types";

const STOP_WORDS = new Set([
  "para", "como", "pero", "porque", "desde", "hasta", "sobre", "entre",
  "este", "esta", "estos", "estas", "esto", "esa", "ese", "esas", "esos",
  "tambien", "también", "donde", "cuando", "quien", "quién", "cual", "cuál",
  "unos", "unas", "todo", "toda", "todos", "todas", "cada", "muy", "más",
  "mas", "menos", "solo", "sólo", "puede", "pueden", "debe", "deben",
  "del", "las", "los", "una", "uno", "con", "sin", "por", "que", "sus",
  "the", "and", "for", "with", "from", "that", "this", "into", "your",
]);

export function wordCount(value: string): number {
  return String(value || "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
}

function normalizedWords(value: string): string[] {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/u)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4 && !STOP_WORDS.has(x));
}

function paragraphList(value: string): string[] {
  return String(value || "")
    .split(/\n\s*\n/u)
    .map((x) => x.replace(/\s+/gu, " ").trim())
    .filter((x) => wordCount(x) >= 12);
}

export function deterministicChapterMetrics(
  chapter: ManuscriptChapterInput,
): DeterministicChapterMetrics {
  const text = String(chapter.content || "");
  const words = wordCount(text);
  const paragraphs = paragraphList(text);
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/u)
    .map((x) => x.trim())
    .filter(Boolean);

  const normalizedParagraphs = paragraphs.map((p) =>
    p.toLowerCase().replace(/\s+/gu, " ").trim(),
  );
  const counts = new Map<string, number>();
  for (const p of normalizedParagraphs) counts.set(p, (counts.get(p) || 0) + 1);

  let repeatedParagraphs = 0;
  let repeatedParagraphWords = 0;
  for (const [paragraph, count] of counts) {
    if (count <= 1) continue;
    repeatedParagraphs += count - 1;
    repeatedParagraphWords += wordCount(paragraph) * (count - 1);
  }

  const normalized = normalizedWords(text);
  const unique = new Set(normalized);

  return {
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    words,
    characters: text.length,
    paragraphs: paragraphs.length,
    sentences: sentences.length,
    averageSentenceWords:
      sentences.length > 0
        ? Number((words / sentences.length).toFixed(2))
        : words,
    repeatedParagraphs,
    repeatedParagraphWords,
    lexicalDiversity:
      normalized.length > 0
        ? Number((unique.size / normalized.length).toFixed(4))
        : 0,
  };
}

function topTerms(value: string, limit = 120): Set<string> {
  const counts = new Map<string, number>();
  for (const word of normalizedWords(value)) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word]) => word),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

export function lexicalOverlapMatrix(
  chapters: ManuscriptChapterInput[],
): ChapterOverlap[] {
  const terms = new Map<number, Set<string>>();
  for (const chapter of chapters) {
    terms.set(chapter.chapterNumber, topTerms(chapter.content));
  }

  const overlaps: ChapterOverlap[] = [];

  for (let i = 0; i < chapters.length; i += 1) {
    for (let j = i + 1; j < chapters.length; j += 1) {
      const a = chapters[i];
      const b = chapters[j];
      const score = jaccard(
        terms.get(a.chapterNumber) || new Set(),
        terms.get(b.chapterNumber) || new Set(),
      );
      const percent = Number((score * 100).toFixed(1));

      overlaps.push({
        chapterA: a.chapterNumber,
        chapterB: b.chapterNumber,
        lexicalOverlap: percent,
        semanticOverlap: 0,
        severity:
          percent >= 55
            ? "CRITICAL"
            : percent >= 42
              ? "HIGH"
              : percent >= 30
                ? "MEDIUM"
                : "LOW",
        repeatedIdeas: [],
        recommendation:
          percent >= 42
            ? "Revisar solapamiento conceptual antes de publicación."
            : "Sin acción automática.",
      });
    }
  }

  return overlaps.sort((a, b) => b.lexicalOverlap - a.lexicalOverlap);
}

export function manuscriptDeterministicMetrics(
  chapters: ManuscriptChapterInput[],
) {
  const chapterMetrics = chapters.map(deterministicChapterMetrics);
  const counts = chapterMetrics.map((x) => x.words);
  const mean =
    counts.length > 0
      ? counts.reduce((sum, x) => sum + x, 0) / counts.length
      : 0;

  const variance =
    counts.length > 0
      ? counts.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) /
        counts.length
      : 0;

  const stdDev = Math.sqrt(variance);
  const repeatedParagraphWords = chapterMetrics.reduce(
    (sum, x) => sum + x.repeatedParagraphWords,
    0,
  );

  return {
    chapterMetrics,
    lexicalOverlapMatrix: lexicalOverlapMatrix(chapters),
    meanChapterWords: Math.round(mean),
    chapterWordStdDev: Math.round(stdDev),
    imbalanceRatio:
      mean > 0 ? Number((stdDev / mean).toFixed(4)) : 0,
    repeatedParagraphWords,
  };
}
