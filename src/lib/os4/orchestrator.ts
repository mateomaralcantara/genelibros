import type { Project } from "../../../types";
import type { ComposerTask } from "../types.local";
import {
  buildMasterFromState,
  ensureArray,
  ensureString,
  normalizeProjectState,
  processEngineResult,
  recomputeGenerationProgress,
} from "../editor";
import { callComposer } from "../gemini";
import {
  buildMasterServer,
  insertMasterSnapshot,
  insertSectionVersion,
  updateProject,
  upsertSection,
} from "../../data/repo";
import { OS4_THRESHOLDS, clampScore } from "./config";
import { callOs4Agent, mergeResearchContexts, runOs4Research } from "./client";
import {
  ensureOs4Profile,
  getOs4Profile,
  insertOs4AgentRun,
  insertOs4Event,
  insertOs4FailedAgentRun,
  insertOs4QualityReport,
  listOs4QualityReports,
  patchOs4Profile,
  replaceOs4Claims,
  setOs4Stage,
} from "./repo";
import {
  buildQualityReport,
  normalizeAgentReview,
} from "./quality";
import type {
  Os4AgentName,
  Os4AgentReview,
  Os4Blueprint,
  Os4ChapterOptions,
  Os4ConceptBattle,
  Os4KnowledgeGraph,
  Os4LaunchPlan,
  Os4MarketIntelligence,
  Os4PipelineEvent,
  Os4PreproductionOptions,
  Os4Profile,
  Os4QualityReport,
  Os4ResearchBundle,
  Os4ResearchPlan,
  Os4Simulation,
} from "./types";

function traceId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function emit(
  projectId: string,
  callback: ((event: Os4PipelineEvent) => void) | undefined,
  event: Os4PipelineEvent
) {
  callback?.(event);
  insertOs4Event(projectId, event).catch(() => {});
}

async function trackedAgent<T>(args: {
  projectId: string;
  agent: Os4AgentName;
  action: string;
  payload: Record<string, unknown>;
  inputSummary: string;
}): Promise<T> {
  const t = traceId(args.agent.toLowerCase());
  try {
    const response = await callOs4Agent<T>({
      agent: args.agent,
      action: args.action,
      payload: args.payload,
      traceId: t,
    });
    await insertOs4AgentRun(args.projectId, args.action, response, args.inputSummary);
    return response.output;
  } catch (error: any) {
    await insertOs4FailedAgentRun({
      projectId: args.projectId,
      agent: args.agent,
      action: args.action,
      traceId: t,
      error: String(error?.message || error),
    }).catch(() => {});
    throw error;
  }
}

function blueprintToOutline(blueprint: Os4Blueprint) {
  return ensureArray<any>(blueprint?.chapters, []).map((chapter: any, index) => ({
    chapter_number: Number(chapter?.chapter_number ?? index + 1),
    chapter_title: ensureString(chapter?.chapter_title, `Capítulo ${index + 1}`),
    objective: ensureString(chapter?.objective, ""),
    key_points: ensureArray<any>(chapter?.key_points, []).map(String),
    subheads_h2: ensureArray<any>(chapter?.subheads_h2, []).map(String),
    tools_frameworks: [],
    exercises: [],
    deliverable: "",
    transition_to_next: ensureString(chapter?.transition_to_next, ""),
    status: "PENDING",
    target_words: Math.max(800, Number(chapter?.target_words ?? 3000) || 3000),
    os4: {
      chapter_thesis: ensureString(chapter?.chapter_thesis, ""),
      required_facts: ensureArray<any>(chapter?.required_facts, []).map(String),
      source_needs: ensureArray<any>(chapter?.source_needs, []).map(String),
      contradiction_checks: ensureArray<any>(chapter?.contradiction_checks, []).map(String),
    },
  }));
}

