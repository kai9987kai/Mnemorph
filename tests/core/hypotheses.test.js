import assert from "node:assert/strict";
import test from "node:test";

const hypothesisModule = await import("../../src/core/hypotheses.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

function requireHypotheses() {
  assert.ok(hypothesisModule, "expected src/core/hypotheses.js to export the hypothesis API");
  return hypothesisModule;
}

function simpleProgram() {
  return { programId: "hypothesis-test", operations: [] };
}

test("predictionDistributionIsNormalized", () => {
  const { createHypothesisBank, predictOutcomeDistribution } = requireHypotheses();
  const bank = createHypothesisBank();
  assert.equal(bank.hypotheses.length, 5);
  for (const hypothesis of bank.hypotheses) {
    const prediction = predictOutcomeDistribution(hypothesis, simpleProgram(), { stage: "afterRegrowth" });
    assert.deepEqual(Object.keys(prediction), ["retained", "partial", "lost"]);
    assert.ok(Object.values(prediction).every((value) => Number.isFinite(value) && value >= 0));
    assert.ok(Math.abs(Object.values(prediction).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  }
});

test("bayesUpdateRaisesCompatibleHypothesis", () => {
  const { createHypothesisBank, updateHypotheses } = requireHypotheses();
  const bank = createHypothesisBank();
  const predictions = Object.fromEntries(bank.hypotheses.map((hypothesis) => [hypothesis.id, {
    retained: hypothesis.id === "local-trace" ? 0.9 : 0.1,
    partial: 0.05,
    lost: hypothesis.id === "local-trace" ? 0.05 : 0.85,
  }]));
  const updated = updateHypotheses(bank, {
    schemaVersion: 1,
    programId: "matched-lesion",
    predictions,
  }, "retained");
  const before = bank.hypotheses.find((hypothesis) => hypothesis.id === "local-trace").posterior;
  const after = updated.hypotheses.find((hypothesis) => hypothesis.id === "local-trace").posterior;
  assert.ok(after > before);
  assert.ok(after > Math.max(...updated.hypotheses.filter((hypothesis) => hypothesis.id !== "local-trace")
    .map((hypothesis) => hypothesis.posterior)));
  assert.equal(bank.updates, 0, "the prior bank is immutable");
  assert.equal(updated.updates, 1);
});

test("likelihoodFloorPreventsZeroingAllHypotheses", () => {
  const { createHypothesisBank, updateHypotheses } = requireHypotheses();
  const bank = createHypothesisBank();
  const predictions = Object.fromEntries(bank.hypotheses.map((hypothesis) => [hypothesis.id, {
    retained: 0,
    partial: 0,
    lost: 1,
  }]));
  const updated = updateHypotheses(bank, { schemaVersion: 1, programId: "unlikely", predictions }, "retained");
  assert.ok(updated.hypotheses.every((hypothesis) => hypothesis.posterior > 0));
  assert.ok(Math.abs(updated.hypotheses.reduce((sum, hypothesis) => sum + hypothesis.posterior, 0) - 1) < 1e-12);
});

test("brierScoreMatchesThreeCategoryDefinition", () => {
  const { multiclassBrier } = requireHypotheses();
  const score = multiclassBrier({ retained: 0.7, partial: 0.2, lost: 0.1 }, "retained");
  assert.ok(Math.abs(score - ((0.7 - 1) ** 2 + 0.2 ** 2 + 0.1 ** 2) / 3) < 1e-12);
  assert.throws(() => multiclassBrier({ retained: 2, partial: 0, lost: -1 }, "retained"), /probability/i);
});

test("predictionRecordFreezesBeforeObservation", () => {
  const { createHypothesisBank, createPredictionRecord, updateHypotheses } = requireHypotheses();
  const bank = createHypothesisBank();
  const record = createPredictionRecord({ bank, program: simpleProgram(), visibleHistory: { stage: "before" } });
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.predictions), true);
  assert.equal(Object.isFrozen(record.predictions["local-trace"]), true);
  assert.equal("observedCategory" in record, false);
  const serialized = JSON.stringify(record);
  const updated = updateHypotheses(bank, record, "retained");
  assert.equal(JSON.stringify(record), serialized);
  assert.equal(updated.updates, 1);
});

test("predictionRecordRejectsOutcomeFields", () => {
  const { createHypothesisBank, createPredictionRecord, updateHypotheses } = requireHypotheses();
  const bank = createHypothesisBank();
  const record = createPredictionRecord({ bank, program: simpleProgram(), visibleHistory: {} });
  assert.throws(() => updateHypotheses(bank, { ...record, observedCategory: "retained" }, "retained"), /outcome|observation|prediction record/i);
});

test("compilerInputRejectsAuditorFields", () => {
  const { createHypothesisBank, predictOutcomeDistribution, createPredictionRecord, updateHypotheses } = requireHypotheses();
  const bank = createHypothesisBank();
  assert.throws(() => predictOutcomeDistribution(bank.hypotheses[0], simpleProgram(), {
    stage: "afterRegrowth",
    auditorRecord: { mechanismId: "local-trace" },
  }), /auditor|hidden|truth/i);
  const record = createPredictionRecord({ bank, program: simpleProgram(), visibleHistory: {} });
  assert.throws(() => updateHypotheses(bank, { ...record, mechanismId: "local-trace" }, "retained"), /auditor|hidden|truth/i);
});
