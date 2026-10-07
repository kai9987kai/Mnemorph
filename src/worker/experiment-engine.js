import { validateRunConfig } from "../core/config.js";
import { buildBaselineMethods, runMatchedBatch } from "../core/experiment.js";
import { validateAssayProgram } from "../core/interventions.js";
import { canonicalJson, sha256Hex } from "../core/snapshot.js";
import { createPublicReceipt, sealReceipt } from "../core/receipt.js";

const MAX_BATCH_SUBJECT_CELLS = 1_048_576;
const SUPPORTED_FAMILIES = new Set([
  "local-trace", "distributed-trace", "regenerative-reconstruction", "readout-adaptation",
  "context-gated", "open-substrate",
]);
const DEFAULT_METHOD_IDS = Object.freeze([
  "fixed-one-factor", "fixed-factorial", "random-equal-budget", "frozen-grammar-information-gain",
  "adaptive-revisable-grammar", "oracle-only-diagnostic",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function invalidResult(jobId, diagnostic) {
  return { status: "invalid", jobId, diagnostic, progress: { completedSeedBlocks: 0, totalSeedBlocks: 0 } };
}

function normalizeJobConfig(config) {
  if (!isRecord(config) || config.schemaVersion !== 1 || !isRecord(config.runConfig)) {
    throw new TypeError("config must be a version 1 benchmark object with runConfig");
  }
  const configResult = validateRunConfig(config.runConfig);
  if (!configResult.ok) {
    throw new TypeError(`runConfig invalid: ${configResult.errors.map(({ path, code }) => `${path}:${code}`).join(",")}`);
  }
  const runConfig = configResult.value;
  if (!Array.isArray(config.masterSeeds) || config.masterSeeds.length !== runConfig.seedBlockCount
    || !config.masterSeeds.every((seed) => Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffff_ffff)
    || new Set(config.masterSeeds).size !== config.masterSeeds.length) {
    throw new TypeError("masterSeeds must be unique unsigned seeds matching runConfig.seedBlockCount");
  }
  if (!Array.isArray(config.familyIds) || config.familyIds.length < 1
    || !config.familyIds.every((familyId) => SUPPORTED_FAMILIES.has(familyId))
    || new Set(config.familyIds).size !== config.familyIds.length) {
    throw new TypeError("familyIds must be unique supported synthetic families");
  }
  if (runConfig.gridWidth * runConfig.gridHeight * 2 * config.masterSeeds.length * config.familyIds.length
    > MAX_BATCH_SUBJECT_CELLS) {
    throw new RangeError("job exceeds the aggregate subject-cell cap");
  }
  const requestedMethods = config.methods ?? DEFAULT_METHOD_IDS;
  if (!Array.isArray(requestedMethods) || requestedMethods.length < 1
    || !requestedMethods.every((methodId) => typeof methodId === "string")
    || new Set(requestedMethods).size !== requestedMethods.length) {
    throw new TypeError("methods must be unique baseline method ids");
  }
  const baselines = buildBaselineMethods(runConfig);
  const methodsById = new Map(baselines.map((method) => [method.id, method]));
  const methods = requestedMethods.map((methodId) => {
    const method = methodsById.get(methodId);
    if (!method) throw new TypeError(`unsupported method id ${methodId}`);
    return method;
  });
  const withheldPrograms = config.withheldPrograms ?? [];
  if (!Array.isArray(withheldPrograms) || withheldPrograms.length > 64) {
    throw new TypeError("withheldPrograms must be an array of at most 64 programs");
  }
  for (const program of withheldPrograms) {
    if (!validateAssayProgram(program, runConfig).ok) throw new TypeError("withheldPrograms contains an invalid assay program");
  }
  return {
    runConfig,
    masterSeeds: [...config.masterSeeds],
    familyIds: [...config.familyIds],
    methods,
    withheldPrograms,
  };
}

function addSummary(target, source) {
  for (const key of ["denominator", "eligibleDenominator", "completed", "invalid", "ineligible"]) {
    target[key] = (target[key] ?? 0) + (source[key] ?? 0);
  }
}

async function mergeSeedBlocks(blockResults, jobConfig) {
  const familyCount = jobConfig.familyIds.length;
  const publicRows = [];
  const auditorRows = [];
  const initialSnapshots = [];
  const methodSummaries = Object.fromEntries(jobConfig.methods.map(({ id }) => [id, {
    denominator: 0,
    eligibleDenominator: 0,
    completed: 0,
    invalid: 0,
    ineligible: 0,
  }]));
  let eligibleDenominator = 0;
  for (const [seedIndex, result] of blockResults.entries()) {
    const blockOffset = seedIndex * familyCount;
    publicRows.push(...result.publicRows.map((row) => ({ ...row, seedBlockIndex: row.seedBlockIndex + blockOffset })));
    auditorRows.push(...result.auditorRows.map((row) => ({ ...row, seedBlockIndex: row.seedBlockIndex + blockOffset })));
    initialSnapshots.push(...result.initialSnapshots.map((snapshot) => ({
      ...snapshot,
      seedBlockIndex: snapshot.seedBlockIndex + blockOffset,
    })));
    eligibleDenominator += result.eligibleDenominator;
    for (const method of jobConfig.methods) addSummary(methodSummaries[method.id], result.methodSummaries[method.id]);
  }
  const identity = {
    schemaVersion: 1,
    config: jobConfig.runConfig,
    methods: jobConfig.methods,
    masterSeeds: jobConfig.masterSeeds,
    familySetHash: await sha256Hex(canonicalJson(jobConfig.familyIds)),
    blockExperimentIds: blockResults.map((result) => result.experimentId),
    withheldPrograms: jobConfig.withheldPrograms,
  };
  return {
    schemaVersion: 1,
    experimentId: `mnemorph-${await sha256Hex(canonicalJson(identity))}`,
    status: "completed",
    config: jobConfig.runConfig,
    methods: jobConfig.methods.map((method) => method.id),
    masterSeeds: jobConfig.masterSeeds,
    initialSnapshots,
    familyCount,
    denominator: jobConfig.masterSeeds.length * familyCount,
    eligibleDenominator,
    publicRows,
    auditorRows,
    methodSummaries,
    methodStates: blockResults.at(-1)?.methodStates ?? {},
  };
}

function yieldToWorkerMessages() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runExperimentBatch({ jobId = "batch-run", config, onProgress = () => {}, isCancelled = () => false } = {}) {
  if (typeof jobId !== "string" || jobId.length > 160) return invalidResult("", "jobId must be a bounded string");
  if (typeof onProgress !== "function" || typeof isCancelled !== "function") {
    return invalidResult(jobId, "onProgress and isCancelled must be functions");
  }
  let jobConfig;
  try {
    jobConfig = normalizeJobConfig(config);
  } catch (error) {
    return invalidResult(jobId, error.message);
  }

  const totalSeedBlocks = jobConfig.masterSeeds.length;
  let completedSeedBlocks = 0;
  const blockResults = [];
  let methodStates = {};
  try {
    for (const [index, masterSeed] of jobConfig.masterSeeds.entries()) {
      if (isCancelled()) {
        return { status: "cancelled", jobId, progress: { completedSeedBlocks, totalSeedBlocks } };
      }
      const blockResult = await runMatchedBatch({
        config: jobConfig.runConfig,
        methods: jobConfig.methods,
        masterSeeds: [masterSeed],
        familyIds: jobConfig.familyIds,
        withheldPrograms: jobConfig.withheldPrograms,
        initialMethodStates: methodStates,
      });
      blockResults.push(blockResult);
      methodStates = blockResult.methodStates;
      completedSeedBlocks = index + 1;
      onProgress({
        type: "progress",
        jobId,
        completedSeedBlocks,
        totalSeedBlocks,
        currentSeed: masterSeed,
        status: "running",
      });
      await yieldToWorkerMessages();
      if (isCancelled()) {
        return { status: "cancelled", jobId, progress: { completedSeedBlocks, totalSeedBlocks } };
      }
    }
    const batchResult = await mergeSeedBlocks(blockResults, jobConfig);
    return {
      status: "completed",
      jobId,
      batchResult,
      progress: { completedSeedBlocks, totalSeedBlocks },
    };
  } catch (error) {
    return {
      status: "failed",
      jobId,
      diagnostic: error instanceof Error ? error.message : String(error),
      progress: { completedSeedBlocks, totalSeedBlocks },
    };
  }
}

export async function runExperimentJob({ jobId, config, onProgress = () => {}, isCancelled = () => false } = {}) {
  if (typeof jobId !== "string" || jobId.trim().length === 0 || jobId.length > 160) {
    return invalidResult(typeof jobId === "string" ? jobId : "", "jobId must be a nonempty bounded string");
  }
  if (typeof onProgress !== "function" || typeof isCancelled !== "function") {
    return invalidResult(jobId, "onProgress and isCancelled must be functions");
  }
  const execution = await runExperimentBatch({ jobId, config, onProgress, isCancelled });
  if (execution.status !== "completed") {
    const { batchResult: _batchResult, ...publicExecution } = execution;
    return publicExecution;
  }
  try {
    const publicReceipt = await createPublicReceipt(execution.batchResult);
    const sealedText = await sealReceipt(publicReceipt);
    return {
      status: "completed",
      jobId,
      experimentId: publicReceipt.experimentId,
      claimStatus: publicReceipt.claimStatus,
      publicReceipt: sealedText,
      progress: execution.progress,
    };
  } catch (error) {
    return {
      status: "failed",
      jobId,
      diagnostic: error instanceof Error ? error.message : String(error),
      progress: execution.progress,
    };
  }
}