function replaceChapterText(project: Project, chapterNumber: number, text: string): Project {
  const state: any = JSON.parse(JSON.stringify(project.state || {}));
  const chapters = ensureArray<any>(state.chapters, []);
  const index = chapters.findIndex(
    (x: any) => Number(x?.chapter_number ?? 0) === chapterNumber
  );
  const outline = ensureArray<any>(state.outline_12, []);
  const o = outline.find(
    (x: any) => Number(x?.chapter_number ?? 0) === chapterNumber
  );

  const chapter = {
    ...(index >= 0 ? chapters[index] : {}),
    id: `sec_chapter_${String(chapterNumber).padStart(2, "0")}`,
    chapter_number: chapterNumber,
    title: ensureString(
      index >= 0 ? chapters[index]?.title : "",
      ensureString(o?.chapter_title, `Capítulo ${chapterNumber}`)
    ),
    text: String(text || "").trim(),
    words: String(text || "").trim().split(/\s+/).filter(Boolean).length,
    status: "COMPLETED",
  };

  if (index >= 0) chapters[index] = chapter;
  else chapters.push(chapter);

  state.chapters = chapters.sort(
    (a: any, b: any) =>
      (Number(a?.chapter_number ?? 0) || 0) -
      (Number(b?.chapter_number ?? 0) || 0)
  );

  const normalized = normalizeProjectState(state);
  const master = buildMasterFromState(normalized, project.title);

  const next = {
    ...project,
    state: normalized,
    master_document: {
      ...(project.master_document as any),
      title: project.title,
      text: master,
      chunks: [{ index: 1, total: 1, text: master }],
    },
  } as Project;

  (next as any).generation_progress = recomputeGenerationProgress(next);
  return next;
}

async function persistChapter(project: Project, chapterNumber: number) {
  const state: any = project.state || {};
  const chapter = ensureArray<any>(state.chapters, []).find(
    (x: any) => Number(x?.chapter_number ?? 0) === chapterNumber
  );
  if (!chapter) throw new Error(`OS4: capítulo ${chapterNumber} no encontrado.`);

  const sectionId = await upsertSection({
    project_id: project.id,
    type: "CHAPTER",
    chapter_number: chapterNumber,
    title: ensureString(chapter?.title, `Capítulo ${chapterNumber}`),
    content: ensureString(chapter?.text, ""),
    status: "COMPLETED",
  });

  await insertSectionVersion(sectionId, ensureString(chapter?.text, ""));

  await updateProject(project.id, {
    title: project.title,
    dossier: (state as any).dossier || {},
    outline_12: ensureArray<any>((state as any).outline_12, []),
    continuity_pack: (state as any).continuity_pack || {},
  });

  const masterText = await buildMasterServer(project.id);
  await insertMasterSnapshot(project.id, project.title, masterText);

  return {
    ...project,
    master_document: {
      ...(project.master_document as any),
      title: project.title,
      text: masterText,
      chunks: [{ index: 1, total: 1, text: masterText }],
    },
  } as Project;
}

async function collectResearch(
  plan: Os4ResearchPlan,
  urls: string[],
  maxQueries: number,
  onProgress?: (message: string) => void
): Promise<Os4ResearchBundle> {
  const allSources: any[] = [];
  const allFacts: any[] = [];
  const contexts: string[] = [];

  const queries = ensureArray<any>(plan?.queries, [])
    .filter((x: any) => x?.query)
    .slice(0, Math.max(1, maxQueries));

  for (let i = 0; i < queries.length; i++) {
    const q = String(queries[i]?.query || "").trim();
    if (!q) continue;

    onProgress?.(`Investigando ${i + 1}/${queries.length}: ${q}`);

    try {
      const result = await runOs4Research({
        query: q,
        urls: i === 0 ? urls : [],
        maxSources: 5,
      });
      allSources.push(...result.sources);
      allFacts.push(...result.facts);
      if (result.research_context) contexts.push(result.research_context);
    } catch (error: any) {
      contexts.push(
        `INVESTIGACIÓN PENDIENTE: ${q}\nMotivo: ${String(
          error?.message || error
        )}`
      );
    }
  }

  const uniqueSources = Array.from(
    new Map(allSources.map((s: any) => [String(s?.url || s?.title), s])).values()
  );

  const coverage =
    queries.length === 0
      ? 0
      : Math.min(10, (uniqueSources.length / Math.max(1, queries.length * 2)) * 10);

  return {
    plan,
    sources: uniqueSources as any,
    facts: allFacts.slice(0, 250),
    compiled_context: mergeResearchContexts(contexts),
    coverage_score: Math.round(coverage * 100) / 100,
  };
}

