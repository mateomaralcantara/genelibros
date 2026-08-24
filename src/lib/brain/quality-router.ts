import type {
  BrainDepth,
  BrainQualityProfile,
  BrainTaskRequest,
} from "./types";

export function qualityProfileFor(
  request: BrainTaskRequest,
  depth: BrainDepth,
): BrainQualityProfile {
  const base =
    depth === "FAST"
      ? 8.8
      : depth === "DEEP"
        ? 9.2
        : depth === "SUPREME"
          ? 9.5
          : 9.6;

  const factuality = request.nonfiction ? Math.max(base, 9.5) : 9.0;
  const series = (request.seriesCount || 0) > 1 || request.seriesId;

  return {
    globalMinimum: base,
    factualityMinimum: factuality,
    continuityMinimum: Math.max(9.0, base - 0.2),
    originalityMinimum: Math.max(9.0, base - 0.2),
    nonRepetitionMinimum: Math.max(9.1, base - 0.1),
    seriesDifferentiationMinimum: series ? Math.max(9.3, base - 0.1) : undefined,
    maxRepairIterations:
      depth === "FAST" ? 1 : depth === "DEEP" ? 3 : depth === "SUPREME" ? 5 : 7,
  };
}
