export type EliteLogLevel = "debug" | "info" | "warn" | "error";

export type EliteLogEvent = {
  level?: EliteLogLevel;
  message: string;
  project_id?: string;
  action?: string;
  user_id?: string;
  model?: string;
  job_id?: string;
  stage?: string;
  score?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    estimated_cost_usd?: number;
    credits_used?: number;
  };
  metadata?: Record<string, unknown>;
};

export function eliteLogEvent(event: EliteLogEvent): EliteLogEvent {
  const payload: EliteLogEvent = {
    level: event.level || "info",
    message: event.message,
    project_id: event.project_id,
    action: event.action,
    user_id: event.user_id,
    model: event.model,
    job_id: event.job_id,
    stage: event.stage,
    score: event.score,
    usage: event.usage || {},
    metadata: {
      timestamp: new Date().toISOString(),
      runtime: "BestSellerAI",
      observability: true,
      ...(event.metadata || {}),
    },
  };

  const line = JSON.stringify(payload);

  if (payload.level === "error") {
    console.error(line);
  } else if (payload.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }

  return payload;
}

export function eliteLogComposerStart(args: {
  project_id?: string;
  action?: string;
  user_id?: string;
  model?: string;
}) {
  return eliteLogEvent({
    level: "info",
    message: "composer_start",
    project_id: args.project_id,
    action: args.action,
    user_id: args.user_id,
    model: args.model,
  });
}

export function eliteLogComposerEnd(args: {
  project_id?: string;
  action?: string;
  user_id?: string;
  model?: string;
  score?: number;
}) {
  return eliteLogEvent({
    level: "info",
    message: "composer_end",
    project_id: args.project_id,
    action: args.action,
    user_id: args.user_id,
    model: args.model,
    score: args.score,
  });
}
