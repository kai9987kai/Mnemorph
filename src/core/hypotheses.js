import { DEFAULT_RUN_CONFIG } from "./config.js";
import { validateAssayProgram } from "./interventions.js";

const CATEGORY_KEYS = Object.freeze(["retained", "partial", "lost"]);
const HYPOTHESIS_IDS = Object.freeze([
  "local-trace",
  "distributed-trace",
  "regenerative-reconstruction",
  "readout-adaptation",
  "context-gated",
]);
const LIKELIHOOD_FLOOR = 0.01;
const FORBIDDEN_KEYS = new Set([
  "auditor",
  "auditoronly",
  "auditorrecord",
  "groundtruth",
  "hiddenlabel",
  "hiddenmechanism",
  "mechanism",
  "mechanismfamily",
  "mechanismid",
  "mechanismtruth",
  "recipe",
  "truefamily",
  "truemechanism",
  "truth",
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
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(normalizeKey(key))) {
        throw new TypeError(`${path}.${key} is auditor-only or hidden truth`);
      }
      assertPublicJson(entry, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateDistribution(prediction, { allowZero = true } = {}) {
  if (!isRecord(prediction)) throw new TypeError("prediction must be a probability object");
  const keys = Object.keys(prediction).sort();
  if (keys.join("|") !== [...CATEGORY_KEYS].sort().join("|")) {
    throw new TypeError("prediction must define retained, partial, and lost probabilities");
  }
  const values = CATEGORY_KEYS.map((category) => prediction[category]);
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value)
    && value <= 1 && (allowZero ? value >= 0 : value > 0))) {
    throw new TypeError("prediction contains an invalid probability");
  }
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 1e-9) throw new TypeError("prediction probabilities must sum to 1");
  return Object.fromEntries(CATEGORY_KEYS.map((category) => [category, prediction[category]]));
}

function validateBank(bank) {
  assertPublicJson(bank, "bank");
  if (!isRecord(bank) || bank.schemaVersion !== 1 || !Array.isArray(bank.hypotheses)
    || bank.hypotheses.length !== HYPOTHESIS_IDS.length || !Number.isSafeInteger(bank.updates) || bank.updates < 0) {
    throw new TypeError("invalid hypothesis bank");
  }
  const seen = new Set();
  for (const hypothesis of bank.hypotheses) {
    if (!isRecord(hypothesis) || !HYPOTHESIS_IDS.includes(hypothesis.id) || seen.has(hypothesis.id)
      || typeof hypothesis.prior !== "number" || !Number.isFinite(hypothesis.prior) || hypothesis.prior <= 0
      || typeof hypothesis.posterior !== "number" || !Number.isFinite(hypothesis.posterior) || hypothesis.posterior <= 0) {
      throw new TypeError("invalid hypothesis weight");
    }
    seen.add(hypothesis.id);
  }
  if (HYPOTHESIS_IDS.some((id) => !seen.has(id))) throw new TypeError("hypothesis bank is missing a candidate");
  const sum = bank.hypotheses.reduce((total, hypothesis) => total + hypothesis.posterior, 0);
  if (Math.abs(sum - 1) > 1e-9) throw new TypeError("hypothesis posterior weights must sum to 1");
}

function validateHypothesis(hypothesis) {
  assertPublicJson(hypothesis, "hypothesis");
  if (!isRecord(hypothesis) || !HYPOTHESIS_IDS.includes(hypothesis.id)) {
    throw new TypeError("unknown hypothesis");
  }
}

