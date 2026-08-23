export type EliteUsageEvent = {
  user_id?: string;
  project_id?: string;
  event_type: string;
  action?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  credits_used?: number;
  metadata?: Record<string, unknown>;
};

export type EliteRateLimitDecision = {
  allowed: boolean;
  reason?: string;
  rateLimitPerHour: number;
  remaining?: number;
};

export function estimateTokenCostUsd(args: {
  inputTokens?: number;
  outputTokens?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
}): number {
  const inputTokens = Number(args.inputTokens || 0);
  const outputTokens = Number(args.outputTokens || 0);
  const inputCost = Number(args.inputCostPerMillion || 0.15);
  const outputCost = Number(args.outputCostPerMillion || 0.60);

  const total =
    (inputTokens / 1_000_000) * inputCost +
    (outputTokens / 1_000_000) * outputCost;

  return Number(total.toFixed(6));
}

export function createUsageEvent(args: EliteUsageEvent): EliteUsageEvent {
  return {
    user_id: args.user_id,
    project_id: args.project_id,
    event_type: args.event_type,
    action: args.action,
    model: args.model,
    input_tokens: Math.max(0, Number(args.input_tokens || 0)),
    output_tokens: Math.max(0, Number(args.output_tokens || 0)),
    estimated_cost_usd: Math.max(0, Number(args.estimated_cost_usd || 0)),
    credits_used: Math.max(0, Number(args.credits_used || 0)),
    metadata: args.metadata || {},
  };
}

export function evaluateRateLimit(args: {
  eventsLastHour: number;
  rateLimitPerHour: number;
}): EliteRateLimitDecision {
  const used = Math.max(0, Number(args.eventsLastHour || 0));
  const limit = Math.max(1, Number(args.rateLimitPerHour || 20));

  if (used >= limit) {
    return {
      allowed: false,
      reason: "RATE_LIMIT_EXCEEDED",
      rateLimitPerHour: limit,
      remaining: 0,
    };
  }

  return {
    allowed: true,
    rateLimitPerHour: limit,
    remaining: limit - used,
  };
}
