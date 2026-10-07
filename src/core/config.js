const LIMITS = Object.freeze({
  minGridDimension: 4,
  maxGridDimension: 64,
  maxCellsPerSubject: 2048,
  maxCellInstancesPerBatch: 1_048_576,
  maxTrainingEpisodes: 1000,
  maxTicks: 10_000,
  maxMeasurementTrials: 1000,
  maxSeedBlocks: 256,
  minBranches: 2,
  maxBranches: 32,
  maxProtocolLength: 4,
  maxCandidateEvaluations: 256,
});

export const DEFAULT_RUN_CONFIG = Object.freeze({
  gridWidth: 12,
  gridHeight: 8,
  cueToAction: Object.freeze([0, 1]),
  rewardNoise: 0.05,
  trainingEpisodes: 256,
  maxTicks: 10_000,
  seedBlockCount: 8,
  branchCount: 2,
  protocolLengthCap: 4,
  candidateEvaluationsPerBatch: 64,
  measurementTrials: 100,
  preflightAccuracy: 0.70,
  retainedAccuracy: 0.75,
  partialAccuracy: 0.55,
  runLabel: "smoke",
});

const KNOWN_KEYS = new Set(Object.keys(DEFAULT_RUN_CONFIG));

function addError(errors, path, code) {
  errors.push({ path, code });
}

function integerInRange(value, min, max, path, errors) {
  if (!Number.isInteger(value)) {
    addError(errors, path, "expected_integer");
    return false;
  }
  if (value < min || value > max) {
    addError(errors, path, "out_of_range");
    return false;
  }
  return true;
}

function unitInterval(value, path, errors, { min = 0, max = 1 } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addError(errors, path, "expected_finite_number");
    return false;
  }
  if (value < min || value > max) {
    addError(errors, path, "out_of_range");
    return false;
  }
  return true;
}

export function validateRunConfig(input = {}) {
  const errors = [];
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: [{ path: "$", code: "expected_object" }] };
  }

  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) addError(errors, key, "unknown_field");
  }

  const value = {
    ...DEFAULT_RUN_CONFIG,
    ...input,
    cueToAction: Array.isArray(input.cueToAction)
      ? [...input.cueToAction]
      : [...DEFAULT_RUN_CONFIG.cueToAction],
  };

  const widthOk = integerInRange(
    value.gridWidth,
    LIMITS.minGridDimension,
    LIMITS.maxGridDimension,
    "gridWidth",
    errors,
  );
  const heightOk = integerInRange(
    value.gridHeight,
    LIMITS.minGridDimension,
    LIMITS.maxGridDimension,
    "gridHeight",
    errors,
  );
  if (widthOk && heightOk && value.gridWidth * value.gridHeight > LIMITS.maxCellsPerSubject) {
    addError(errors, "gridWidth", "subject_cell_cap_exceeded");
  }

  integerInRange(value.trainingEpisodes, 1, LIMITS.maxTrainingEpisodes, "trainingEpisodes", errors);
  integerInRange(value.maxTicks, 1, LIMITS.maxTicks, "maxTicks", errors);
  integerInRange(value.seedBlockCount, 1, LIMITS.maxSeedBlocks, "seedBlockCount", errors);
  integerInRange(value.branchCount, LIMITS.minBranches, LIMITS.maxBranches, "branchCount", errors);
  integerInRange(value.protocolLengthCap, 1, LIMITS.maxProtocolLength, "protocolLengthCap", errors);
  integerInRange(
    value.candidateEvaluationsPerBatch,
    1,
    LIMITS.maxCandidateEvaluations,
    "candidateEvaluationsPerBatch",
    errors,
  );
  integerInRange(value.measurementTrials, 1, LIMITS.maxMeasurementTrials, "measurementTrials", errors);

  if (widthOk && heightOk && Number.isInteger(value.seedBlockCount) && value.seedBlockCount > 0
    && Number.isInteger(value.branchCount) && value.branchCount > 0
    && value.gridWidth * value.gridHeight * value.seedBlockCount * value.branchCount > LIMITS.maxCellInstancesPerBatch) {
    addError(errors, "branchCount", "batch_cell_instance_cap_exceeded");
  }

  if (!Array.isArray(value.cueToAction)
    || value.cueToAction.length !== 2
    || !value.cueToAction.every((action) => Number.isInteger(action) && action >= 0 && action <= 1)
    || new Set(value.cueToAction).size !== 2) {
    addError(errors, "cueToAction", "expected_binary_permutation");
  }

  unitInterval(value.rewardNoise, "rewardNoise", errors, { min: 0, max: 0.25 });
  unitInterval(value.preflightAccuracy, "preflightAccuracy", errors, { min: 0.500001 });
  unitInterval(value.retainedAccuracy, "retainedAccuracy", errors, { min: 0.500001 });
  unitInterval(value.partialAccuracy, "partialAccuracy", errors, { min: 0.500001 });
  if (Number.isFinite(value.partialAccuracy) && Number.isFinite(value.retainedAccuracy)
    && value.partialAccuracy >= value.retainedAccuracy) {
    addError(errors, "partialAccuracy", "must_be_below_retained_accuracy");
  }

  if (typeof value.runLabel !== "string" || value.runLabel.trim().length === 0 || value.runLabel.length > 80) {
    addError(errors, "runLabel", "expected_nonempty_string_at_most_80_chars");
  }

  errors.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: Object.freeze({ ...value, cueToAction: Object.freeze(value.cueToAction) }),
    errors: [],
  };
}
