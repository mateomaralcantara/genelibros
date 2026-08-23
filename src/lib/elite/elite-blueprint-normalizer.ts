function asText(value: unknown, fallback = ""): string {
  const out = String(value ?? "").replace(/\s+/g, " ").trim();
  return out || fallback;
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function cleanTitle(value: unknown, fallback: string): string {
  let out = asText(value, fallback)
    .replace(/^cap[ií]tulo\s+\d+\s*[:\-–—.]?\s*/i, "")
    .replace(/\b(act[uú]a como|eres un escritor|prompt|requisitos|objetivo general)\b[\s\S]*$/i, "")
    .trim();

  if (!out) out = fallback;

  if (out.length > 120) {
    out = out.slice(0, 117).replace(/\s+\S*$/, "").trim() + "...";
  }

  return out;
}

export function normalizeEliteBlueprint(raw: any, fallback: {
  title: string;
  topic: string;
  chapterCount: number;
  targetWords: number;
}) {
  const state = raw?.project_state_updated || raw?.state || raw || {};
  const dashboard = raw?.dashboard || {};

  const title = cleanTitle(
    state.book_title || dashboard.book_title || fallback.title,
    fallback.title || "Nuevo libro"
  );

  const subtitle = cleanTitle(
    state.book_subtitle || dashboard.book_subtitle || "",
    ""
  );

  const blueprint = state.editorial_blueprint || {};

  const outlineInput = asArray<any>(state.outline_12);
  const count = Math.max(1, Math.min(120, Number(fallback.chapterCount || outlineInput.length || 12) || 12));

  const outline = Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const found = outlineInput.find((x) => Number(x?.chapter_number || 0) === n) || outlineInput[index] || {};

    return {
      id: asText(found.id, "outline_" + String(n).padStart(2, "0")),
      chapter_number: n,
      chapter_title: cleanTitle(found.chapter_title || found.title, "Capítulo " + n),
      chapter_thesis: asText(found.chapter_thesis || found.thesis, ""),
      objective: asText(found.objective, ""),
      key_points: asArray(found.key_points).map(String).filter(Boolean).slice(0, 12),
      subheads_h2: asArray(found.subheads_h2).map(String).filter(Boolean).slice(0, 10),
      required_facts: asArray(found.required_facts).map(String).filter(Boolean).slice(0, 12),
      source_needs: asArray(found.source_needs).map(String).filter(Boolean).slice(0, 12),
      risk_of_hallucination: asText(found.risk_of_hallucination, ""),
      transition_to_next: asText(found.transition_to_next, ""),
      target_words: Math.max(800, Number(found.target_words || fallback.targetWords || 3000) || 3000),
      status: asText(found.status, "PENDING"),
    };
  });

  return {
    ok: true,
    dashboard: {
      ...dashboard,
      book_title: title,
      book_subtitle: subtitle,
      domain: asText(dashboard.domain || state.domain, ""),
    },
    project_state_updated: {
      ...state,
      book_title: title,
      bookTitle: title,
      book_subtitle: subtitle,
      bookSubtitle: subtitle,
      book_topic: asText(state.book_topic || fallback.topic, fallback.topic),
      editorial_blueprint: {
        title_candidates: asArray(blueprint.title_candidates).map(String).filter(Boolean).slice(0, 5),
        subtitle_candidates: asArray(blueprint.subtitle_candidates).map(String).filter(Boolean).slice(0, 5),
        winning_title_reason: asText(blueprint.winning_title_reason, ""),
        central_thesis: asText(blueprint.central_thesis, ""),
        reader_promise: asText(blueprint.reader_promise, ""),
        audience: asText(blueprint.audience, ""),
        tone: asText(blueprint.tone, ""),
        factual_risk_level: asText(blueprint.factual_risk_level, ""),
        research_needs: asArray(blueprint.research_needs).map(String).filter(Boolean).slice(0, 20),
        source_priorities: asArray(blueprint.source_priorities).map(String).filter(Boolean).slice(0, 20),
        forbidden_claims_without_source: asArray(blueprint.forbidden_claims_without_source).map(String).filter(Boolean).slice(0, 20),
      },
      outline_12: outline,
    },
    master_document: {
      title,
      text: "",
    },
    needs_input: null,
  };
}
