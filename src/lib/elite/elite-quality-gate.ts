export type EliteQualityResult = {
  score: number;
  label: string;
  issues: string[];
  strengths: string[];
  mustRewrite: boolean;
};

function clamp(n: number) {
  return Math.max(1, Math.min(10, Number(n.toFixed(1))));
}

function countWords(text: string): number {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function label(score: number): string {
  if (score >= 9) return "EXCELENTE";
  if (score >= 8) return "MUY BUENO";
  if (score >= 7) return "BUENO";
  if (score >= 6) return "ACEPTABLE";
  if (score >= 5) return "DÉBIL";
  return "CRÍTICO";
}

function hasPromptLeak(text: string): boolean {
  return /act[uú]a como|eres un escritor|prompt|requisitos|project_state|task:|system:|objetivo del cap[ií]tulo/i.test(
    String(text || "")
  );
}

function hasBadTitle(title: string): boolean {
  const t = String(title || "").trim().toLowerCase();

  return (
    !t ||
    t === "libro sin título" ||
    t === "libro sin titulo" ||
    t === "nuevo libro" ||
    t === "panorama general" ||
    t === "conceptos clave" ||
    /^desarrollo editorial\s+\d+/.test(t)
  );
}

export function scoreEliteTitle(title: string, subtitle = ""): EliteQualityResult {
  let score = 10;
  const issues: string[] = [];
  const strengths: string[] = [];

  if (hasBadTitle(title)) {
    score -= 4;
    issues.push("Título genérico, vacío o placeholder.");
  } else {
    strengths.push("Título editorial presente.");
  }

  if (String(title || "").length < 8) {
    score -= 1.5;
    issues.push("Título demasiado corto.");
  }

  if (String(title || "").length > 115) {
    score -= 1;
    issues.push("Título demasiado largo.");
  }

  if (hasPromptLeak(title)) {
    score -= 4;
    issues.push("El título contiene fuga de prompt.");
  }

  if (subtitle && hasPromptLeak(subtitle)) {
    score -= 2;
    issues.push("El subtítulo contiene fuga de prompt.");
  }

  if (subtitle && subtitle.length >= 12) {
    strengths.push("Subtítulo presente.");
  }

  const finalScore = clamp(score);

  return {
    score: finalScore,
    label: label(finalScore),
    issues,
    strengths,
    mustRewrite: finalScore < 7,
  };
}

export function scoreEliteOutline(outline: any[]): EliteQualityResult {
  let score = 10;
  const issues: string[] = [];
  const strengths: string[] = [];

  if (!Array.isArray(outline) || outline.length === 0) {
    return {
      score: 1,
      label: "CRÍTICO",
      issues: ["No existe outline."],
      strengths: [],
      mustRewrite: true,
    };
  }

  strengths.push("Outline presente con " + outline.length + " capítulos.");

  for (const item of outline) {
    const n = Number(item?.chapter_number || 0);
    const title = String(item?.chapter_title || item?.title || "").trim();
    const subheads = Array.isArray(item?.subheads_h2) ? item.subheads_h2 : [];
    const keyPoints = Array.isArray(item?.key_points) ? item.key_points : [];

    if (!n) {
      score -= 0.5;
      issues.push("Hay un capítulo sin número.");
    }

    if (hasBadTitle(title)) {
      score -= 0.8;
      issues.push("Capítulo " + n + " tiene título genérico o inválido.");
    }

    if (hasPromptLeak(title)) {
      score -= 1.2;
      issues.push("Capítulo " + n + " tiene fuga de prompt en el título.");
    }

    if (subheads.length < 5) {
      score -= 0.5;
      issues.push("Capítulo " + n + " tiene menos de 5 subtítulos internos.");
    }

    if (keyPoints.length < 3) {
      score -= 0.3;
      issues.push("Capítulo " + n + " tiene pocos puntos clave.");
    }
  }

  if (outline.every((x) => Array.isArray(x?.subheads_h2) && x.subheads_h2.length >= 5)) {
    strengths.push("Todos los capítulos tienen subtítulos internos suficientes.");
  }

  const finalScore = clamp(score);

  return {
    score: finalScore,
    label: label(finalScore),
    issues: issues.slice(0, 25),
    strengths,
    mustRewrite: finalScore < 7,
  };
}

export function scoreEliteChapterText(args: {
  text: string;
  minWords?: number;
  expectedSubheads?: string[];
  factualMode?: boolean;
}): EliteQualityResult {
  let score = 10;
  const issues: string[] = [];
  const strengths: string[] = [];

  const text = String(args.text || "").trim();
  const words = countWords(text);
  const minWords = Math.max(500, Number(args.minWords || 2000) || 2000);

  if (words < minWords * 0.75) {
    score -= 2.5;
    issues.push("El capítulo está por debajo del 75% de la longitud mínima.");
  } else {
    strengths.push("Longitud aceptable.");
  }

  if (hasPromptLeak(text)) {
    score -= 3;
    issues.push("El capítulo contiene instrucciones internas o fuga de prompt.");
  }

  const h3Count = (text.match(/^###\s+/gm) || []).length;

  if ((args.expectedSubheads || []).length >= 5 && h3Count < 3) {
    score -= 1.5;
    issues.push("El capítulo no usa suficientes subtítulos internos.");
  } else if (h3Count >= 3) {
    strengths.push("Usa subtítulos internos.");
  }

  if (/bibliograf[ií]a|referencias|fuentes consultadas/i.test(text)) {
    score -= 0.8;
    issues.push("Incluye bibliografía dentro del capítulo.");
  }

  if (args.factualMode) {
    const suspicious = [
      /\b\d{1,2}\.\d{1,2}%\b/g,
      /\bseg[uú]n estudios\b/gi,
      /\bexpertos aseguran\b/gi,
      /\bse dice que\b/gi,
      /\bfue demostrado\b/gi,
    ];

    let suspiciousCount = 0;

    for (const re of suspicious) {
      suspiciousCount += (text.match(re) || []).length;
    }

    if (suspiciousCount >= 3) {
      score -= 1.5;
      issues.push("Hay varias afirmaciones con riesgo de falsa precisión o falta de fuente.");
    }
  }

  const repeatedParagraphs = new Map<string, number>();

  for (const paragraph of text.split(/\n{2,}/)) {
    const key = paragraph.replace(/\s+/g, " ").trim().slice(0, 160);

    if (key.length < 80) continue;

    repeatedParagraphs.set(key, (repeatedParagraphs.get(key) || 0) + 1);
  }

  const duplicates = [...repeatedParagraphs.values()].filter((x) => x > 1).length;

  if (duplicates > 0) {
    score -= Math.min(2, duplicates * 0.5);
    issues.push("Hay párrafos repetidos o muy similares.");
  }

  const finalScore = clamp(score);

  return {
    score: finalScore,
    label: label(finalScore),
    issues,
    strengths,
    mustRewrite: finalScore < 7.5,
  };
}

export function scoreEliteProject(project: any): EliteQualityResult {
  const state = project?.state || project || {};
  const titleResult = scoreEliteTitle(
    state.book_title || state.bookTitle || project?.title || "",
    state.book_subtitle || state.bookSubtitle || ""
  );

  const outlineResult = scoreEliteOutline(
    Array.isArray(state.outline_12) ? state.outline_12 : []
  );

  const score = clamp((titleResult.score * 0.35) + (outlineResult.score * 0.65));

  return {
    score,
    label: label(score),
    issues: [...titleResult.issues, ...outlineResult.issues],
    strengths: [...titleResult.strengths, ...outlineResult.strengths],
    mustRewrite: score < 7.5,
  };
}
