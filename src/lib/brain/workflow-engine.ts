import { AgentRegistry, defaultAgentRegistry } from "./agent-registry";
import { costGuardFor, enforceCostGuard } from "./cost-controller";
import { routeModel } from "./model-router";
import { qualityProfileFor } from "./quality-router";
import { routeTask } from "./task-router";
import type {
  BrainAgentDefinition,
  BrainDepth,
  BrainTaskRequest,
  BrainWorkflowPlan,
  BrainWorkflowStep,
} from "./types";

export const GENELIBROS_BRAIN_VERSION = "5.0.0-11A";

function depthFor(request: BrainTaskRequest): BrainDepth {
  return request.depth || "DEEP";
}

function bestAgentForCapability(
  registry: AgentRegistry,
  capability: string,
): BrainAgentDefinition | undefined {
  const ready = registry.byCapability(capability, false);
  if (ready.length) return ready[0];

  const any = registry.byCapability(capability, true);
  return any[0];
}

function parallelGroup(agent: BrainAgentDefinition): string | undefined {
  if (!agent.canRunParallel) return undefined;
  if (agent.family === "EDITORIAL") return "EDITORIAL_COUNCIL";
  if (agent.family === "RESEARCH") return "RESEARCH_PARALLEL";
  if (agent.family === "REFINERY") return "REFINERY_PARALLEL";
  return `${agent.family}_PARALLEL`;
}

export function buildWorkflowPlan(
  request: BrainTaskRequest,
  registry: AgentRegistry = defaultAgentRegistry,
): BrainWorkflowPlan {
  const route = routeTask(request);
  const depth = depthFor(request);
  const quality = qualityProfileFor(request, depth);
  const costGuard = costGuardFor(request, depth);

  const capabilities = [
    ...route.requiredCapabilities.map((capability) => ({
      capability,
      required: true,
    })),
    ...route.optionalCapabilities.map((capability) => ({
      capability,
      required: false,
    })),
  ];

  const seen = new Set<string>();
  const steps: BrainWorkflowStep[] = [];
  const missingCapabilities: string[] = [];
  const executableAgentIds: string[] = [];
  const plannedAgentIds: string[] = [];

  for (const item of capabilities) {
    if (seen.has(item.capability)) continue;
    seen.add(item.capability);

    const agent = bestAgentForCapability(registry, item.capability);

    if (!agent) {
      if (item.required) missingCapabilities.push(item.capability);
      continue;
    }

    const model = routeModel(agent, depth);
    const executable = agent.status === "READY";

    if (executable) executableAgentIds.push(agent.id);
    else plannedAgentIds.push(agent.id);

    steps.push({
      id: `step-${String(steps.length + 1).padStart(3, "0")}`,
      order: steps.length + 1,
      kind: "AGENT",
      agentId: agent.id,
      family: agent.family,
      capability: item.capability,
      parallelGroup: parallelGroup(agent),
      dependsOn: steps.length ? [steps[steps.length - 1].id] : [],
      required: item.required,
      status: agent.status,
      model: model.model,
      modelClass: model.modelClass,
      qualityThreshold: Math.max(
        agent.qualityThreshold,
        item.capability.includes("quality")
          ? quality.globalMinimum
          : agent.qualityThreshold,
      ),
      notes: [
        executable
          ? "executable-now"
          : "planned-agent-not-yet-executable",
        model.reason,
      ],
    });
  }

  const warnings = enforceCostGuard(steps, costGuard);

  if (plannedAgentIds.length) {
    warnings.push(
      `planned-agents:${[...new Set(plannedAgentIds)].join(",")}`,
    );
  }

  if (missingCapabilities.length) {
    warnings.push(`missing-capabilities:${missingCapabilities.join(",")}`);
  }

  return {
    version: GENELIBROS_BRAIN_VERSION,
    intent: route.intent,
    depth,
    route,
    steps,
    executableAgentIds: [...new Set(executableAgentIds)],
    plannedAgentIds: [...new Set(plannedAgentIds)],
    missingCapabilities,
    quality,
    costGuard,
    warnings,
  };
}
