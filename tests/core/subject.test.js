import assert from "node:assert/strict";
import test from "node:test";

const subjectModule = await import("../../src/core/subject.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});
const configModule = await import("../../src/core/config.js");

function requireSubject() {
  assert.ok(subjectModule, "expected src/core/subject.js to export the synthetic subject API");
  return subjectModule;
}

const mechanisms = [
  "local-trace",
  "distributed-trace",
  "regenerative-reconstruction",
  "readout-adaptation",
  "context-gated",
];

test("allFamiliesLearnAboveChanceAfterTraining", () => {
  const { createBenchmarkCase, trainSubject } = requireSubject();
  for (const [index, mechanismId] of mechanisms.entries()) {
    const { subject } = createBenchmarkCase({
      seed: 100 + index,
      config: configModule.DEFAULT_RUN_CONFIG,
      mechanismId,
      ruleId: "rule-fixed-a",
    });
    const result = trainSubject(subject, { episodes: configModule.DEFAULT_RUN_CONFIG.trainingEpisodes });
    assert.equal(result.summary.preflightPassed, true, mechanismId);
    assert.ok(result.summary.preflightAccuracy >= 0.70, mechanismId);
    assert.equal(result.trainingRows.length, configModule.DEFAULT_RUN_CONFIG.trainingEpisodes);
  }
});

test("familyTruthIsOutsideVisibleSubject", () => {
  const { createBenchmarkCase, trainSubject } = requireSubject();
  for (const mechanismId of mechanisms) {
    const { subject, auditorRecord } = createBenchmarkCase({
      seed: 42,
      config: configModule.DEFAULT_RUN_CONFIG,
      mechanismId,
      ruleId: "rule-fixed-a",
    });
    const trained = trainSubject(subject, { episodes: 32 });
    const visiblePayload = JSON.stringify([subject, trained.subject, trained.trainingRows]);
    assert.equal(auditorRecord.mechanismId, mechanismId);
    assert.equal(visiblePayload.includes(mechanismId), false);
  }
});

test("openSubstrateRecipeIsAuditorOnly", () => {
  const { createBenchmarkCase, trainSubject } = requireSubject();
  const { subject, auditorRecord } = createBenchmarkCase({
    seed: 734,
    config: configModule.DEFAULT_RUN_CONFIG,
    mechanismId: "open-substrate",
    ruleId: "rule-open-a",
  });
  const trained = trainSubject(subject, { episodes: 24 });
  const visiblePayload = JSON.stringify([subject, trained.subject, trained.trainingRows]);
  assert.equal(auditorRecord.mechanismId, "open-substrate");
  assert.ok(auditorRecord.recipe.length > 0);
  for (const mechanismId of mechanisms) assert.equal(visiblePayload.includes(mechanismId), false);
});

test("preflightRejectsUntrainedSubject", () => {
  const { createBenchmarkCase, trainSubject } = requireSubject();
  const { subject } = createBenchmarkCase({
    seed: 7,
    config: configModule.DEFAULT_RUN_CONFIG,
    mechanismId: "local-trace",
    ruleId: "rule-fixed-a",
  });
  const result = trainSubject(subject, { episodes: 0 });
  assert.equal(result.summary.preflightPassed, false);
  assert.equal(result.summary.memoryEligible, false);
  assert.equal(result.trainingRows.length, 0);
});

test("measureBehaviorReturnsRawTrials", () => {
  const { createBenchmarkCase, measureBehavior, trainSubject } = requireSubject();
  const { subject } = createBenchmarkCase({
    seed: 99,
    config: configModule.DEFAULT_RUN_CONFIG,
    mechanismId: "distributed-trace",
    ruleId: "rule-fixed-a",
  });
  const trained = trainSubject(subject, { episodes: 256 });
  const measured = measureBehavior(trained.subject, {
    context: "familiar",
    trials: 40,
    eventKey: ["subject-test", 99],
  });
  assert.equal(measured.rows.length, 40);
  assert.ok(measured.rows.every((row) => Number.isInteger(row.cue)
    && Number.isInteger(row.targetAction)
    && Number.isInteger(row.chosenAction)
    && typeof row.correct === "boolean"));
  assert.equal(measured.accuracy, measured.rows.filter((row) => row.correct).length / 40);
});

test("developmentRuleIsFrozenForLifetime", () => {
  const { createBenchmarkCase, trainSubject } = requireSubject();
  const { subject } = createBenchmarkCase({
    seed: 17,
    config: configModule.DEFAULT_RUN_CONFIG,
    mechanismId: "regenerative-reconstruction",
    ruleId: "rule-fixed-b",
  });
  const before = structuredClone(subject.development);
  const result = trainSubject(subject, { episodes: 256 });
  assert.deepEqual(result.subject.development, before);
  assert.equal(result.subject.task.cueToAction[0], 0);
  assert.equal(result.subject.task.rewardNoise, 0.05);
});
