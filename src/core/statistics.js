import { createRng } from "./random.js";

const ALPHA = 0.05;
const CONFIDENCE = 0.95;
const TARGET_POWER = 0.80;
const MAX_SEED_BLOCKS = 256;
const DEFAULT_RESAMPLES = 10_000;
const Z_975 = 1.959963984540054;

function finiteDifferences(differences, { minimum = 1 } = {}) {
  if (!Array.isArray(differences) || differences.length < minimum
    || !differences.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError(`differences must be a finite numeric array with at least ${minimum} value(s)`);
  }
  return [...differences];
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function seedValue(seed) {
  const result = seed ?? 0;
  if (!Number.isSafeInteger(result) || result < 0 || result > 0xffff_ffff) {
    throw new TypeError("seed must be an unsigned 32-bit integer");
  }
  return result;
}

function scoreRows(results) {
  if (Array.isArray(results)) return results;
  if (!results || typeof results !== "object") throw new TypeError("results must be an array or result object");
  if (Array.isArray(results.primaryResults)) return results.primaryResults;
  if (Array.isArray(results.rows)) return results.rows;
  if (!Array.isArray(results.auditorRows)) throw new TypeError("results do not contain paired score rows");
  const expanded = [];
  for (const row of results.auditorRows) {
    if (!Array.isArray(row.withheldEvaluations)) continue;
    for (const evaluation of row.withheldEvaluations) {
      if (typeof evaluation.brierScore !== "number" || !Number.isFinite(evaluation.brierScore)) continue;
      expanded.push({
        methodId: row.methodId,
        seedBlockId: row.seedBlockId ?? row.seedBlockIndex ?? row.masterSeed,
        masterSeed: row.masterSeed,
        seedBlockIndex: row.seedBlockIndex,
        familyId: row.ruleFamilyId ?? row.mechanismId ?? "",
        contextId: evaluation.contextId ?? evaluation.programId ?? "withheld",
        brierScore: evaluation.brierScore,
      });
    }
  }
  return expanded;
}

function pairKey(row) {
  const seedBlock = row.seedBlockId ?? row.seedBlockIndex ?? row.masterSeed ?? row.seed;
  if (seedBlock === undefined || seedBlock === null) throw new TypeError("score row is missing its seed-block key");
  return JSON.stringify([
    seedBlock,
    row.ruleFamilyId ?? row.familyId ?? row.mechanismId ?? "",
    row.contextId ?? row.context ?? row.programId ?? "primary",
  ]);
}

function metricValue(row) {
  const value = row.brierScore ?? row.primaryBrierScore ?? row.score;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("score row is missing a finite Brier score");
  return value;
}

export function pairedDifferences(results, methodA, methodB) {
  if (typeof methodA !== "string" || typeof methodB !== "string" || methodA === methodB) {
    throw new TypeError("paired comparison requires two distinct method ids");
  }
  const rows = scoreRows(results);
  const byMethod = new Map([[methodA, new Map()], [methodB, new Map()]]);
  for (const row of rows) {
    if (!row || !byMethod.has(row.methodId)) continue;
    const key = pairKey(row);
    const values = byMethod.get(row.methodId);
    if (values.has(key)) throw new TypeError(`duplicate paired score for method ${row.methodId}`);
    values.set(key, metricValue(row));
  }
  const first = byMethod.get(methodA);
  const second = byMethod.get(methodB);
  const keys = [...first.keys()].filter((key) => second.has(key)).sort();
  return keys.map((key) => Number((first.get(key) - second.get(key)).toPrecision(12)));
}

function quantile(sorted, probability) {
  const location = (sorted.length - 1) * probability;
  const lower = Math.floor(location);
  const upper = Math.ceil(location);
  if (lower === upper) return sorted[lower];
  const fraction = location - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

export function pairedBootstrapInterval(differences, options = {}) {
  const values = finiteDifferences(differences);
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("bootstrap options must be an object");
  }
  const confidence = options.confidence ?? CONFIDENCE;
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;
  const seed = seedValue(options.seed);
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
    throw new TypeError("confidence must be between 0 and 1");
  }
  if (!Number.isSafeInteger(resamples) || resamples < 1 || resamples > 100_000) {
    throw new TypeError("resamples must be an integer in [1, 100000]");
  }
  const rng = createRng(seed);
  const estimates = new Array(resamples);
  for (let replicate = 0; replicate < resamples; replicate += 1) {
    let total = 0;
    for (let draw = 0; draw < values.length; draw += 1) {
      total += values[Math.floor(rng.nextFloat() * values.length)];
    }
    estimates[replicate] = total / values.length;
  }
  estimates.sort((a, b) => a - b);
  const tail = (1 - confidence) / 2;
  return {
    lower: quantile(estimates, tail),
    upper: quantile(estimates, 1 - tail),
    mean: mean(values),
    confidence,
    resamples,
    seed,
  };
}