export async function runOs4Preproduction(
  project: Project,
  options: Os4PreproductionOptions
): Promise<{ project: Project; profile: Os4Profile }> {
  const onEvent = options.onEvent;
  await ensureOs4Profile(project.id, options.mode);

  try {
    emit(project.id, onEvent, {
      stage: "MARKET",
      status: "RUNNING",
      message: "Analizando oportunidad editorial y comercial.",
    });
    await setOs4Stage(project.id, "MARKET", "RUNNING");

    const market = await trackedAgent<Os4MarketIntelligence>({
      projectId: project.id,
      agent: "MARKET_STRATEGIST",
      action: "ANALYZE_MARKET",
      payload: {
        title: project.title,
        topic: (project.state as any)?.book_topic || "",
        audience: (project.state as any)?.audience || "",
        current_outline: (project.state as any)?.outline_12 || [],
      },
      inputSummary: project.title,
    });

    await patchOs4Profile(project.id, { market });
    emit(project.id, onEvent, {
      stage: "MARKET",
      status: "COMPLETED",
      message: `Market score: ${clampScore(market?.market_score)}/10`,
      score: clampScore(market?.market_score),
    });

    emit(project.id, onEvent, {
      stage: "CONCEPT_BATTLE",
      status: "RUNNING",
      message: "Enfrentando conceptos, títulos, promesas y ángulos.",
    });

    const conceptBattle = await trackedAgent<Os4ConceptBattle>({
      projectId: project.id,
      agent: "CONCEPT_ARENA",
      action: "BATTLE_CONCEPTS",
      payload: { market, project_state: project.state },
      inputSummary: `Concept battle: ${project.title}`,
    });

    await patchOs4Profile(project.id, {
      concept_battle: conceptBattle,
      current_stage: "CONCEPT_BATTLE",
    });

    let authorDNA: any = null;
    if (String(options.authorSamples || "").trim()) {
      emit(project.id, onEvent, {
        stage: "AUTHOR_DNA",
        status: "RUNNING",
        message: "Construyendo DNA estilístico del autor.",
      });

      authorDNA = await trackedAgent({
        projectId: project.id,
        agent: "AUTHOR_DNA_ANALYST",
        action: "ANALYZE_AUTHOR_DNA",
        payload: {
          samples: String(options.authorSamples || "").slice(0, 28000),
        },
        inputSummary: "Author DNA samples",
      });

      await patchOs4Profile(project.id, {
        author_dna: authorDNA,
        current_stage: "AUTHOR_DNA",
      });
    }

    emit(project.id, onEvent, {
      stage: "BLUEPRINT",
      status: "RUNNING",
      message: "Construyendo Blueprint Maestro obligatorio.",
    });

    const blueprint = await trackedAgent<Os4Blueprint>({
      projectId: project.id,
      agent: "BOOK_ARCHITECT",
      action: "BUILD_SUPREME_BLUEPRINT",
      payload: {
        market,
        concept_battle: conceptBattle,
        author_dna: authorDNA,
        original_state: project.state,
        target_chapter_words: options.targetChapterWords,
      },
      inputSummary: `Blueprint: ${project.title}`,
    });

    if (clampScore(blueprint?.blueprint_score) < OS4_THRESHOLDS.blueprintApproval) {
      emit(project.id, onEvent, {
        stage: "BLUEPRINT",
        status: "BLOCKED",
        message: `Blueprint por debajo de ${OS4_THRESHOLDS.blueprintApproval}/10.`,
        score: clampScore(blueprint?.blueprint_score),
      });
      if (options.mode !== "AUTONOMOUS") {
        await setOs4Stage(project.id, "BLUEPRINT", "WAITING_APPROVAL");
      }
    }

    await patchOs4Profile(project.id, {
      blueprint,
      current_stage: "BLUEPRINT",
      status: "RUNNING",
    });

    emit(project.id, onEvent, {
      stage: "RESEARCH",
      status: "RUNNING",
      message: "Diseñando plan de investigación por capítulo.",
    });

    const researchPlan = await trackedAgent<Os4ResearchPlan>({
      projectId: project.id,
      agent: "RESEARCH_DIRECTOR",
      action: "BUILD_RESEARCH_PLAN",
      payload: { blueprint, market },
      inputSummary: `Research plan: ${blueprint.selected_title}`,
    });

    const researchBundle = await collectResearch(
      researchPlan,
      options.researchUrls || [],
      options.maxResearchQueries || 5,
      (message) =>
        emit(project.id, onEvent, {
          stage: "RESEARCH",
          status: "RUNNING",
          message,
        })
    );

    await patchOs4Profile(project.id, {
      research_bundle: researchBundle,
      current_stage: "RESEARCH",
    });

    emit(project.id, onEvent, {
      stage: "KNOWLEDGE_GRAPH",
      status: "RUNNING",
      message: "Construyendo Knowledge Graph y detector de contradicciones.",
    });

    const knowledgeGraph = await trackedAgent<Os4KnowledgeGraph>({
      projectId: project.id,
      agent: "KNOWLEDGE_ENGINEER",
      action: "BUILD_KNOWLEDGE_GRAPH",
      payload: {
        blueprint,
        research_plan: researchPlan,
        research_context: researchBundle.compiled_context.slice(0, 55000),
        facts: researchBundle.facts.slice(0, 120),
      },
      inputSummary: `Knowledge graph: ${blueprint.selected_title}`,
    });

    await patchOs4Profile(project.id, {
      knowledge_graph: knowledgeGraph,
      current_stage: "KNOWLEDGE_GRAPH",
    });

    emit(project.id, onEvent, {
      stage: "SIMULATION",
      status: "RUNNING",
      message: "Simulando el libro completo antes de escribirlo.",
    });

    const simulation = await trackedAgent<Os4Simulation>({
      projectId: project.id,
      agent: "BOOK_SIMULATOR",
      action: "SIMULATE_BOOK",
      payload: {
        blueprint,
        market,
        research_coverage_score: researchBundle.coverage_score,
        knowledge_graph: knowledgeGraph,
      },
      inputSummary: `Simulation: ${blueprint.selected_title}`,
    });

    await patchOs4Profile(project.id, {
      simulation,
      current_stage: "SIMULATION",
    });

    emit(project.id, onEvent, {
      stage: "CHIEF_APPROVAL",
      status: "RUNNING",
      message: "Chief Editor realizando aprobación preproducción.",
    });

    const chiefApproval: any = await trackedAgent({
      projectId: project.id,
      agent: "CHIEF_EDITOR",
      action: "APPROVE_PREPRODUCTION",
      payload: {
        market,
        concept_battle: conceptBattle,
        blueprint,
        research_coverage_score: researchBundle.coverage_score,
        knowledge_graph_summary: {
          nodes: knowledgeGraph.nodes?.length || 0,
          edges: knowledgeGraph.edges?.length || 0,
          contradictions: knowledgeGraph.contradictions || [],
        },
        simulation,
      },
      inputSummary: `Chief approval: ${blueprint.selected_title}`,
    });

    const outline = blueprintToOutline(blueprint);
    const state: any = JSON.parse(JSON.stringify(project.state || {}));
    state.book_title = blueprint.selected_title || project.title;
    state.audience = blueprint.audience || state.audience || "";
    state.tone_style = blueprint.tone_style || state.tone_style || "";
    state.outline_12 = outline;
    state.dossier = {
      ...(state.dossier || {}),
      book_subtitle: blueprint.selected_subtitle,
      os4_market: market,
      os4_blueprint: blueprint,
      os4_simulation: simulation,
    };
    state.continuity_pack = {
      ...(state.continuity_pack || {}),
      os4_version: "4.0.0-supreme",
      chapter_count: outline.length,
      book_subtitle: blueprint.selected_subtitle,
      central_thesis: blueprint.central_thesis,
      research_coverage_score: researchBundle.coverage_score,
    };
    (state as any).research_context = researchBundle.compiled_context;
    (state as any).author_dna = authorDNA || undefined;
    (state as any).knowledge_graph = knowledgeGraph;

    const normalized = normalizeProjectState(state);
    const nextProject: Project = {
      ...project,
      title: blueprint.selected_title || project.title,
      state: normalized,
      master_document: {
        ...(project.master_document as any),
        title: blueprint.selected_title || project.title,
        text: buildMasterFromState(normalized, blueprint.selected_title || project.title),
        chunks: [],
      },
    } as Project;

    (nextProject as any).generation_progress =
      recomputeGenerationProgress(nextProject);

    await updateProject(project.id, {
      title: nextProject.title,
      audience: blueprint.audience,
      tone_style: blueprint.tone_style,
      dossier: (normalized as any).dossier || {},
      outline_12: outline,
      continuity_pack: (normalized as any).continuity_pack || {},
    });

    const overall = clampScore(
      (clampScore(market.market_score) +
        clampScore(blueprint.blueprint_score) +
        clampScore(simulation.structural_score) +
        clampScore(chiefApproval?.score ?? chiefApproval?.global_score ?? 9)) /
        4
    );

    await patchOs4Profile(project.id, {
      chief_approval: chiefApproval,
      overall_score: overall,
      current_stage: "CHIEF_APPROVAL",
      status:
        options.mode === "EDITORIAL" ? "WAITING_APPROVAL" : "COMPLETED",
    });

    emit(project.id, onEvent, {
      stage: "CHIEF_APPROVAL",
      status:
        options.mode === "EDITORIAL" ? "WAITING_APPROVAL" : "COMPLETED",
      message:
        options.mode === "EDITORIAL"
          ? "Preproducción lista. Esperando aprobación editorial humana."
          : "Preproducción Supreme aprobada.",
      score: overall,
    });

    const profile = (await getOs4Profile(project.id))!;
    return { project: nextProject, profile };
  } catch (error) {
    await patchOs4Profile(project.id, { status: "FAILED" }).catch(() => {});
    throw error;
  }
}

