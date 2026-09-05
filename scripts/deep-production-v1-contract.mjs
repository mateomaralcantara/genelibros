export const DEEP_PRODUCTION_VERSION = "1.0.0";
export const DEEP_WORKFLOW_VERSION = "deep-work-11c-1.0.0";

export const QUALITY_THRESHOLD = 9.3;
export const FIRST_PASS_MAX_LLM_CALLS = 7;
export const FINAL_MAX_LLM_CALLS = 9;
export const DRAFT_COUNT = 2;
export const MAX_REPAIR_ATTEMPTS = 1;

export const MIN_RESEARCH_COVERAGE = 7.5;
export const MIN_RESEARCH_EVIDENCE = 7.5;
export const MIN_RESEARCH_FACTUAL = 7.5;
export const MIN_VERIFIED_CLAIMS = 3;
export const MIN_CLASS_AB_SOURCES = 2;

export const WORD_MIN_RATIO = 0.92;
export const WORD_MAX_RATIO = 1.08;
export const WORD_PREFERRED_MIN_RATIO = 0.98;
export const WORD_PREFERRED_MAX_RATIO = 1.02;

export const DIRECT_REPAIR_THINKING_LEVEL = "MINIMAL";
export const DIRECT_REPAIR_DEFAULT_MAX_OUTPUT_TOKENS = 48000;
export const DIRECT_REPAIR_MIN_OUTPUT_TOKENS = 32000;
export const DIRECT_REPAIR_MAX_OUTPUT_TOKENS = 60000;

export function clean(value) {
  return String(value ?? "").trim();
}

export function countWords(value) {
  const text = clean(value);
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

export function clampTargetWords(value, fallback = 2500) {
  const n = Number(value);
  const safe = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(500, Math.min(12000, Math.round(safe)));
}

export function wordRange(targetWords) {
  const target = clampTargetWords(targetWords);
  return {
    target,
    min: Math.floor(target * WORD_MIN_RATIO),
    max: Math.ceil(target * WORD_MAX_RATIO),
    preferredMin: Math.round(target * WORD_PREFERRED_MIN_RATIO),
    preferredMax: Math.round(target * WORD_PREFERRED_MAX_RATIO),
  };
}

export function productionMarker({ projectId, chapterNumber, sectionId, dossierId }) {
  return [
    "GENELIBROS_PRODUCTION_V1",
    `PROJECT:${clean(projectId)}`,
    `CHAPTER:${Number(chapterNumber)}`,
    `SECTION:${clean(sectionId)}`,
    `DOSSIER:${clean(dossierId) || "NONE"}`,
  ].join("|");
}

export function directRepairMaxOutputTokens(envValue) {
  const raw = Number(envValue || DIRECT_REPAIR_DEFAULT_MAX_OUTPUT_TOKENS);
  const safe = Number.isFinite(raw) ? raw : DIRECT_REPAIR_DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(
    DIRECT_REPAIR_MAX_OUTPUT_TOKENS,
    Math.max(DIRECT_REPAIR_MIN_OUTPUT_TOKENS, Math.round(safe)),
  );
}

export function researchMetrics(dossier) {
  const payload = dossier?.result && typeof dossier.result === "object" ? dossier.result : {};
  const claims = Array.isArray(payload.claims) ? payload.claims : [];
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  const gaps = Array.isArray(payload.gaps) ? payload.gaps : [];
  const verified = claims.filter(
    (claim) => clean(claim?.status).toUpperCase() === "VERIFIED" && Boolean(claim?.citationReady),
  );
  const classAB = sources.filter((source) => ["A", "B"].includes(clean(source?.sourceClass).toUpperCase()));

  return {
    coverage: Number(dossier?.coverage_score || 0),
    evidence: Number(dossier?.evidence_score || 0),
    factual: Number(dossier?.factual_confidence_score || 0),
    verifiedClaims: verified.length,
    classABSources: classAB.length,
    gaps: gaps.length,
    critical: gaps.filter((gap) => clean(gap?.severity).toUpperCase() === "CRITICAL").length,
    high: gaps.filter((gap) => clean(gap?.severity).toUpperCase() === "HIGH").length,
  };
}

export function researchMeetsMinimum(metrics) {
  return Boolean(
    metrics &&
    metrics.coverage >= MIN_RESEARCH_COVERAGE &&
    metrics.evidence >= MIN_RESEARCH_EVIDENCE &&
    metrics.factual >= MIN_RESEARCH_FACTUAL &&
    metrics.verifiedClaims >= MIN_VERIFIED_CLAIMS &&
    metrics.classABSources >= MIN_CLASS_AB_SOURCES
  );
}

export function productionPolicy({ dossierId = null, editorialOverride = false } = {}) {
  return {
    maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
    threshold: QUALITY_THRESHOLD,
    draftCount: DRAFT_COUNT,
    maxLlmCalls: FIRST_PASS_MAX_LLM_CALLS,
    creditGuard: true,
    firstPassOnly: true,
    researchDossierId: clean(dossierId) || null,
    researchEditorialOverride: Boolean(editorialOverride),
    productionVersion: DEEP_PRODUCTION_VERSION,
  };
}