export function pairedRandomizationP(differences, options = {}) {
  const values = finiteDifferences(differences);
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("randomization options must be an object");
  }
  const observed = Math.abs(mean(values));
  if (values.length <= 20) {
    const permutations = 2 ** values.length;
    let extreme = 0;
    for (let mask = 0; mask < permutations; mask += 1) {
      let total = 0;
      for (let index = 0; index < values.length; index += 1) {
        total += (mask & (2 ** index)) === 0 ? values[index] : -values[index];
      }
      if (Math.abs(total / values.length) >= observed - 1e-15) extreme += 1;
    }
    return { pValue: extreme / permutations, exact: true, permutations, seed: null };
  }
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;
  const seed = seedValue(options.seed);
  if (!Number.isSafeInteger(resamples) || resamples < 1 || resamples > 100_000) {
    throw new TypeError("resamples must be an integer in [1, 100000]");
  }
  const rng = createRng(seed);
  let extreme = 0;
  for (let replicate = 0; replicate < resamples; replicate += 1) {
    let total = 0;
    for (const value of values) total += (rng.nextFloat() < 0.5 ? -1 : 1) * value;
    if (Math.abs(total / values.length) >= observed - 1e-15) extreme += 1;
  }
  return {
    pValue: (extreme + 1) / (resamples + 1),
    exact: false,
    permutations: resamples,
    seed,
  };
}

export function holmAdjust(pValues) {
  if (!Array.isArray(pValues) || !pValues.every((value) => typeof value === "number"
    && Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new TypeError("pValues must be probabilities in [0, 1]");
  }
  const ordered = pValues.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const adjusted = new Array(pValues.length);
  let runningMaximum = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = Math.min(1, (ordered.length - index) * ordered[index].value);
    runningMaximum = Math.max(runningMaximum, candidate);
    adjusted[ordered[index].index] = runningMaximum;
  }
  return adjusted;
}

export function estimateConfirmatoryN(pilotDifferences, options = {}) {
  const values = finiteDifferences(pilotDifferences, { minimum: 2 });
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("sample-size options must be an object");
  }
  const seed = seedValue(options.seed);
  const maxSeedBlocks = options.maxSeedBlocks ?? MAX_SEED_BLOCKS;
  const resamples = options.resamples ?? DEFAULT_RESAMPLES;
  if (!Number.isSafeInteger(maxSeedBlocks) || maxSeedBlocks < 2 || maxSeedBlocks > MAX_SEED_BLOCKS) {
    throw new TypeError("maxSeedBlocks must be in [2, 256]");
  }
  if (!Number.isSafeInteger(resamples) || resamples !== DEFAULT_RESAMPLES) {
    throw new TypeError("sample-size estimation uses exactly 10000 seeded bootstrap draws");
  }
  const pilotMean = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - pilotMean) ** 2, 0) / (values.length - 1);
  const standardDeviation = Math.sqrt(variance);
  const base = {
    status: "inconclusive",
    seedBlocks: null,
    simulatedPower: 0,
    alpha: ALPHA,
    targetPower: TARGET_POWER,
    maxSeedBlocks,
    resamples,
    seed,
  };
  if (!Number.isFinite(standardDeviation) || standardDeviation === 0 || pilotMean === 0) {
    return { ...base, reason: "pilot_effect_or_variance_not_estimable" };
  }
  const rng = createRng(seed);
  const powerCounts = new Array(maxSeedBlocks + 1).fill(0);
  for (let replicate = 0; replicate < resamples; replicate += 1) {
    let total = 0;
    for (let n = 1; n <= maxSeedBlocks; n += 1) {
      total += values[Math.floor(rng.nextFloat() * values.length)];
      if (n < 2) continue;
      const z = Math.abs((total / n) / (standardDeviation / Math.sqrt(n)));
      if (z >= Z_975) powerCounts[n] += 1;
    }
  }
  for (let n = 2; n <= maxSeedBlocks; n += 1) {
    const simulatedPower = powerCounts[n] / resamples;
    if (simulatedPower >= TARGET_POWER) {
      return {
        ...base,
        status: "sized",
        seedBlocks: n,
        simulatedPower,
        effectEstimate: pilotMean,
        pilotStandardDeviation: standardDeviation,
      };
    }
  }
  return {
    ...base,
    reason: "required_sample_exceeds_cap",
    effectEstimate: pilotMean,
    pilotStandardDeviation: standardDeviation,
  };
}