function chapterText(project: Project, n: number): string {
  const ch = ensureArray<any>((project.state as any)?.chapters, []).find(
    (x: any) => Number(x?.chapter_number ?? 0) === n
  );
  return ensureString(ch?.text, "");
}

async function councilRound(args: {
  project: Project;
  chapterNumber: number;
  text: string;
  profile: Os4Profile | null;
  iteration: number;
}): Promise<Os4QualityReport> {
  const outline = ensureArray<any>((args.project.state as any)?.outline_12, []);
  const chapterPlan = outline.find(
    (x: any) => Number(x?.chapter_number ?? 0) === args.chapterNumber
  );

  const previousChapters = ensureArray<any>(
    (args.project.state as any)?.chapters,
    []
  )
    .filter((x: any) => Number(x?.chapter_number ?? 0) < args.chapterNumber)
    .slice(-3)
    .map((x: any) => ({
      chapter_number: x.chapter_number,
      title: x.title,
      tail: ensureString(x.text, "").slice(-3500),
    }));

  const shared = {
    book_title: args.project.title,
    chapter_number: args.chapterNumber,
    chapter_plan: chapterPlan,
    chapter_text: args.text.slice(0, 42000),
    previous_chapters: previousChapters,
    author_dna: args.profile?.author_dna,
    knowledge_graph: args.profile?.knowledge_graph,
    research_context: args.profile?.research_bundle?.compiled_context?.slice(0, 28000),
  };

  const [factRaw, continuityRaw, styleRaw, adversarialRaw] = await Promise.all([
    trackedAgent<any>({
      projectId: args.project.id,
      agent: "FACT_CHECKER",
      action: "REVIEW_CHAPTER",
      payload: shared,
      inputSummary: `Fact check chapter ${args.chapterNumber}`,
    }),
    trackedAgent<any>({
      projectId: args.project.id,
      agent: "CONTINUITY_EDITOR",
      action: "REVIEW_CHAPTER",
      payload: shared,
      inputSummary: `Continuity chapter ${args.chapterNumber}`,
    }),
    trackedAgent<any>({
      projectId: args.project.id,
      agent: "STYLE_EDITOR",
      action: "REVIEW_CHAPTER",
      payload: shared,
      inputSummary: `Style chapter ${args.chapterNumber}`,
    }),
    trackedAgent<any>({
      projectId: args.project.id,
      agent: "ADVERSARIAL_CRITIC",
      action: "ATTACK_CHAPTER",
      payload: shared,
      inputSummary: `Adversarial chapter ${args.chapterNumber}`,
    }),
  ]);

  await replaceOs4Claims(
    args.project.id,
    args.chapterNumber,
    Array.isArray(factRaw?.claims) ? factRaw.claims : []
  ).catch(() => {});

  const reviews: Os4AgentReview[] = [
    normalizeAgentReview("FACT_CHECKER", factRaw),
    normalizeAgentReview("CONTINUITY_EDITOR", continuityRaw),
    normalizeAgentReview("STYLE_EDITOR", styleRaw),
    normalizeAgentReview("ADVERSARIAL_CRITIC", adversarialRaw),
  ];

  const judge = await trackedAgent<any>({
    projectId: args.project.id,
    agent: "QUALITY_JUDGE",
    action: "JUDGE_COUNCIL",
    payload: {
      ...shared,
      council: reviews,
      iteration: args.iteration,
    },
    inputSummary: `Quality judge chapter ${args.chapterNumber}`,
  });

  return buildQualityReport({
    chapterNumber: args.chapterNumber,
    text: args.text,
    iteration: args.iteration,
    reviews,
    judge,
  });
}

