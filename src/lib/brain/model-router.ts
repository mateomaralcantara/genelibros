import type {
  BrainAgentDefinition,
  BrainDepth,
  BrainModelClass,
  BrainModelRoute,
} from "./types";

export interface BrainModelConfig {
  fastModel: string;
  deepModel: string;
  supremeModel: string;
}

export const DEFAULT_BRAIN_MODELS: BrainModelConfig = {
  fastModel: "gemini-2.5-flash",
  deepModel: "gemini-2.5-pro",
  supremeModel: "gemini-2.5-pro",
};

const CLASS_RANK: Record<BrainModelClass, number> = {
  FAST: 1,
  DEEP: 2,
  SUPREME: 3,
};

function depthFloor(depth: BrainDepth): BrainModelClass {
  if (depth === "FAST") return "FAST";
  if (depth === "DEEP") return "FAST";
  return "DEEP";
}

function maxClass(a: BrainModelClass, b: BrainModelClass): BrainModelClass {
  return CLASS_RANK[a] >= CLASS_RANK[b] ? a : b;
}

export function routeModel(
  agent: BrainAgentDefinition,
  depth: BrainDepth,
  config: BrainModelConfig = DEFAULT_BRAIN_MODELS,
): BrainModelRoute {
  let modelClass = maxClass(agent.modelClass, depthFloor(depth));

  if (depth === "ULTRA" && agent.modelClass === "DEEP") {
    modelClass = "SUPREME";
  }

  const model =
    modelClass === "FAST"
      ? config.fastModel
      : modelClass === "DEEP"
        ? config.deepModel
        : config.supremeModel;

  return {
    agentId: agent.id,
    modelClass,
    model,
    reason: `agent=${agent.modelClass};depth=${depth};selected=${modelClass}`,
  };
}