function uniqueStrings(values, path, { required = true } = {}) {
  if (!Array.isArray(values) || (required && values.length === 0)
    || !values.every((value) => typeof value === "string" && value.trim().length > 0)
    || new Set(values).size !== values.length) {
    return [`${path}_invalid`];
  }
  return [];
}

function lockIssues(plan) {
  const issues = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["locked_plan_invalid"];
  if (plan.schemaVersion !== 1 || plan.locked !== true) issues.push("plan_not_locked");
  if (plan.alpha !== ALPHA || plan.targetPower !== TARGET_POWER || plan.maxSeedBlocks !== MAX_SEED_BLOCKS) {
    issues.push("preregistered_constants_mismatch");
  }
  if (!Number.isSafeInteger(plan.requiredSeedBlocks) || plan.requiredSeedBlocks < 2) issues.push("required_seed_count_invalid");
  if (!Number.isSafeInteger(plan.seedBlockCount) || plan.seedBlockCount < 2) issues.push("confirmatory_seed_count_invalid");
  if (Number.isSafeInteger(plan.requiredSeedBlocks) && plan.requiredSeedBlocks > MAX_SEED_BLOCKS) {
    issues.push("required_sample_exceeds_cap");
  }
  if (Number.isSafeInteger(plan.seedBlockCount) && plan.seedBlockCount > MAX_SEED_BLOCKS) {
    issues.push("confirmatory_sample_exceeds_cap");
  }
  if (Array.isArray(plan.confirmatorySeeds) && plan.seedBlockCount !== plan.confirmatorySeeds.length) {
    issues.push("locked_seed_count_mismatch");
  }
  issues.push(...uniqueStrings(plan.pilotRuleFamilyIds, "pilot_rule_families"));
  issues.push(...uniqueStrings(plan.confirmatoryRuleFamilyIds, "confirmatory_rule_families"));
  issues.push(...uniqueStrings(plan.heldOutRuleFamilies, "held_out_rule_families"));
  issues.push(...uniqueStrings(plan.transferContexts, "transfer_contexts"));
  if (!Array.isArray(plan.pilotSeeds) || !plan.pilotSeeds.every((seed) => Number.isSafeInteger(seed) && seed >= 0)) {
    issues.push("pilot_seeds_invalid");
  }
  if (!Array.isArray(plan.confirmatorySeeds) || !plan.confirmatorySeeds.every((seed) => Number.isSafeInteger(seed) && seed >= 0)) {
    issues.push("confirmatory_seeds_invalid");
  }
  if (Array.isArray(plan.pilotSeeds) && Array.isArray(plan.confirmatorySeeds)
    && plan.pilotSeeds.some((seed) => plan.confirmatorySeeds.includes(seed))) issues.push("seed_sets_overlap");
  if (Array.isArray(plan.pilotRuleFamilyIds) && Array.isArray(plan.confirmatoryRuleFamilyIds)
    && plan.pilotRuleFamilyIds.some((id) => plan.confirmatoryRuleFamilyIds.includes(id))) issues.push("rule_family_sets_overlap");
  if (plan.stoppingRule !== "fixed-n-no-peeking") issues.push("stopping_rule_not_preregistered");
  if (!plan.primaryComparison || plan.primaryComparison.metric !== "brier"
    || plan.primaryComparison.difference !== "methodA-minus-methodB"
    || typeof plan.primaryComparison.methodA !== "string" || typeof plan.primaryComparison.methodB !== "string"
    || plan.primaryComparison.methodA === plan.primaryComparison.methodB) issues.push("primary_comparison_invalid");
  if (!plan.budgets || !Number.isSafeInteger(plan.budgets.assayCount) || plan.budgets.assayCount < 1
    || !Number.isSafeInteger(plan.budgets.candidateEvaluationsPerBatch) || plan.budgets.candidateEvaluationsPerBatch < 1
    || plan.budgets.candidateEvaluationsPerBatch > 256 || !Number.isSafeInteger(plan.budgets.protocolLengthCap)
    || plan.budgets.protocolLengthCap < 1 || plan.budgets.protocolLengthCap > 4) issues.push("locked_budgets_invalid");
  if (typeof plan.withheldAssayHash !== "string" || !/^(sha256:)?[a-f0-9]{64}$/i.test(plan.withheldAssayHash)) {
    issues.push("withheld_assay_hash_invalid");
  }
  if (typeof plan.nullClaimRateMax !== "number" || !Number.isFinite(plan.nullClaimRateMax)
    || plan.nullClaimRateMax < 0 || plan.nullClaimRateMax > ALPHA) issues.push("null_claim_rate_bound_invalid");
  if (!plan.thresholds || typeof plan.thresholds.maxCalibrationBrier !== "number"
    || !Number.isFinite(plan.thresholds.maxCalibrationBrier)
    || plan.thresholds.maxCalibrationBrier < 0 || plan.thresholds.maxCalibrationBrier > 1) {
    issues.push("calibration_threshold_invalid");
  }
  return [...new Set(issues)];
}