function readFeatures(program, visibleHistory) {
  assertPublicJson(program, "program");
  assertPublicJson(visibleHistory, "visibleHistory");
  const validation = validateAssayProgram(program, DEFAULT_RUN_CONFIG);
  if (!validation.ok) throw new TypeError(`invalid public assay program: ${validation.errors.map((entry) => entry.code).join(",")}`);
  const operations = program.operations;
  const lesion = { head: 0, body: 0, tail: 0, "wound-border": 0 };
  const scramble = { head: 0, body: 0, tail: 0, "wound-border": 0 };
  let traceSilenced = false;
  let contextShift = false;
  let transplantCount = 0;
  let regrowthTicks = 0;
  for (const operation of operations) {
    if (operation.type === "lesion") lesion[operation.region] = Math.min(1, lesion[operation.region] + operation.fraction);
    if (operation.type === "scramble" && operation.channel === "trace") {
      scramble[operation.region] = Math.min(1, scramble[operation.region] + operation.intensity);
    }
    if (operation.type === "silence" && operation.channel === "trace") traceSilenced = true;
    if (operation.type === "context-shift") contextShift = true;
    if (operation.type === "transplant") transplantCount += 1;
    if (operation.type === "regrow") regrowthTicks = Math.min(10_000, regrowthTicks + operation.ticks);
  }
  const historyItems = Array.isArray(visibleHistory) ? visibleHistory : [visibleHistory];
  const transferStage = historyItems.some((item) => isRecord(item)
    && (item.stage === "transfer" || item.context === "transfer"));
  return {
    lesion,
    scramble,
    traceSilenced,
    contextShift,
    transplantCount,
    regrowthTicks,
    transferStage,
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function predictFeatures(hypothesisId, features) {
  const totalLesion = Object.values(features.lesion).reduce((sum, value) => sum + value, 0);
  const totalScramble = Object.values(features.scramble).reduce((sum, value) => sum + value, 0);
  let lossRisk;
  let partialRisk;

  switch (hypothesisId) {
    case "local-trace":
      lossRisk = 0.04 + features.lesion.head * 0.66 + features.scramble.head * 0.50
        + features.traceSilenced * 0.14 + features.lesion.body * 0.06 + features.transplantCount * 0.08;
      partialRisk = 0.10 + totalLesion * 0.13 + totalScramble * 0.10;
      if (features.regrowthTicks > 0) lossRisk *= 0.92;
      break;
    case "distributed-trace":
      lossRisk = 0.03 + features.lesion.body * 0.34 + features.scramble.body * 0.24
        + features.lesion.head * 0.08 + features.lesion.tail * 0.10 + features.traceSilenced * 0.10
        + features.transplantCount * 0.04;
      partialRisk = 0.10 + totalLesion * 0.24 + totalScramble * 0.20;
      if (features.regrowthTicks > 0) lossRisk *= 0.82;
      break;
    case "regenerative-reconstruction":
      lossRisk = 0.05 + totalLesion * (features.regrowthTicks > 0 ? 0.15 : 0.68)
        + totalScramble * 0.22 + features.traceSilenced * 0.08 + features.transplantCount * 0.07;
      partialRisk = 0.12 + totalLesion * (features.regrowthTicks > 0 ? 0.10 : 0.16);
      if (features.regrowthTicks > 0) lossRisk *= 0.80;
      break;
    case "readout-adaptation":
      lossRisk = 0.04 + totalLesion * 0.05 + totalScramble * 0.04 + features.traceSilenced * 0.03
        + features.contextShift * 0.68 + features.transferStage * 0.16;
      partialRisk = 0.11 + totalLesion * 0.04 + features.contextShift * 0.08;
      break;
    case "context-gated":
      lossRisk = 0.06 + totalLesion * 0.20 + totalScramble * 0.16 + features.traceSilenced * 0.08
        + features.contextShift * 0.38 + features.transferStage * 0.20 + features.transplantCount * 0.06;
      partialRisk = 0.15 + totalLesion * 0.15 + features.contextShift * 0.12;
      break;
    default:
      throw new TypeError("unknown hypothesis");
  }

  lossRisk = clamp(lossRisk, 0.02, 0.88);
  partialRisk = clamp(partialRisk, 0.04, 0.38);
  if (lossRisk + partialRisk > 0.95) partialRisk = 0.95 - lossRisk;
  const retained = 1 - lossRisk - partialRisk;
  return { retained, partial: partialRisk, lost: lossRisk };
}

export function createHypothesisBank() {
  const prior = 1 / HYPOTHESIS_IDS.length;
  return {
    schemaVersion: 1,
    updates: 0,
    hypotheses: HYPOTHESIS_IDS.map((id) => ({ id, prior, posterior: prior })),
  };
}

export function predictOutcomeDistribution(hypothesis, program, visibleHistory = {}) {
  validateHypothesis(hypothesis);
  const features = readFeatures(program, visibleHistory);
  return validateDistribution(predictFeatures(hypothesis.id, features));
}

export function createPredictionRecord({ bank, program, visibleHistory = {} }) {
  validateBank(bank);
  const validation = validateAssayProgram(program, DEFAULT_RUN_CONFIG);
  if (!validation.ok) throw new TypeError(`invalid public assay program: ${validation.errors.map((entry) => entry.code).join(",")}`);
  const features = readFeatures(program, visibleHistory);
  const predictions = Object.fromEntries(bank.hypotheses.map((hypothesis) => [
    hypothesis.id,
    validateDistribution(predictFeatures(hypothesis.id, features)),
  ]));
  return deepFreeze({
    schemaVersion: 1,
    programId: program.programId,
    predictions,
  });
}

function validatePredictionRecord(record) {
  assertPublicJson(record, "predictionRecord");
  const allowedFields = new Set(["schemaVersion", "programId", "predictions"]);
  if (isRecord(record) && Object.keys(record).some((key) => !allowedFields.has(key))) {
    throw new TypeError("prediction record contains an outcome or unsupported field");
  }
  if (!isRecord(record) || record.schemaVersion !== 1 || typeof record.programId !== "string"
    || record.programId.trim().length === 0 || !isRecord(record.predictions)) {
    throw new TypeError("invalid frozen prediction record");
  }
  const predictionIds = Object.keys(record.predictions).sort();
  if (predictionIds.join("|") !== [...HYPOTHESIS_IDS].sort().join("|")) {
    throw new TypeError("prediction record does not cover the hypothesis bank");
  }
  for (const id of HYPOTHESIS_IDS) validateDistribution(record.predictions[id]);
}

export function updateHypotheses(bank, predictionRecord, observedCategory) {
  validateBank(bank);
  validatePredictionRecord(predictionRecord);
  if (!CATEGORY_KEYS.includes(observedCategory)) throw new TypeError("unknown observed outcome category");
  const weights = bank.hypotheses.map((hypothesis) => {
    const likelihood = Math.max(LIKELIHOOD_FLOOR, predictionRecord.predictions[hypothesis.id][observedCategory]);
    return { ...hypothesis, posterior: hypothesis.posterior * likelihood };
  });
  const total = weights.reduce((sum, hypothesis) => sum + hypothesis.posterior, 0);
  if (!Number.isFinite(total) || total <= 0) throw new RangeError("hypothesis likelihood update is not normalizable");
  const hypotheses = weights.map((hypothesis) => ({ ...hypothesis, posterior: hypothesis.posterior / total }));
  return {
    schemaVersion: 1,
    updates: bank.updates + 1,
    hypotheses,
  };
}

export function multiclassBrier(prediction, observedCategory) {
  const distribution = validateDistribution(prediction);
  if (!CATEGORY_KEYS.includes(observedCategory)) throw new TypeError("unknown observed outcome category");
  const score = CATEGORY_KEYS.reduce((sum, category) => {
    const target = category === observedCategory ? 1 : 0;
    return sum + (distribution[category] - target) ** 2;
  }, 0) / CATEGORY_KEYS.length;
  return score;
}

export const HYPOTHESIS_IDS_LIST = HYPOTHESIS_IDS;
export const OUTCOME_CATEGORIES = CATEGORY_KEYS;
