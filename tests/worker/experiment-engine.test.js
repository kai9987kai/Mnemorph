import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RUN_CONFIG } from "../../src/core/config.js";

const engineModule = await import("../../src/worker/experiment-engine.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});
const receiptModule = await import("../../src/core/receipt.js");

function requireEngine() {
  assert.ok(engineModule, "expected src/worker/experiment-engine.js to export the cancellable job runner");
  return engineModule;
}

function makeJobConfig(overrides = {}) {
  const runConfig = {
    ...DEFAULT_RUN_CONFIG,
    gridWidth: 8,
    gridHeight: 8,
    trainingEpisodes: 128,
    measurementTrials: 8,
    seedBlockCount: 2,
    candidateEvaluationsPerBatch: 4,
    protocolLengthCap: 2,
  };
  return {
    schemaVersion: 1,
    name: "worker-smoke-v1",
    runConfig,
    masterSeeds: [101, 202],
    familyIds: ["local-trace"],
    methods: ["adaptive-revisable-grammar", "frozen-grammar-information-gain"],
    withheldPrograms: [],
    ...overrides,
  };
}

test("reportsMonotoneSeedProgress", async () => {
  const { runExperimentJob } = requireEngine();
  const progress = [];
  const result = await runExperimentJob({
    jobId: "progress-job",
    config: makeJobConfig(),
    onProgress: (event) => progress.push(event),
    isCancelled: () => false,
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(progress.map((event) => event.completedSeedBlocks), [1, 2]);
  assert.ok(progress.every((event) => event.totalSeedBlocks === 2));
  assert.equal(typeof result.publicReceipt, "string");
  assert.equal(JSON.stringify(result).toLowerCase().includes("auditor"), false);
});

test("cancelsBetweenSeedBlocks", async () => {
  const { runExperimentJob } = requireEngine();
  let progressCount = 0;
  const result = await runExperimentJob({
    jobId: "cancel-job",
    config: makeJobConfig(),
    onProgress: () => { progressCount += 1; },
    isCancelled: () => progressCount > 0,
  });
  assert.equal(result.status, "cancelled");
  assert.equal(progressCount, 1);
});

test("cancelledJobHasNoSuccessReceipt", async () => {
  const { runExperimentJob } = requireEngine();
  const result = await runExperimentJob({
    jobId: "cancelled-no-receipt",
    config: makeJobConfig(),
    onProgress: () => {},
    isCancelled: () => true,
  });
  assert.equal(result.status, "cancelled");
  assert.equal("publicReceipt" in result, false);
  assert.notEqual(result.claimStatus, "confirmatory");
});

test("invalidConfigDoesNotStartWork", async () => {
  const { runExperimentJob } = requireEngine();
  let progressCount = 0;
  const config = makeJobConfig({ masterSeeds: [101] });
  const result = await runExperimentJob({
    jobId: "invalid-job",
    config,
    onProgress: () => { progressCount += 1; },
    isCancelled: () => false,
  });
  assert.equal(result.status, "invalid");
  assert.equal(progressCount, 0);
  assert.ok(result.diagnostic.length > 0);
});

test("failurePreservesDiagnostic", async () => {
  const { runExperimentJob } = requireEngine();
  const result = await runExperimentJob({
    jobId: "diagnostic-job",
    config: makeJobConfig(),
    onProgress: () => { throw new Error("progress sink failed"); },
    isCancelled: () => false,
  });
  assert.equal(result.status, "failed");
  assert.match(result.diagnostic, /progress sink failed/);
  assert.equal("publicReceipt" in result, false);
});

test("adaptiveMethodSeesOnlyEarlierCompletedBlocks", async () => {
  const { runExperimentJob } = requireEngine();
  const result = await runExperimentJob({
    jobId: "history-job",
    config: makeJobConfig(),
    onProgress: () => {},
    isCancelled: () => false,
  });
  assert.equal(result.status, "completed");
  const { value: receipt } = await receiptModule.validateReceipt(result.publicReceipt);
  const adaptiveRows = receipt.rows.filter((row) => row.methodId === "adaptive-revisable-grammar")
    .sort((left, right) => left.seedBlockIndex - right.seedBlockIndex);
  assert.ok(adaptiveRows[0].compilerHistory.length === 0);
  assert.ok(adaptiveRows[1].compilerHistory.length > 0);
});

test("workerMessageAdapterCancelsAnActiveJobWithoutPostingAReceipt", async () => {
  const { attachExperimentWorker } = await import("../../src/worker/worker-entry.js");
  const messages = [];
  let resolveFirstProgress;
  const firstProgress = new Promise((resolve) => { resolveFirstProgress = resolve; });
  const scope = {
    postMessage(message) {
      messages.push(message);
      if (message.type === "progress") resolveFirstProgress(message);
    },
    addEventListener(type, handler) {
      assert.equal(type, "message");
      this.messageHandler = handler;
    },
  };
  const handleMessage = attachExperimentWorker(scope);
  const running = handleMessage({ data: { type: "start", jobId: "adapter-job", config: makeJobConfig() } });
  await firstProgress;
  await handleMessage({ data: { type: "cancel", jobId: "adapter-job" } });
  await running;
  const result = messages.find((message) => message.type === "result");
  assert.equal(result.status, "cancelled");
  assert.equal("publicReceipt" in result, false);
});
