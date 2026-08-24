import { defaultAgentRegistry } from "./agent-registry";
import { buildBrainContext } from "./context-builder";
import { buildWorkflowPlan } from "./workflow-engine";
import type {
  BrainContextInput,
  BrainDepth,
  BrainTaskRequest,
  BrainWorkflowPlan,
} from "./types";

export class GenelibrosBrain {
  plan(request: BrainTaskRequest): BrainWorkflowPlan {
    return buildWorkflowPlan(request, defaultAgentRegistry);
  }

  context(input: BrainContextInput, depth?: BrainDepth) {
    return buildBrainContext(input, depth || input.request.depth || "DEEP");
  }

  agents() {
    return defaultAgentRegistry.all();
  }

  readyAgents() {
    return defaultAgentRegistry.ready();
  }

  plannedAgents() {
    return defaultAgentRegistry.planned();
  }

  health() {
    const issues = defaultAgentRegistry.validate();
    return {
      ok: issues.length === 0,
      version: "5.0.0-11A",
      readyAgents: defaultAgentRegistry.ready().length,
      plannedAgents: defaultAgentRegistry.planned().length,
      issues,
    };
  }
}

export const genelibrosBrain = new GenelibrosBrain();