export async function runOs4Chapter(
  project: Project,
  chapterNumber: number,
  options: Os4ChapterOptions
): Promise<{ project: Project; quality: Os4QualityReport }> {
  const onEvent = options.onEvent;
  const profile = await getOs4Profile(project.id);
  const minimum = options.minimumScore ?? OS4_THRESHOLDS.chapterApproval;
  const maxRepairs =
    options.maxRepairIterations ?? OS4_THRESHOLDS.maxRepairIterations;

  emit(project.id, onEvent, {
    stage: "WRITING",
    status: "RUNNING",
    message: `Generando capítulo ${chapterNumber} con contexto Supreme.`,
  });

  const stateForComposer: any = JSON.parse(
    JSON.stringify(project.state || {})
  );
  stateForComposer.research_context =
    profile?.research_bundle?.compiled_context || "";
  stateForComposer.author_dna = profile?.author_dna || null;
  stateForComposer.knowledge_graph = profile?.knowledge_graph || null;

  const task: ComposerTask = {
    action: "GENERATE_CHAPTER",
    chapter_number: chapterNumber,
    target_length_words: options.targetWords,
    active_view: "CHAPTER",
  };

  const generated = await callComposer({
    task,
    state: stateForComposer,
    model:
      (import.meta as any).env?.VITE_GEMINI_MODEL ||
      "gemini-3.1-flash-lite",
    isDev: Boolean((import.meta as any).env?.DEV),
    devApiKey: (import.meta as any).env?.VITE_GEMINI_API_KEY || "",
  });

  let next = processEngineResult(generated as any, project, {
    action: "GENERATE_CHAPTER",
    chapterNum: chapterNumber,
  });

  let currentText = chapterText(next, chapterNumber);
  if (!currentText.trim()) {
    throw new Error(`OS4: el capítulo ${chapterNumber} quedó vacío.`);
  }

  let finalReport: Os4QualityReport | null = null;

  for (let iteration = 0; iteration <= maxRepairs; iteration++) {
    emit(project.id, onEvent, {
      stage: "QUALITY_COUNCIL",
      status: "RUNNING",
      message: `Council review capítulo ${chapterNumber}, ronda ${
        iteration + 1
      }.`,
    });

    const report = await councilRound({
      project: next,
      chapterNumber,
      text: currentText,
      profile,
      iteration,
    });

    await insertOs4QualityReport(project.id, report);
    finalReport = report;

    emit(project.id, onEvent, {
      stage: "QUALITY_COUNCIL",
      status:
        report.status === "APPROVED"
          ? "COMPLETED"
          : report.status === "BLOCKED"
            ? "BLOCKED"
            : "RUNNING",
      message: `Capítulo ${chapterNumber}: ${report.global_score}/10 — ${report.status}`,
      score: report.global_score,
    });

    if (
      report.status === "APPROVED" &&
      report.global_score >= minimum
    ) {
      break;
    }

    if (iteration >= maxRepairs) break;

    const rewrite: any = await trackedAgent({
      projectId: project.id,
      agent: "REWRITE_EDITOR",
      action: "REWRITE_CHAPTER",
      payload: {
        book_title: project.title,
        chapter_number: chapterNumber,
        original_text: currentText.slice(0, 48000),
        quality_report: report,
        research_context:
          profile?.research_bundle?.compiled_context?.slice(0, 26000) || "",
        author_dna: profile?.author_dna,
        instruction:
          "Reescribe preservando hechos respaldados, corrigiendo únicamente defectos detectados. No inventes datos.",
      },
      inputSummary: `Rewrite chapter ${chapterNumber}, iteration ${iteration + 1}`,
    });

    const rewritten = ensureString(rewrite?.text, "").trim();
    if (rewritten.split(/\s+/).filter(Boolean).length < 300) {
      throw new Error(
        `OS4: reescritura demasiado corta en capítulo ${chapterNumber}.`
      );
    }

    currentText = rewritten;
    next = replaceChapterText(next, chapterNumber, currentText);
  }

  if (!finalReport) {
    throw new Error("OS4: no se generó reporte de calidad.");
  }

  next = replaceChapterText(next, chapterNumber, currentText);

  const state: any = JSON.parse(JSON.stringify(next.state || {}));
  state.continuity_pack = {
    ...(state.continuity_pack || {}),
    os4_last_chapter: chapterNumber,
    os4_last_quality: finalReport.global_score,
    os4_last_status: finalReport.status,
  };
  next = {
    ...next,
    state: normalizeProjectState(state),
  } as Project;

  next = await persistChapter(next, chapterNumber);

  await patchOs4Profile(project.id, {
    current_stage: "QUALITY_COUNCIL",
    status:
      finalReport.status === "APPROVED" ? "COMPLETED" : "BLOCKED",
    overall_score: finalReport.global_score,
  });

  return { project: next, quality: finalReport };
}

