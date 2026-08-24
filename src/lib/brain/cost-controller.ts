import type {
  BrainCostGuard,
  BrainDepth,
  BrainTaskRequest,
  BrainWorkflowStep,
} from "./types";

const DEPTH_LIMITS: Record<
  BrainDepth,
  Omit<BrainCostGuard, "maxBudgetUsd">
> = {
  FAST: {
    maxWorkflowSteps: 16,
    maxDeepAgents: 6,
    maxSupremeAgents: 0,
    maxEstimatedTokens: 180_000,
  },
  DEEP: {
    maxWorkflowSteps: 32,
    maxDeepAgents: 18,
    maxSupremeAgents: 2,
    maxEstimatedTokens: 600_000,
  },
  SUPREME: {
    maxWorkflowSteps: 60,
    maxDeepAgents: 40,
    maxSupremeAgents: 12,
    maxEstimatedTokens: 1_800_000,
  },
  ULTRA: {
    maxWorkflowSteps: 120,
    maxDeepAgents: 80,
    maxSupremeAgents: 32,
    maxEstimatedTokens: 5_000_000,
  },
};

export function costGuardFor(
  request: BrainTaskRequest,
  depth: BrainDepth,
): BrainCostGuard {
  return {
    ...DEPTH_LIMITS[depth],
    maxBudgetUsd: request.maxBudgetUsd,
  };
}

export function enforceCostGuard(
  steps: BrainWorkflowStep[],
  guard: BrainCostGuard,
): string[] {
  const warnings: string[] = [];

  if (steps.length > guard.maxWorkflowSteps) {
    warnings.push(
      `workflow-steps:${steps.length}>${guard.maxWorkflowSteps}`,
    );
  }

  const deep = steps.filter((step) => step.modelClass === "DEEP").length;
  const supreme = steps.filter((step) => step.modelClass === "SUPREME").length;

  if (deep > guard.maxDeepAgents) {
    warnings.push(`deep-agents:${deep}>${guard.maxDeepAgents}`);
  }

  if (supreme > guard.maxSupremeAgents) {
    warnings.push(`supreme-agents:${supreme}>${guard.maxSupremeAgents}`);
  }

  return warnings;
}
