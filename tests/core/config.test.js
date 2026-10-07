import assert from "node:assert/strict";
import test from "node:test";

const configModule = await import("../../src/core/config.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

function requireConfig() {
  assert.ok(configModule, "expected src/core/config.js to export the config contract");
  return configModule;
}

test("acceptsDefaultsAndValidOverrides", () => {
  const { DEFAULT_RUN_CONFIG, validateRunConfig } = requireConfig();
  assert.equal(DEFAULT_RUN_CONFIG.gridWidth, 12);
  assert.equal(DEFAULT_RUN_CONFIG.gridHeight, 8);
  assert.deepEqual(DEFAULT_RUN_CONFIG.cueToAction, [0, 1]);
  assert.equal(DEFAULT_RUN_CONFIG.rewardNoise, 0.05);
  assert.equal(DEFAULT_RUN_CONFIG.trainingEpisodes, 256);
  assert.equal(DEFAULT_RUN_CONFIG.measurementTrials, 100);
  const result = validateRunConfig({ gridWidth: 20, runLabel: "pilot" });
  assert.equal(result.ok, true);
  assert.equal(result.value.gridWidth, 20);
  assert.equal(result.value.gridHeight, 8);
  assert.equal(result.value.runLabel, "pilot");
});

test("rejectsUnknownAndNonFiniteFields", () => {
  const { validateRunConfig } = requireConfig();
  assert.equal(validateRunConfig({ unexpected: true }).ok, false);
  assert.equal(validateRunConfig({ maxTicks: Number.NaN }).ok, false);
  assert.equal(validateRunConfig({ rewardNoise: Number.POSITIVE_INFINITY }).ok, false);
});

test("rejectsNegativeOrNonIntegerCounts", () => {
  const { validateRunConfig } = requireConfig();
  for (const patch of [
    { trainingEpisodes: -1 },
    { trainingEpisodes: 1.5 },
    { maxTicks: 0 },
    { seedBlockCount: -1 },
    { branchCount: 1.25 },
    { candidateEvaluationsPerBatch: -2 },
    { measurementTrials: 0 },
  ]) {
    assert.equal(validateRunConfig(patch).ok, false, JSON.stringify(patch));
  }
});

test("enforcesProtocolAndResourceCaps", () => {
  const { validateRunConfig } = requireConfig();
  for (const patch of [
    { trainingEpisodes: 1001 },
    { maxTicks: 10001 },
    { measurementTrials: 1001 },
    { seedBlockCount: 257 },
    { branchCount: 33 },
    { protocolLengthCap: 5 },
    { candidateEvaluationsPerBatch: 257 },
    { gridWidth: 65 },
    { gridHeight: 65 },
  ]) {
    assert.equal(validateRunConfig(patch).ok, false, JSON.stringify(patch));
  }
  assert.equal(validateRunConfig({ branchCount: 32, seedBlockCount: 256 }).ok, true);
  assert.equal(
    validateRunConfig({ gridWidth: 64, gridHeight: 32, seedBlockCount: 256, branchCount: 2 }).ok,
    true,
  );
  assert.equal(
    validateRunConfig({ gridWidth: 64, gridHeight: 32, seedBlockCount: 256, branchCount: 3 }).ok,
    false,
  );
});

test("rejectsGridProductAboveCellCap", () => {
  const { validateRunConfig } = requireConfig();
  assert.equal(validateRunConfig({ gridWidth: 64, gridHeight: 32 }).ok, true);
  assert.equal(validateRunConfig({ gridWidth: 64, gridHeight: 33 }).ok, false);
});

test("validatesCueMapAndRewardNoise", () => {
  const { validateRunConfig } = requireConfig();
  assert.equal(validateRunConfig({ cueToAction: [1, 0] }).ok, true);
  assert.equal(validateRunConfig({ cueToAction: [0, 0] }).ok, false);
  assert.equal(validateRunConfig({ rewardNoise: 0 }).ok, true);
  assert.equal(validateRunConfig({ rewardNoise: 0.25 }).ok, true);
  assert.equal(validateRunConfig({ rewardNoise: 0.251 }).ok, false);
});