export async function runOs4AllChapters(
  project: Project,
  options: Os4ChapterOptions & {
    onProject?: (project: Project) => void;
    shouldStop?: () => boolean;
  }
): Promise<Project> {
  let current = project;
  const outline = ensureArray<any>((current.state as any)?.outline_12, []);
  const qualityHistory = await listOs4QualityReports(project.id).catch(() => []);
  const approvedChapters = new Set(
    qualityHistory
      .filter((row: any) => row?.status === "APPROVED")
      .map((row: any) => Number(row?.chapter_number ?? 0))
      .filter(Boolean)
  );

  for (const item of outline) {
    if (options.shouldStop?.()) break;

    const n = Number(item?.chapter_number ?? 0) || 0;
    if (!n) continue;

    if (approvedChapters.has(n) && chapterText(current, n).trim()) {
      emit(current.id, options.onEvent, {
        stage: "WRITING",
        status: "COMPLETED",
        message: `Capítulo ${n} ya estaba aprobado. Se conserva y se continúa.`,
      });
      continue;
    }

    const result = await runOs4Chapter(current, n, {
      ...options,
      targetWords:
        Number(item?.target_words ?? 0) ||
        options.targetWords,
    });

    current = result.project;
    options.onProject?.(current);

    if (result.quality.status === "BLOCKED") {
      emit(current.id, options.onEvent, {
        stage: "QUALITY_COUNCIL",
        status: "BLOCKED",
        message: `Pipeline detenido: capítulo ${n} tiene bloqueo editorial.`,
        score: result.quality.global_score,
      });
      break;
    }
  }

  return current;
}

