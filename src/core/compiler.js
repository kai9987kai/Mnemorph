import { DEFAULT_RUN_CONFIG, validateRunConfig } from "./config.js";
import { createPredictionRecord, multiclassBrier, OUTCOME_CATEGORIES } from "./hypotheses.js";
import { validateAssayProgram } from "./interventions.js";
import { canonicalJson } from "./snapshot.js";

const MAX_CANDIDATE_EVALUATIONS = 256;
const MAX_OPERATION_TEMPLATES = 64;
const MAX_PROTOCOL_TEMPLATES = 64;
const ALLOWED_GRAMMAR_KEYS = new Set([
  "schemaVersion", "grammarId", "version", "operationTemplates", "protocolTemplates",
]);
const FORBIDDEN_KEYS = new Set([
  "auditor", "auditoronly", "auditorrecord", "groundtruth", "hiddenlabel", "hiddenmechanism",
  "mechanism", "mechanismfamily", "mechanismid", "mechanismtruth", "recipe", "truefamily",
  "truemechanism", "truth",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
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
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPublicJson(entry, `${path}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(normalizeKey(key))) throw new TypeError(`${path}.${key} is auditor-only or hidden truth`);
      assertPublicJson(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function validateGrammar(grammar, config) {
  assertPublicJson(grammar, "grammar");
  if (!isRecord(grammar)) throw new TypeError("grammar must be a plain object");
  for (const key of Object.keys(grammar)) {
    if (!ALLOWED_GRAMMAR_KEYS.has(key)) throw new TypeError(`unknown grammar field: ${key}`);
  }
  if (grammar.schemaVersion !== 1 || typeof grammar.grammarId !== "string"
    || grammar.grammarId.trim().length === 0 || grammar.grammarId.length > 100
    || !Number.isSafeInteger(grammar.version) || grammar.version < 0) {
    throw new TypeError("invalid grammar header");
  }
  if (!Array.isArray(grammar.operationTemplates) || grammar.operationTemplates.length > MAX_OPERATION_TEMPLATES) {
    throw new TypeError("grammar operation template cap exceeded");
  }
  if (grammar.protocolTemplates !== undefined
    && (!Array.isArray(grammar.protocolTemplates) || grammar.protocolTemplates.length > MAX_PROTOCOL_TEMPLATES)) {
    throw new TypeError("grammar protocol template cap exceeded");
  }
  const normalizedConfig = validateRunConfig(config);
  if (!normalizedConfig.ok) throw new TypeError("invalid compiler run config");
  grammar.operationTemplates.forEach((operation, index) => {
    const validation = validateAssayProgram({ programId: `op-template-${index}`, operations: [operation] }, normalizedConfig.value);
    if (!validation.ok) throw new TypeError(`invalid operation template ${index}: ${validation.errors.map((entry) => entry.code).join(",")}`);
  });
  for (const [index, program] of (grammar.protocolTemplates ?? []).entries()) {
    const validation = validateAssayProgram(program, normalizedConfig.value);
    if (!validation.ok) throw new TypeError(`invalid protocol template ${index}: ${validation.errors.map((entry) => entry.code).join(",")}`);
  }
  return normalizedConfig.value;
}

function fnvId(value) {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `candidate-${hash.toString(16).padStart(16, "0")}`;
}

function programFromOperations(operations) {
  const copied = structuredClone(operations);
  const identity = canonicalJson(copied);
  return { programId: fnvId(identity), operations: copied };
}

function estimateExpectedTicks(program) {
  if (!Array.isArray(program?.operations)) return 0;
  let ticks = 0;
  for (const operation of program.operations) {
    if (operation.type === "delay" || operation.type === "regrow") ticks += operation.ticks ?? 0;
    else if (operation.type === "sham") ticks += operation.durationTicks ?? 0;
    ticks = Math.min(ticks, 10_000);
  }
  return ticks;
}

function entropy(probabilities) {
  return probabilities.reduce((sum, probability) => probability > 0
    ? sum - probability * Math.log2(probability)
    : sum, 0);
}

function informationGain(bank, record) {
  const hypotheses = bank.hypotheses;
  const priors = hypotheses.map((hypothesis) => hypothesis.posterior);
  const priorEntropy = entropy(priors);
  let expectedPosteriorEntropy = 0;
  for (const category of OUTCOME_CATEGORIES) {
    const outcomeProbability = hypotheses.reduce((sum, hypothesis) => (
      sum + hypothesis.posterior * record.predictions[hypothesis.id][category]
    ), 0);
    if (outcomeProbability <= 0) continue;
    const conditional = hypotheses.map((hypothesis) => (
      hypothesis.posterior * record.predictions[hypothesis.id][category] / outcomeProbability
    ));
    expectedPosteriorEntropy += outcomeProbability * entropy(conditional);
  }
  return Math.max(0, priorEntropy - expectedPosteriorEntropy);
}

function probability(value, fallback, path) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== "number" || !Number.isFinite(result) || result < 0 || result > 1) {
    throw new TypeError(`${path} must be a probability in [0, 1]`);
  }
  return result;
}

export function enumerateCandidates(grammar, config = DEFAULT_RUN_CONFIG) {
  const runConfig = validateGrammar(grammar, config);
  const candidateCap = Math.min(MAX_CANDIDATE_EVALUATIONS, runConfig.candidateEvaluationsPerBatch);
  const operationTemplates = [...new Map(grammar.operationTemplates.map((operation) => [
    canonicalJson(operation), operation,
  ])).values()].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const candidates = [];
  const seen = new Set();
  const addCandidate = (program) => {
    const identity = canonicalJson(program);
    if (seen.has(identity)) return;
    if (estimateExpectedTicks(program) > runConfig.maxTicks) return;
    const validation = validateAssayProgram(program, runConfig);
    if (!validation.ok) return;
    seen.add(identity);
    candidates.push(program);
  };

  for (const program of [...(grammar.protocolTemplates ?? [])].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)))) {
    if (candidates.length >= candidateCap) break;
    addCandidate(program);
  }
  if (candidates.length < candidateCap) addCandidate(programFromOperations([]));

  let frontier = [[]];
  for (let depth = 1; depth <= runConfig.protocolLengthCap && candidates.length < candidateCap; depth += 1) {
    const expanded = [];
    for (const prefix of frontier) {
      for (const operation of operationTemplates) {
        if (candidates.length >= candidateCap) break;
        const sequence = [...prefix, operation];
        const program = programFromOperations(sequence);
        if (!seen.has(canonicalJson(program))) addCandidate(program);
        expanded.push(sequence);
      }
      if (candidates.length >= candidateCap) break;
    }
    frontier = expanded;
    if (frontier.length === 0) break;
  }
  return candidates.slice(0, candidateCap);
}

export function scoreCandidate(program, bank, costConfig = {}) {
  if (!isRecord(costConfig)) throw new TypeError("costConfig must be an object");
  assertPublicJson(costConfig, "costConfig");
  assertPublicJson(program, "program");
  const allowedCostKeys = new Set([
    "runConfig", "visibleHistory", "invalidProbability", "allArmsLostProbability", "expectedTicks",
  ]);
  if (Object.keys(costConfig).some((key) => !allowedCostKeys.has(key))) throw new TypeError("unknown candidate cost field");
  const runConfigResult = validateRunConfig(costConfig.runConfig ?? DEFAULT_RUN_CONFIG);
  if (!runConfigResult.ok) throw new TypeError("invalid candidate scoring run config");
  const validation = validateAssayProgram(program, runConfigResult.value);
  const valid = validation.ok;
  const invalidProbability = probability(costConfig.invalidProbability, valid ? 0 : 1, "invalidProbability");
  const allArmsLostProbability = probability(costConfig.allArmsLostProbability, 0, "allArmsLostProbability");
  const expectedTicks = costConfig.expectedTicks ?? estimateExpectedTicks(program);
  if (!Number.isFinite(expectedTicks) || expectedTicks < 0 || expectedTicks > runConfigResult.value.maxTicks) {
    throw new TypeError("expectedTicks must be finite and within the run tick cap");
  }
  const operationCount = Array.isArray(program?.operations) ? program.operations.length : 0;
  let informationGainBits = 0;
  if (valid) {
    const predictionRecord = createPredictionRecord({
      bank,
      program,
      visibleHistory: costConfig.visibleHistory ?? {},
    });
    informationGainBits = informationGain(bank, predictionRecord);
  }
  const denominator = 1 + operationCount / 4 + expectedTicks / 10_000;
  const invalidPenalty = 0.5 * invalidProbability;
  const allArmsLostPenalty = 0.5 * allArmsLostProbability;
  return {
    score: informationGainBits / denominator - invalidPenalty - allArmsLostPenalty,
    informationGain: informationGainBits,
    penalties: {
      invalidProbability,
      invalid: invalidPenalty,
      allArmsLostProbability,
      allArmsLost: allArmsLostPenalty,
      total: invalidPenalty + allArmsLostPenalty,
    },
    cost: { operationCount, expectedTicks, denominator },
    valid,
  };
}

function selectionBudget(budget, config) {
  if (!isRecord(budget)) throw new TypeError("selection budget must be an object");
  const evaluationRequest = budget.candidateEvaluations ?? config.candidateEvaluationsPerBatch;
  const assayCount = budget.assayCount ?? 1;
  if (!Number.isSafeInteger(evaluationRequest) || evaluationRequest < 1
    || !Number.isSafeInteger(assayCount) || assayCount < 1) {
    throw new TypeError("selection counts must be positive integers");
  }
  return {
    candidateEvaluations: Math.min(evaluationRequest, config.candidateEvaluationsPerBatch, MAX_CANDIDATE_EVALUATIONS),
    assayCount,
  };
}

export function selectAssays({ grammar, bank, history = {}, budget }) {
  const runConfig = validateGrammar(grammar, budget?.config ?? DEFAULT_RUN_CONFIG);
  assertPublicJson(history, "history");
  const limit = selectionBudget(budget, runConfig);
  const boundedConfig = { ...runConfig, candidateEvaluationsPerBatch: limit.candidateEvaluations };
  const candidates = enumerateCandidates(grammar, boundedConfig);
  const costConfig = isRecord(budget.costConfig) ? budget.costConfig : {};
  const ranked = candidates.map((program) => ({
    program,
    ...scoreCandidate(program, bank, {
      ...costConfig,
      runConfig: boundedConfig,
      visibleHistory: history,
    }),
  }));
  ranked.sort((left, right) => right.score - left.score
    || canonicalJson(left.program).localeCompare(canonicalJson(right.program)));
  return ranked.slice(0, Math.min(limit.assayCount, limit.candidateEvaluations)).map((entry, index) => ({
    rank: index + 1,
    grammarId: grammar.grammarId,
    grammarVersion: grammar.version,
    candidateEvaluationCount: candidates.length,
    ...entry,
  }));
}

function validImprovedProtocol(result) {
  if (!isRecord(result) || !isRecord(result.program)) return false;
  const validation = validateAssayProgram(result.program, DEFAULT_RUN_CONFIG);
  if (!validation.ok) return false;
  try {
    const before = multiclassBrier(result.preAssayPrediction, result.observedCategory);
    const after = multiclassBrier(result.postAssayPrediction, result.observedCategory);
    return before - after >= 0.01;
  } catch {
    return false;
  }
}

export function reviseGrammar(grammar, completedBatch) {
  validateGrammar(grammar, DEFAULT_RUN_CONFIG);
  assertPublicJson(completedBatch, "completedBatch");
  if (!isRecord(completedBatch) || completedBatch.status !== "completed") {
    throw new TypeError("grammar can only be revised from a completed batch");
  }
  if (!Array.isArray(completedBatch.protocolResults)) throw new TypeError("completed batch must include protocolResults");
  const existing = [...(grammar.protocolTemplates ?? [])];
  const identities = new Set(existing.map((program) => canonicalJson(program)));
  const improvements = completedBatch.protocolResults.filter(validImprovedProtocol)
    .sort((a, b) => canonicalJson(a.program).localeCompare(canonicalJson(b.program)));
  for (const result of improvements) {
    const identity = canonicalJson(result.program);
    if (identities.has(identity)) continue;
    identities.add(identity);
    existing.push(structuredClone(result.program));
    if (existing.length >= MAX_PROTOCOL_TEMPLATES) break;
  }
  const protocolTemplates = existing.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  return {
    schemaVersion: 1,
    grammarId: grammar.grammarId,
    version: grammar.version + 1,
    operationTemplates: structuredClone(grammar.operationTemplates),
    protocolTemplates,
  };
}

export const COMPILER_LIMITS = Object.freeze({
  maxCandidateEvaluations: MAX_CANDIDATE_EVALUATIONS,
  maxOperationTemplates: MAX_OPERATION_TEMPLATES,
  maxProtocolTemplates: MAX_PROTOCOL_TEMPLATES,
});
