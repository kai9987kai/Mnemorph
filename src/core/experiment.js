import { DEFAULT_RUN_CONFIG, validateRunConfig } from "./config.js";
import { selectAssays, enumerateCandidates, reviseGrammar } from "./compiler.js";
import {
  createHypothesisBank,
  createPredictionRecord,
  multiclassBrier,
  predictOutcomeDistribution,
  updateHypotheses,
  OUTCOME_CATEGORIES,
} from "./hypotheses.js";
import { runAssayProgram } from "./assay.js";
import { canonicalJson, forkSubject, sha256Hex, snapshotSubject } from "./snapshot.js";
import { createBenchmarkCase, trainSubject } from "./subject.js";
import { randomForEvent } from "./random.js";
import { validateAssayProgram } from "./interventions.js";

const MECHANISM_IDS = Object.freeze([
  "local-trace", "distributed-trace", "regenerative-reconstruction", "readout-adaptation", "context-gated",
]);
const FAMILY_IDS = new Set([...MECHANISM_IDS, "open-substrate"]);
const METHOD_KINDS = new Set([
  "fixed-one-factor", "fixed-factorial", "random-equal-budget", "frozen-grammar-information-gain",
  "adaptive-revisable-grammar", "oracle-only-diagnostic",
]);
const FORBIDDEN_KEYS = new Set([
  "auditor", "auditoronly", "auditorrecord", "groundtruth", "hiddenlabel", "hiddenmechanism",
  "mechanism", "mechanismfamily", "mechanismid", "mechanismtruth", "recipe", "truefamily",
  "truemechanism", "truth",
]);
const MAX_BATCH_SUBJECT_CELLS = 1_048_576;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertPublicJson(value, path = "$", seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${path} is not JSON-compatible`);
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle`);
  if (!Array.isArray(value) && !isRecord(value)) throw new TypeError(`${path} must be plain JSON data`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((entry, index) => assertPublicJson(entry, `${path}[${index}]`, seen));
  else {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
        throw new TypeError(`${path}.${key} contains hidden/auditor-only data`);
      }
      assertPublicJson(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function copy(value) {
  return structuredClone(value);
}

function initialGrammar(config) {
  return {
    schemaVersion: 1,
    grammarId: "mnemorph-baseline",
    version: 0,
    operationTemplates: [
      { type: "lesion", armId: "treatment", region: "body", fraction: 0.25, atTick: 0 },
      { type: "lesion", armId: "treatment", region: "head", fraction: 0.25, atTick: 0 },
      { type: "scramble", armId: "treatment", region: "body", channel: "trace", intensity: 0.5, atTick: 0 },
      { type: "context-shift", armId: "treatment", cueToAction: [...config.cueToAction].reverse(), atTick: 0 },
      { type: "delay", ticks: 2, atTick: 0 },
      { type: "regrow", armId: "treatment", ticks: 2, atTick: 0 },
    ],
    protocolTemplates: [],
  };
}

export function buildBaselineMethods(config = DEFAULT_RUN_CONFIG) {
  const configResult = validateRunConfig(config);
  if (!configResult.ok) throw new TypeError("invalid baseline run config");
  const runConfig = configResult.value;
  const grammar = initialGrammar(runConfig);
  const fixedPrograms = [
    { programId: "fixed-lesion-body", operations: [{ ...grammar.operationTemplates[0] }] },
    { programId: "fixed-lesion-head", operations: [{ ...grammar.operationTemplates[1] }] },
    { programId: "fixed-scramble-body", operations: [{ ...grammar.operationTemplates[2] }] },
    { programId: "fixed-context-transfer", operations: [{ ...grammar.operationTemplates[3] }] },
  ];
  const factorialPrograms = [
    {
      programId: "factorial-lesion-regrow",
      operations: [
        { ...grammar.operationTemplates[0] },
        { type: "regrow", armId: "treatment", ticks: 2, atTick: 0 },
      ],
    },
    {
      programId: "factorial-lesion-transfer",
      operations: [
        { ...grammar.operationTemplates[1] },
        { ...grammar.operationTemplates[3] },
      ],
    },
    {
      programId: "factorial-scramble-delay",
      operations: [
        { ...grammar.operationTemplates[2] },
        { type: "delay", ticks: 2, atTick: 0 },
      ],
    },
  ];
  return [
    { id: "fixed-one-factor", kind: "fixed-one-factor", programs: fixedPrograms },
    { id: "fixed-factorial", kind: "fixed-factorial", programs: factorialPrograms, grammar: copy(grammar) },
    { id: "random-equal-budget", kind: "random-equal-budget", grammar: copy(grammar) },
    { id: "frozen-grammar-information-gain", kind: "frozen-grammar-information-gain", grammar: copy(grammar) },
    { id: "adaptive-revisable-grammar", kind: "adaptive-revisable-grammar", grammar: copy(grammar) },
    { id: "oracle-only-diagnostic", kind: "oracle-only-diagnostic", grammar: copy(grammar) },
  ];
}

function validateSeeds(masterSeeds, maxCount) {
  if (!Array.isArray(masterSeeds) || masterSeeds.length < 1 || masterSeeds.length > maxCount
    || !masterSeeds.every((seed) => Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffff_ffff)
    || new Set(masterSeeds).size !== masterSeeds.length) {
    throw new TypeError("masterSeeds must be unique unsigned 32-bit seeds within seedBlockCount");
  }
}

function validateFamilies(familyIds) {
  if (!Array.isArray(familyIds) || familyIds.length < 1
    || !familyIds.every((familyId) => FAMILY_IDS.has(familyId))
    || new Set(familyIds).size !== familyIds.length) {
    throw new TypeError("familyIds must be unique supported synthetic benchmark families");
  }
}

function validateMethods(methods) {
  if (!Array.isArray(methods) || methods.length < 1) throw new TypeError("methods must be a nonempty array");
  const ids = new Set();
  for (const [index, method] of methods.entries()) {
    assertPublicJson(method, `methods[${index}]`);
    const allowedKeys = new Set(["id", "kind", "programs", "grammar"]);
    if (!isRecord(method) || typeof method.id !== "string" || method.id.trim().length === 0
      || !METHOD_KINDS.has(method.kind) || ids.has(method.id)) {
      throw new TypeError(`invalid or duplicate method at index ${index}`);
    }
    if (Object.keys(method).some((key) => !allowedKeys.has(key))) throw new TypeError(`unknown method field in ${method.id}`);
    ids.add(method.id);
  }
}

function validateWithheld(withheldPrograms, config) {
  if (!Array.isArray(withheldPrograms) || withheldPrograms.length > 64) {
    throw new TypeError("withheldPrograms must be an array of at most 64 protocols");
  }
  for (const program of withheldPrograms) {
    assertPublicJson(program, "withheldProgram");
    const validation = validateAssayProgram(program, config);
    if (!validation.ok) throw new TypeError(`invalid withheld program: ${validation.errors.map((entry) => entry.code).join(",")}`);
  }
}

function makeArms(subject) {
  return {
    treatment: { armId: "treatment", subject: forkSubject(subject), activeSilences: [] },
    control: { armId: "control", subject: forkSubject(subject), activeSilences: [] },
  };
}

function ensemblePrediction(bank, record) {
  const combined = Object.fromEntries(OUTCOME_CATEGORIES.map((category) => [category, 0]));
  for (const hypothesis of bank.hypotheses) {
    for (const category of OUTCOME_CATEGORIES) {
      combined[category] += hypothesis.posterior * record.predictions[hypothesis.id][category];
    }
  }
  return combined;
}

function selectProgram(method, { bank, history, config, budget, seed, blockIndex }) {
  const candidateLimitConfig = { ...config, candidateEvaluationsPerBatch: budget.candidateEvaluations };
  if (method.kind === "fixed-one-factor") {
    const programs = method.programs ?? [];
    if (programs.length === 0) return { program: { programId: "missing-fixed-program", operations: [] }, evaluations: 0 };
    return { program: copy(programs[blockIndex % programs.length]), evaluations: 0 };
  }
  if (method.kind === "fixed-factorial" && Array.isArray(method.programs) && method.programs.length > 0) {
    return { program: copy(method.programs[blockIndex % method.programs.length]), evaluations: 0 };
  }
  const grammar = method.grammar ?? initialGrammar(config);
  if (method.kind === "fixed-factorial") {
    const candidates = enumerateCandidates(grammar, candidateLimitConfig);
    const program = candidates[blockIndex % candidates.length] ?? { programId: "empty", operations: [] };
    return { program: copy(program), evaluations: candidates.length };
  }
  if (method.kind === "random-equal-budget") {
    const candidates = enumerateCandidates(grammar, candidateLimitConfig);
    const draw = randomForEvent(seed, ["random-selection-v1", method.id, blockIndex]);
    const index = Math.floor(draw * candidates.length);
    return { program: copy(candidates[index] ?? { programId: "empty", operations: [] }), evaluations: candidates.length };
  }
  if (method.kind === "frozen-grammar-information-gain" || method.kind === "adaptive-revisable-grammar") {
    const selection = selectAssays({
      grammar,
      bank,
      history,
      budget: {
        assayCount: budget.assayCount,
        candidateEvaluations: budget.candidateEvaluations,
        config: candidateLimitConfig,
      },
    });
    return {
      program: copy(selection[0]?.program ?? { programId: "empty", operations: [] }),
      evaluations: selection[0]?.candidateEvaluationCount ?? 0,
    };
  }
  if (method.kind === "oracle-only-diagnostic") return { program: null, evaluations: budget.candidateEvaluations };
  throw new TypeError(`unsupported method kind ${method.kind}`);
}

function oraclePreference(program, familyId) {
  let score = 0;
  for (const operation of program.operations) {
    if (familyId === "local-trace") {
      if (operation.type === "lesion" && operation.region === "head") score += 4;
      if (operation.type === "scramble" && operation.region === "head" && operation.channel === "trace") score += 3;
    } else if (familyId === "distributed-trace") {
      if (operation.type === "lesion" && operation.region === "body") score += 3;
      if (operation.type === "scramble" && operation.region === "body" && operation.channel === "trace") score += 3;
      if (operation.type === "transplant") score += 1;
    } else if (familyId === "regenerative-reconstruction") {
      if (operation.type === "lesion") score += 2;
      if (operation.type === "regrow") score += 4;
      if (operation.type === "delay") score += 1;
    } else if (familyId === "readout-adaptation") {
      if (operation.type === "context-shift") score += 5;
    } else if (familyId === "context-gated") {
      if (operation.type === "context-shift") score += 3;
      if (operation.type === "lesion" || operation.type === "scramble") score += 2;
    }
  }
  return score;
}

function selectOracleProgram(method, config, familyId, seed, blockIndex) {
  const grammar = method.grammar ?? initialGrammar(config);
  const candidates = enumerateCandidates(grammar, config);
  const program = [...candidates].sort((a, b) => oraclePreference(b, familyId) - oraclePreference(a, familyId)
    || randomForEvent(seed, ["oracle-tie-v1", blockIndex, a.programId])
      - randomForEvent(seed, ["oracle-tie-v1", blockIndex, b.programId]))[0]
    ?? { programId: "oracle-empty", operations: [] };
  return { program, candidateEvaluationsUsed: candidates.length };
}

async function createCase(seed, familyId, config) {
  // Keep the frozen developmental rule opaque and identical across matched families.
  const ruleId = "development-rule-v1";
  const initial = createBenchmarkCase({ seed, config, mechanismId: familyId, ruleId });
  const trained = trainSubject(initial.subject, { episodes: config.trainingEpisodes });
  const snapshot = snapshotSubject(trained.subject);
  const snapshotHash = await sha256Hex(snapshot);
  return {
    subject: trained.subject,
    training: trained.summary,
    snapshot,
    snapshotHash,
    auditorRecord: initial.auditorRecord,
  };
}

function methodRowResult({ method, seed, blockIndex, lineageId, initialSnapshotHash, program, predictionRecord,
  withheldPredictions, assayResult, budget, compilerHistory, training }) {
  return {
    methodId: method.id,
    masterSeed: seed,
    seedBlockIndex: blockIndex,
    lineageId,
    initialSnapshotHash,
    budget,
    compilerHistory,
    selectedProgram: program,
    selectedPrediction: predictionRecord,
    withheldPredictions,
    status: training.memoryEligible ? assayResult.status : "ineligible",
    eligibleForMemoryEvaluation: training.memoryEligible,
    assay: training.memoryEligible ? {
      status: assayResult.status,
      observations: assayResult.observations,
      rawRows: assayResult.rawRows,
      operationReceipts: assayResult.operationReceipts,
      errors: assayResult.errors,
    } : null,
  };
}

function countSummary(rows, denominator) {
  return {
    denominator,
    eligibleDenominator: rows.filter((row) => row.eligibleForMemoryEvaluation).length,
    completed: rows.filter((row) => row.status === "completed").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
    ineligible: rows.filter((row) => row.status === "ineligible").length,
  };
}

function observedCategory(assay) {
  return assay?.observations?.treatment?.afterRegrowth?.category ?? null;
}

export async function runMatchedBatch({
  config,
  methods,
  masterSeeds,
  familyIds,
  withheldPrograms = [],
  initialMethodStates = {},
}) {
  const configResult = validateRunConfig(config);
  if (!configResult.ok) throw new TypeError(`invalid run config: ${configResult.errors.map((entry) => entry.path).join(",")}`);
  const runConfig = configResult.value;
  validateSeeds(masterSeeds, runConfig.seedBlockCount);
  validateFamilies(familyIds);
  const cellsPerGroup = runConfig.gridWidth * runConfig.gridHeight * 2;
  if (cellsPerGroup * masterSeeds.length * familyIds.length > MAX_BATCH_SUBJECT_CELLS) {
    throw new RangeError("matched batch exceeds the aggregate subject-cell cap");
  }
  validateWithheld(withheldPrograms, runConfig);
  const activeMethods = methods ?? buildBaselineMethods(runConfig);
  validateMethods(activeMethods);
  if (!isRecord(initialMethodStates)) throw new TypeError("initialMethodStates must be a plain object");
  assertPublicJson(initialMethodStates, "initialMethodStates");
  const activeMethodIds = new Set(activeMethods.map((method) => method.id));
  for (const [methodId, state] of Object.entries(initialMethodStates)) {
    if (!activeMethodIds.has(methodId) || !isRecord(state)
      || (state.history !== undefined && !Array.isArray(state.history))) {
      throw new TypeError(`invalid prior state for method ${methodId}`);
    }
  }

  const budget = Object.freeze({
    assayCount: 1,
    candidateEvaluations: runConfig.candidateEvaluationsPerBatch,
    protocolLengthCap: runConfig.protocolLengthCap,
  });
  const denominator = masterSeeds.length * familyIds.length;
  const publicRows = [];
  const auditorRows = [];
  const methodSummaries = {};
  const methodStates = {};
  const oracleMethods = activeMethods.filter((method) => method.kind === "oracle-only-diagnostic");
  const compilerMethods = activeMethods.filter((method) => method.kind !== "oracle-only-diagnostic");
  const groupCases = [];
  let blockIndex = 0;

  for (const seed of masterSeeds) {
    for (const familyId of familyIds) {
      const experimentCase = await createCase(seed, familyId, runConfig);
      const lineageId = `lineage-${seed}`;
      groupCases.push({ seed, familyId, blockIndex, lineageId, ...experimentCase });
      blockIndex += 1;
    }
  }

  for (const method of compilerMethods) {
    const priorState = initialMethodStates[method.id];
    const baseBank = priorState?.bank ? copy(priorState.bank) : createHypothesisBank();
    const methodHistory = priorState?.history ? copy(priorState.history) : [];
    const startingGrammar = priorState?.grammar
      ? copy(priorState.grammar)
      : method.grammar ? copy(method.grammar) : initialGrammar(runConfig);
    const activeMethod = { ...method, grammar: startingGrammar };
    const methodRows = [];
    const internalBatchResults = [];
    for (const group of groupCases) {
      const methodSelection = selectProgram(activeMethod, {
        bank: baseBank,
        history: methodHistory,
        config: runConfig,
        budget,
        seed: group.seed,
        blockIndex: group.blockIndex,
      });
      const program = methodSelection.program;
      let predictionRecord = null;
      let ensemble = null;
      const programValidation = program ? validateAssayProgram(program, runConfig) : { ok: false };
      if (programValidation.ok) {
        predictionRecord = createPredictionRecord({ bank: baseBank, program, visibleHistory: methodHistory });
        ensemble = ensemblePrediction(baseBank, predictionRecord);
      }
      const withheldPredictionRows = withheldPrograms.map((withheldProgram) => {
        const record = createPredictionRecord({ bank: baseBank, program: withheldProgram, visibleHistory: methodHistory });
        return {
          programId: withheldProgram.programId,
          predictionRecord: record,
          ensemblePrediction: ensemblePrediction(baseBank, record),
        };
      });
      let assayResult = { status: "ineligible", observations: {}, rawRows: [], operationReceipts: [], errors: [] };
      if (group.training.memoryEligible) {
        assayResult = runAssayProgram({
          arms: makeArms(group.subject),
          program,
          config: runConfig,
          eventContext: {
            masterSeed: group.seed,
            eventKey: [group.lineageId, 0, "shared-assay-events"],
          },
        });
      }
      const row = methodRowResult({
        method,
        seed: group.seed,
        blockIndex: group.blockIndex,
        lineageId: group.lineageId,
        initialSnapshotHash: group.snapshotHash,
        program,
        predictionRecord,
        withheldPredictions: withheldPredictionRows.map((entry) => ({
          programId: entry.programId,
          predictionRecord: entry.predictionRecord,
          ensemblePrediction: entry.ensemblePrediction,
        })),
        assayResult,
        budget: { ...budget, candidateEvaluationsUsed: methodSelection.evaluations },
        compilerHistory: copy(methodHistory),
        training: group.training,
      });
      methodRows.push(row);

      const withheldEvaluations = [];
      if (group.training.memoryEligible) {
        for (const withheldProgram of withheldPrograms) {
          const withheldResult = runAssayProgram({
            arms: makeArms(group.subject),
            program: withheldProgram,
            config: runConfig,
            eventContext: {
              masterSeed: group.seed,
              eventKey: [group.lineageId, 0, "withheld-assay", withheldProgram.programId],
            },
          });
          const outcome = observedCategory(withheldResult);
          const prediction = withheldPredictionRows.find((entry) => entry.programId === withheldProgram.programId)?.ensemblePrediction;
          withheldEvaluations.push({
            programId: withheldProgram.programId,
            status: withheldResult.status,
            observedCategory: outcome,
            brierScore: outcome ? multiclassBrier(prediction, outcome) : null,
            predictionWasFrozen: true,
          });
        }
      }
      auditorRows.push({
        methodId: method.id,
        masterSeed: group.seed,
        seedBlockIndex: group.blockIndex,
        lineageId: group.lineageId,
        mechanismId: group.auditorRecord.mechanismId,
        auditorRecord: group.auditorRecord,
        selectedCategory: observedCategory(assayResult),
        withheldEvaluations,
      });
      internalBatchResults.push({ row, program, predictionRecord, ensemble, outcome: observedCategory(assayResult) });
    }
    publicRows.push(...methodRows);

    let nextBank = copy(baseBank);
    const protocolResults = [];
    for (const result of internalBatchResults) {
      if (!result.predictionRecord || !result.outcome) continue;
      nextBank = updateHypotheses(nextBank, result.predictionRecord, result.outcome);
      if (result.program) {
        const postRecord = createPredictionRecord({ bank: nextBank, program: result.program, visibleHistory: methodHistory });
        protocolResults.push({
          program: result.program,
          preAssayPrediction: result.ensemble,
          postAssayPrediction: ensemblePrediction(nextBank, postRecord),
          observedCategory: result.outcome,
        });
      }
    }
    let nextGrammar = copy(startingGrammar);
    if (method.kind === "adaptive-revisable-grammar") {
      nextGrammar = reviseGrammar(nextGrammar, { status: "completed", protocolResults });
    }
    const nextHistory = [...methodHistory, ...protocolResults.map((result) => ({
      batchIndex: priorState?.batchCount ?? 0,
      stage: "transfer",
      program: copy(result.program),
      preAssayPrediction: copy(result.preAssayPrediction),
      postAssayPrediction: copy(result.postAssayPrediction),
      observedCategory: result.observedCategory,
    }))].slice(-256);
    methodStates[method.id] = {
      bank: nextBank,
      grammar: nextGrammar,
      history: nextHistory,
      batchCount: (priorState?.batchCount ?? 0) + 1,
      updatedAtBatchBoundary: true,
      sourceBatchStatus: "completed",
    };
    methodSummaries[method.id] = countSummary(methodRows, denominator);
  }

  for (const method of oracleMethods) {
    const oracleRows = [];
    for (const group of groupCases) {
      const oracleSelection = selectOracleProgram(method, runConfig, group.auditorRecord.mechanismId, group.seed, group.blockIndex);
      const program = oracleSelection.program;
      const assayResult = group.training.memoryEligible
        ? runAssayProgram({
          arms: makeArms(group.subject),
          program,
          config: runConfig,
          eventContext: { masterSeed: group.seed, eventKey: [group.lineageId, 0, "oracle-diagnostic"] },
        })
        : { status: "ineligible", observations: {}, rawRows: [], operationReceipts: [], errors: [] };
      const row = {
        methodId: method.id,
        masterSeed: group.seed,
        seedBlockIndex: group.blockIndex,
        lineageId: group.lineageId,
        initialSnapshotHash: group.snapshotHash,
        budget: { ...budget, candidateEvaluationsUsed: oracleSelection.candidateEvaluationsUsed },
        selectedProgram: program,
        status: group.training.memoryEligible ? assayResult.status : "ineligible",
        selectedCategory: observedCategory(assayResult),
      };
      oracleRows.push(row);
      auditorRows.push({
        ...row,
        mechanismId: group.auditorRecord.mechanismId,
        auditorRecord: group.auditorRecord,
        oracleDiagnostic: true,
      });
    }
    methodSummaries[method.id] = countSummary(oracleRows.map((row) => ({
      status: row.status,
      eligibleForMemoryEvaluation: row.status !== "ineligible",
    })), denominator);
    methodStates[method.id] = { oracleDiagnosticOnly: true, updatedAtBatchBoundary: false };
  }

  const experimentIdentity = {
    schemaVersion: 1,
    config: runConfig,
    methods: activeMethods,
    masterSeeds,
    initialMethodStateHash: await sha256Hex(canonicalJson(initialMethodStates)),
    familySetHash: await sha256Hex(canonicalJson(familyIds)),
    withheldPrograms,
  };
  const experimentId = `mnemorph-${await sha256Hex(canonicalJson(experimentIdentity))}`;
  return {
    schemaVersion: 1,
    experimentId,
    status: "completed",
    config: runConfig,
    methods: activeMethods.map((method) => method.id),
    masterSeeds: [...masterSeeds],
    initialSnapshots: groupCases.map((group) => ({
      masterSeed: group.seed,
      seedBlockIndex: group.blockIndex,
      lineageId: group.lineageId,
      snapshotHash: group.snapshotHash,
      snapshot: group.snapshot,
    })),
    familyCount: familyIds.length,
    denominator,
    eligibleDenominator: groupCases.filter((group) => group.training.memoryEligible).length,
    publicRows,
    auditorRows,
    methodSummaries,
    methodStates,
  };
}