export async function runOs4MasterAudit(
  project: Project,
  onEvent?: (event: Os4PipelineEvent) => void
) {
  emit(project.id, onEvent, {
    stage: "MASTER_EDIT",
    status: "RUNNING",
    message: "Master Editor auditando la obra completa.",
  });

  const profile = await getOs4Profile(project.id);
  const output: any = await trackedAgent({
    projectId: project.id,
    agent: "MASTER_EDITOR",
    action: "AUDIT_MASTER",
    payload: {
      title: project.title,
      blueprint: profile?.blueprint,
      master_text: ensureString(
        (project.master_document as any)?.text,
        ""
      ).slice(0, 90000),
      quality_history_note:
        "Evalúa estructura global, continuidad, repetición, factualidad y readiness editorial.",
    },
    inputSummary: `Master audit: ${project.title}`,
  });

  await patchOs4Profile(project.id, {
    master_audit: output,
    current_stage: "MASTER_EDIT",
    status:
      output?.publish_readiness === "READY"
        ? "COMPLETED"
        : "WAITING_APPROVAL",
    overall_score: clampScore(output?.global_score),
  });

  emit(project.id, onEvent, {
    stage: "MASTER_EDIT",
    status:
      output?.publish_readiness === "READY"
        ? "COMPLETED"
        : "WAITING_APPROVAL",
    message: `Master Audit: ${clampScore(output?.global_score)}/10`,
    score: clampScore(output?.global_score),
  });

  return output;
}