function intervalForRequiredEffect(differences, seed) {
  const values = finiteDifferences(differences, { minimum: 2 });
  const interval = pairedBootstrapInterval(values, { seed, confidence: CONFIDENCE, resamples: DEFAULT_RESAMPLES });
  return { meanDifference: mean(values), interval, confirmed: mean(values) < 0 && interval.upper < 0 };
}

function calibrationMaximum(calibration) {
  if (!calibration || typeof calibration !== "object") return null;
  if (Array.isArray(calibration.brierScores) && calibration.brierScores.length > 0
    && calibration.brierScores.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1)) {
    return Math.max(...calibration.brierScores);
  }
  if (typeof calibration.maxBrier === "number" && Number.isFinite(calibration.maxBrier)
    && calibration.maxBrier >= 0 && calibration.maxBrier <= 1) return calibration.maxBrier;
  return null;
}

export function analyzeConfirmatoryResults(lockedPlan, results) {
  const issues = lockIssues(lockedPlan);
  const reasons = [...issues];
  if (lockedPlan && Number.isSafeInteger(lockedPlan.requiredSeedBlocks)
    && Number.isSafeInteger(lockedPlan.seedBlockCount)
    && lockedPlan.seedBlockCount < lockedPlan.requiredSeedBlocks) reasons.push("underpowered_confirmatory_plan");
  if (!results || typeof results !== "object") {
    return { status: "inconclusive", reasons: [...new Set([...reasons, "confirmatory_results_missing"])], primary: null };
  }

  const primary = { meanDifference: null, interval: null, randomization: null, confirmed: false };
  try {
    const differences = pairedDifferences(
      results.primaryResults ?? results,
      lockedPlan?.primaryComparison?.methodA,
      lockedPlan?.primaryComparison?.methodB,
    );
    if (differences.length < 2) {
      reasons.push("insufficient_paired_confirmatory_blocks");
    } else {
      primary.meanDifference = mean(differences);
      primary.interval = pairedBootstrapInterval(differences, { seed: 1101, resamples: DEFAULT_RESAMPLES });
      primary.randomization = pairedRandomizationP(differences, { seed: 1102 });
      primary.confirmed = primary.meanDifference < 0 && primary.interval.upper < 0;
      if (!primary.confirmed) reasons.push("primary_effect_not_confirmed");
      if (differences.length < (lockedPlan?.requiredSeedBlocks ?? Infinity)) reasons.push("incomplete_confirmatory_sample");
    }
  } catch (error) {
    reasons.push(`primary_analysis_invalid:${error.message}`);
  }

  let heldOutRuleEffect = null;
  const heldOutIds = results.heldOutRuleFamilyIds ?? [];
  if (!Array.isArray(heldOutIds) || !lockedPlan?.heldOutRuleFamilies?.every((id) => heldOutIds.includes(id))) {
    reasons.push("held_out_rule_families_missing");
  } else {
    try {
      heldOutRuleEffect = intervalForRequiredEffect(results.heldOutRuleDifferences, 2101);
      if (!heldOutRuleEffect.confirmed) reasons.push("held_out_rule_effect_not_confirmed");
    } catch {
      reasons.push("held_out_rule_effect_missing");
    }
  }

  let transferContextEffect = null;
  const transferContexts = results.transferContexts ?? [];
  if (!Array.isArray(transferContexts) || !lockedPlan?.transferContexts?.every((context) => transferContexts.includes(context))) {
    reasons.push("transfer_contexts_missing");
  } else {
    try {
      transferContextEffect = intervalForRequiredEffect(results.transferContextDifferences, 2201);
      if (!transferContextEffect.confirmed) reasons.push("transfer_context_effect_not_confirmed");
    } catch {
      reasons.push("transfer_context_effect_missing");
    }
  }

  let nullControl = null;
  if (!results.nullControl || !Number.isSafeInteger(results.nullControl.claimCount)
    || !Number.isSafeInteger(results.nullControl.trialCount) || results.nullControl.trialCount < 1
    || results.nullControl.claimCount < 0 || results.nullControl.claimCount > results.nullControl.trialCount) {
    reasons.push("null_control_results_missing");
  } else {
    const claimRate = results.nullControl.claimCount / results.nullControl.trialCount;
    nullControl = { ...results.nullControl, claimRate, passed: claimRate <= (lockedPlan?.nullClaimRateMax ?? ALPHA) };
    if (!nullControl.passed) reasons.push("null_claim_rate_exceeds_bound");
  }

  const maximumCalibrationBrier = calibrationMaximum(results.calibration);
  const calibrationGuardrail = {
    maximumBrier: maximumCalibrationBrier,
    bound: lockedPlan?.thresholds?.maxCalibrationBrier ?? null,
    passed: maximumCalibrationBrier !== null
      && maximumCalibrationBrier <= (lockedPlan?.thresholds?.maxCalibrationBrier ?? -1),
  };
  if (!calibrationGuardrail.passed) reasons.push("calibration_guardrail_failed");

  const uniqueReasons = [...new Set(reasons)];
  return {
    status: uniqueReasons.length === 0 && primary.confirmed && heldOutRuleEffect?.confirmed
      && transferContextEffect?.confirmed && nullControl?.passed && calibrationGuardrail.passed
      ? "confirmatory_success"
      : "inconclusive",
    reasons: uniqueReasons,
    primary,
    heldOutRuleEffect,
    transferContextEffect,
    nullControl,
    calibrationGuardrail,
    alpha: ALPHA,
    confidence: CONFIDENCE,
    requiredSeedBlocks: lockedPlan?.requiredSeedBlocks ?? null,
    observedPairedBlocks: primary.interval ? pairedDifferences(
      results.primaryResults ?? results,
      lockedPlan?.primaryComparison?.methodA,
      lockedPlan?.primaryComparison?.methodB,
    ).length : 0,
  };
}

export const CONFIRMATORY_CONSTANTS = Object.freeze({
  alpha: ALPHA,
  confidence: CONFIDENCE,
  targetPower: TARGET_POWER,
  maxSeedBlocks: MAX_SEED_BLOCKS,
  bootstrapResamples: DEFAULT_RESAMPLES,
});
