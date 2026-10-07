import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_RUN_CONFIG } from "../../src/core/config.js";

const experimentModule = await import("../../src/core/experiment.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

function requireExperiment() {
  assert.ok(experimentModule, "expected src/core/experiment.js to export matched experiment orchestration");
  return experimentModule;
}

const smallConfig = {
  ...DEFAULT_RUN_CONFIG,
  trainingEpisodes: 128,
  measurementTrials: 8,
  seedBlockCount: 1,
  candidateEvaluationsPerBatch: 4,
  protocolLengthCap: 2,
};

async function runBatch(overrides = {}) {
  const { runMatchedBatch } = requireExperiment();
  return runMatchedBatch({
    config: smallConfig,
    masterSeeds: [81],
    familyIds: ["local-trace"],
    withheldPrograms: [{
      programId: "withheld-transfer",
      operations: [{ type: "context-shift", armId: "treatment", cueToAction: [1, 0], atTick: 0 }],
    }],
    ...overrides,
  });
}

test("allMethodsForkSameSnapshotHash", async () => {
  const result = await runBatch();
  const hashes = new Set(result.publicRows.map((row) => row.initialSnapshotHash));
  assert.equal(hashes.size, 1);
  assert.equal(result.publicRows.length >= 5, true);
});

test("sharedEventsMatchAcrossPairedArms", async () => {
  const result = await runBatch();
  let firstMethodTrials = null;
  for (const row of result.publicRows) {
    const treatment = row.assay.observations.treatment.before.rows.map(({ armId, ...trial }) => trial);
    const control = row.assay.observations.control.before.rows.map(({ armId, ...trial }) => trial);
    assert.deepEqual(treatment, control);
    if (firstMethodTrials === null) firstMethodTrials = treatment;
    else assert.deepEqual(treatment, firstMethodTrials, "methods reuse the same named exogenous cue events");
  }
});

test("methodsReceiveEqualAssayAndSearchBudgets", async () => {
  const result = await runBatch();
  const budgets = result.publicRows.map((row) => row.budget);
  assert.ok(budgets.every((budget) => budget.assayCount === 1));
  assert.ok(budgets.every((budget) => budget.candidateEvaluations === smallConfig.candidateEvaluationsPerBatch));
  assert.ok(budgets.every((budget) => budget.protocolLengthCap === smallConfig.protocolLengthCap));
  assert.equal(new Set(budgets.map((budget) => `${budget.assayCount}:${budget.candidateEvaluations}:${budget.protocolLengthCap}`)).size, 1);
});

test("fixedFactorialBaselineIncludesInteractions", () => {
  const { buildBaselineMethods } = requireExperiment();
  const factorial = buildBaselineMethods(smallConfig).find((method) => method.kind === "fixed-factorial");
  assert.ok(factorial.programs.some((program) => program.operations.length >= 2));
});

test("auditorTruthNeverAppearsInCompilerHistory", async () => {
  const result = await runBatch();
  for (const row of result.publicRows) {
    assert.equal("mechanismId" in row, false);
    assert.equal("familyId" in row, false);
    assert.doesNotMatch(JSON.stringify(row.compilerHistory), /snapshot|wiring|mechanismId/i);
    assert.deepEqual(row.compilerHistory, []);
    assert.equal(JSON.stringify(row.compilerHistory).includes("local-trace"), false);
  }
  assert.ok(result.auditorRows.every((row) => typeof row.mechanismId === "string"));
});

test("withheldPredictionsAreRecordedBeforeScoring", async () => {
  const result = await runBatch();
  for (const row of result.publicRows) {
    assert.equal(row.withheldPredictions.length, 1);
    assert.equal(row.withheldPredictions[0].programId, "withheld-transfer");
    assert.ok(row.withheldPredictions[0].ensemblePrediction);
    assert.equal("observedCategory" in row.withheldPredictions[0], false);
  }
  const scored = result.auditorRows.filter((row) => row.methodId !== "oracle-only-diagnostic");
  assert.ok(scored.every((row) => row.withheldEvaluations[0].brierScore >= 0));
  assert.ok(scored.every((row) => row.withheldEvaluations[0].predictionWasFrozen === true));
});

test("invalidRunsRemainInDenominatorWithStatus", async () => {
  const { runMatchedBatch } = requireExperiment();
  const method = {
    id: "invalid-protocol",
    kind: "fixed-one-factor",
    programs: [{
      programId: "invalid-op",
      operations: [{ type: "execute-code", source: "invalid" }],
    }],
  };
  const result = await runMatchedBatch({
    config: smallConfig,
    methods: [method],
    masterSeeds: [81],
    familyIds: ["local-trace"],
    withheldPrograms: [],
  });
  assert.equal(result.denominator, 1);
  assert.equal(result.methodSummaries[method.id].denominator, 1);
  assert.equal(result.methodSummaries[method.id].invalid, 1);
  assert.equal(result.publicRows.length, 1);
  assert.equal(result.publicRows[0].status, "invalid");
});

test("ablationConfigDisablesOnlyNamedFeature", async () => {
  const config = JSON.parse(await readFile(new URL("../../configs/ablations.json", import.meta.url), "utf8"));
  const expected = [
    "freeze_grammar",
    "freeze_hypothesis_updates",
    "random_selection",
    "remove_event_key_matching",
    "disable_transplant_delay",
    "disable_transfer_context",
    "no_grammar_mutation_equal_compute",
    "disable_null_audit",
  ];
  assert.deepEqual(config.ablations.map((entry) => entry.id), expected);
  assert.ok(config.ablations.every((entry) => entry.disabledFeatures.length === 1));
});
