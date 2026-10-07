import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const statisticsModule = await import("../../src/core/statistics.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

function requireStatistics() {
  assert.ok(statisticsModule, "expected src/core/statistics.js to export the confirmatory analysis API");
  return statisticsModule;
}

function makePlan(overrides = {}) {
  return {
    schemaVersion: 1,
    locked: true,
    alpha: 0.05,
    targetPower: 0.8,
    maxSeedBlocks: 256,
    requiredSeedBlocks: 4,
    seedBlockCount: 4,
    pilotSeeds: [1, 2],
    confirmatorySeeds: [11, 12, 13, 14],
    pilotRuleFamilyIds: ["pilot-rule-a"],
    confirmatoryRuleFamilyIds: ["heldout-rule-a"],
    stoppingRule: "fixed-n-no-peeking",
    primaryComparison: {
      methodA: "adaptive-revisable-grammar",
      methodB: "frozen-grammar-information-gain",
      metric: "brier",
      difference: "methodA-minus-methodB",
    },
    budgets: { assayCount: 1, candidateEvaluationsPerBatch: 64, protocolLengthCap: 4 },
    withheldAssayHash: "a".repeat(64),
    heldOutRuleFamilies: ["heldout-rule-a"],
    transferContexts: ["reversed-cue-map"],
    nullClaimRateMax: 0.05,
    thresholds: { maxCalibrationBrier: 0.25 },
    ...overrides,
  };
}

function makeResults(overrides = {}) {
  const primaryResults = [];
  for (const [index, seedBlockId] of ["b1", "b2", "b3", "b4"].entries()) {
    primaryResults.push({ methodId: "adaptive-revisable-grammar", seedBlockId, brierScore: 0.12 + index * 0.005 });
    primaryResults.push({ methodId: "frozen-grammar-information-gain", seedBlockId, brierScore: 0.32 + index * 0.005 });
  }
  return {
    primaryResults,
    heldOutRuleFamilyIds: ["heldout-rule-a"],
    heldOutRuleDifferences: [-0.12, -0.11, -0.13, -0.10],
    transferContexts: ["reversed-cue-map"],
    transferContextDifferences: [-0.1, -0.12, -0.11, -0.13],
    nullControl: { claimCount: 0, trialCount: 100 },
    calibration: { brierScores: [0.12, 0.18, 0.15, 0.16] },
    ...overrides,
  };
}

test("pairedDifferenceUsesSeedBlocks", () => {
  const { pairedDifferences } = requireStatistics();
  const rows = [
    { methodId: "adaptive", seedBlockId: "b2", brierScore: 0.4 },
    { methodId: "frozen", seedBlockId: "b1", brierScore: 0.3 },
    { methodId: "adaptive", seedBlockId: "b1", brierScore: 0.2 },
    { methodId: "frozen", seedBlockId: "b2", brierScore: 0.35 },
  ];
  assert.deepEqual(pairedDifferences(rows, "adaptive", "frozen"), [-0.1, 0.05]);
});

test("bootstrapUsesDeterministicResamplingSeed", () => {
  const { pairedBootstrapInterval } = requireStatistics();
  const differences = [-0.2, -0.1, 0.05, -0.3, 0.02];
  const first = pairedBootstrapInterval(differences, { seed: 99, resamples: 500 });
  const second = pairedBootstrapInterval(differences, { seed: 99, resamples: 500 });
  assert.deepEqual(first, second);
  assert.ok(first.lower <= first.mean && first.mean <= first.upper);
});

test("randomizationTestIsPaired", () => {
  const { pairedRandomizationP } = requireStatistics();
  const result = pairedRandomizationP([-0.2, -0.2, -0.2]);
  assert.equal(result.exact, true);
  assert.equal(result.permutations, 8);
  assert.equal(result.pValue, 0.25);
});

test("holmAdjustmentIsMonotone", () => {
  const { holmAdjust } = requireStatistics();
  const adjusted = holmAdjust([0.01, 0.04, 0.03]);
  assert.deepEqual(adjusted, [0.03, 0.06, 0.06]);
  const ordered = adjusted.slice().sort((a, b) => a - b);
  assert.ok(ordered.every((value, index) => index === 0 || value >= ordered[index - 1]));
});

test("pilotSizingReturnsBoundedSeedCount", () => {
  const { estimateConfirmatoryN } = requireStatistics();
  const result = estimateConfirmatoryN([-0.8, -0.7, -0.9, -0.8], { seed: 42 });
  assert.equal(result.status, "sized");
  assert.ok(result.seedBlocks >= 2 && result.seedBlocks <= 256);
  assert.ok(result.simulatedPower >= 0.8);
  assert.equal(result.resamples, 10_000);
});

test("underpoweredPlanCannotClaimConfirmatorySuccess", () => {
  const { analyzeConfirmatoryResults } = requireStatistics();
  const result = analyzeConfirmatoryResults(makePlan({ requiredSeedBlocks: 5, seedBlockCount: 4 }), makeResults());
  assert.equal(result.status, "inconclusive");
  assert.ok(result.reasons.includes("underpowered_confirmatory_plan"));
});

test("primaryClaimRequiresNegativeBrierDifferenceAnd95PercentInterval", () => {
  const { analyzeConfirmatoryResults } = requireStatistics();
  const result = analyzeConfirmatoryResults(makePlan(), makeResults());
  assert.equal(result.primary.meanDifference < 0, true);
  assert.equal(result.primary.interval.upper < 0, true);
  assert.equal(result.status, "confirmatory_success");
});

test("requiresHeldOutRuleAndContextEffect", () => {
  const { analyzeConfirmatoryResults } = requireStatistics();
  const results = makeResults({ heldOutRuleDifferences: [0.1, -0.1, 0.1, -0.1] });
  const analysis = analyzeConfirmatoryResults(makePlan(), results);
  assert.notEqual(analysis.status, "confirmatory_success");
  assert.ok(analysis.reasons.includes("held_out_rule_effect_not_confirmed"));
});

test("nullClaimRateWithinBound", () => {
  const { analyzeConfirmatoryResults } = requireStatistics();
  const analysis = analyzeConfirmatoryResults(makePlan(), makeResults({
    nullControl: { claimCount: 6, trialCount: 100 },
  }));
  assert.notEqual(analysis.status, "confirmatory_success");
  assert.ok(analysis.reasons.includes("null_claim_rate_exceeds_bound"));
});

test("primaryConclusionRequiresCalibrationGuardrail", () => {
  const { analyzeConfirmatoryResults } = requireStatistics();
  const analysis = analyzeConfirmatoryResults(makePlan(), makeResults({ calibration: { brierScores: [0.3, 0.31] } }));
  assert.notEqual(analysis.status, "confirmatory_success");
  assert.ok(analysis.reasons.includes("calibration_guardrail_failed"));
});

test("confirmatoryTemplateCannotClaimSuccessWithoutAnExplicitLock", async () => {
  const { analyzeConfirmatoryResults } = requireStatistics();
  const template = JSON.parse(await readFile(new URL("../../configs/confirmatory-template.json", import.meta.url), "utf8"));
  const analysis = analyzeConfirmatoryResults(template, makeResults());
  assert.equal(template.locked, false);
  assert.equal(template.alpha, 0.05);
  assert.equal(template.targetPower, 0.8);
  assert.equal(template.maxSeedBlocks, 256);
  assert.notEqual(analysis.status, "confirmatory_success");
  assert.ok(analysis.reasons.includes("plan_not_locked"));
});