export async function runOs4PublishingPlan(
  project: Project,
  onEvent?: (event: Os4PipelineEvent) => void
) {
  emit(project.id, onEvent, {
    stage: "PUBLISHING",
    status: "RUNNING",
    message: "Publishing Director construyendo especificación editorial final.",
  });

  const profile = await getOs4Profile(project.id);
  const masterText = ensureString((project.master_document as any)?.text, "");

  const output: any = await trackedAgent({
    projectId: project.id,
    agent: "PUBLISHING_DIRECTOR",
    action: "BUILD_PUBLISHING_PACKAGE",
    payload: {
      title: project.title,
      blueprint: profile?.blueprint,
      master_audit: profile?.master_audit,
      master_excerpt: masterText.slice(0, 70000),
      requested_formats: ["DOCX", "PDF", "EPUB"],
      instruction:
        "Genera especificación operativa, metadata, front matter, formato, checklist y bloqueos. No afirmes que un binario fue generado si no lo fue.",
    },
    inputSummary: "Publishing Director: " + project.title,
  });

  const score = clampScore(output?.score ?? output?.global_score);

  await patchOs4Profile(project.id, {
    publishing_plan: output,
    current_stage: "PUBLISHING",
    status: Array.isArray(output?.blocking_issues) && output.blocking_issues.length
      ? "WAITING_APPROVAL"
      : "COMPLETED",
    overall_score: score || profile?.overall_score || 0,
  } as any);

  emit(project.id, onEvent, {
    stage: "PUBLISHING",
    status: Array.isArray(output?.blocking_issues) && output.blocking_issues.length
      ? "WAITING_APPROVAL"
      : "COMPLETED",
    message: "Publishing Director: " + score + "/10",
    score,
  });

  return output;
}

export async function runOs4LaunchPlan(
  project: Project,
  onEvent?: (event: Os4PipelineEvent) => void
): Promise<Os4LaunchPlan> {
  emit(project.id, onEvent, {
    stage: "LAUNCH",
    status: "RUNNING",
    message: "Construyendo paquete completo de lanzamiento comercial.",
  });

  const profile = await getOs4Profile(project.id);
  const launch = await trackedAgent<Os4LaunchPlan>({
    projectId: project.id,
    agent: "LAUNCH_STRATEGIST",
    action: "BUILD_LAUNCH_SYSTEM",
    payload: {
      title: project.title,
      market: profile?.market,
      blueprint: profile?.blueprint,
      master_excerpt: ensureString(
        (project.master_document as any)?.text,
        ""
      ).slice(0, 32000),
    },
    inputSummary: `Launch: ${project.title}`,
  });

  await patchOs4Profile(project.id, {
    launch_plan: launch,
    current_stage: "LAUNCH",
    status: "COMPLETED",
  });

  emit(project.id, onEvent, {
    stage: "LAUNCH",
    status: "COMPLETED",
    message: "Launch System terminado.",
  });

  return launch;
}
