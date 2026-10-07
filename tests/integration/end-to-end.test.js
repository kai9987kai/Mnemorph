import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_RUN_CONFIG } from "../../src/core/config.js";
import { createAuditorRecord, createPublicReceipt, decodeRawRows, importReceiptIntoSession, sealReceipt, validateReceipt } from "../../src/core/receipt.js";
import { createSessionState, reduceSession } from "../../src/ui/session.js";
import { runExperimentBatch, runExperimentJob } from "../../src/worker/experiment-engine.js";

const MASTER_SEEDS = [111, 222];
const FAMILY_IDS = ["local-trace", "regenerative-reconstruction"];
const METHODS = ["adaptive-revisable-grammar", "frozen-grammar-information-gain"];
const WITHHELD = [{
  programId: "acceptance-transfer-context",
  operations: [{ type: "context-shift", armId: "treatment", cueToAction: [1, 0], atTick: 0 }],
}];

async function smallRunConfig() {
  return {
    schemaVersion: 1,
    name: "end-to-end-acceptance-v1",
    runConfig: {
      ...DEFAULT_RUN_CONFIG,
      gridWidth: 8,
      gridHeight: 8,
      trainingEpisodes: 128,
      measurementTrials: 4,
      seedBlockCount: MASTER_SEEDS.length,
      candidateEvaluationsPerBatch: 4,
      protocolLengthCap: 2,
    },
    masterSeeds: [...MASTER_SEEDS],
    familyIds: [...FAMILY_IDS],
    methods: [...METHODS],
    withheldPrograms: structuredClone(WITHHELD),
  };
}

async function execute(config) {
  const result = await runExperimentBatch({ jobId: "end-to-end", config: config ?? await smallRunConfig() });
  assert.equal(result.status, "completed", result.diagnostic);
  return result.batchResult;
}

function stableReceipt(receipt) {
  const { createdAt: _createdAt, digest: _digest, ...stable } = receipt;
  return stable;
}

test("smokeRunReplaysExactly", async () => {
  const config = await smallRunConfig();
  const [first, second] = await Promise.all([execute(config), execute(config)]);
  const [firstReceipt, secondReceipt] = await Promise.all([
    createPublicReceipt(first),
    createPublicReceipt(second),
  ]);
  assert.deepEqual(stableReceipt(firstReceipt), stableReceipt(secondReceipt));
  assert.deepEqual(decodeRawRows(firstReceipt), decodeRawRows(secondReceipt));
});

test("bundledSmokeReceiptFitsExportImportLimit", async () => {
  const config = JSON.parse(await readFile(new URL("../../configs/benchmark-smoke.json", import.meta.url), "utf8"));
  const result = await runExperimentJob({ jobId: "bundled-smoke-export", config });
  assert.equal(result.status, "completed", result.diagnostic);
  assert.ok(Buffer.byteLength(result.publicReceipt, "utf8") <= 2 * 1024 * 1024);
  const imported = await validateReceipt(result.publicReceipt);
  assert.equal(imported.ok, true, imported.errors.join(","));
});

test("adaptiveAndFrozenMethodsUseEqualBudgets", async () => {
  const batch = await execute();
  const adaptive = batch.publicRows.filter((row) => row.methodId === METHODS[0]);
  const frozen = batch.publicRows.filter((row) => row.methodId === METHODS[1]);
  assert.equal(adaptive.length, frozen.length);
  assert.ok(adaptive.length > 0);
  for (const [index, row] of adaptive.entries()) {
    const comparison = frozen[index];
    assert.equal(row.masterSeed, comparison.masterSeed);
    assert.equal(row.lineageId, comparison.lineageId);
    assert.equal(row.initialSnapshotHash, comparison.initialSnapshotHash);
    assert.deepEqual(
      [row.budget.assayCount, row.budget.candidateEvaluations, row.budget.protocolLengthCap],
      [comparison.budget.assayCount, comparison.budget.candidateEvaluations, comparison.budget.protocolLengthCap],
    );
    assert.ok(row.budget.candidateEvaluationsUsed <= row.budget.candidateEvaluations);
    assert.ok(comparison.budget.candidateEvaluationsUsed <= comparison.budget.candidateEvaluations);
  }
});

test("withheldPredictionsHaveAuditorOnlyScoring", async () => {
  const batch = await execute();
  const publicReceipt = await createPublicReceipt(batch);
  const auditor = createAuditorRecord(batch);
  const publicSnapshot = JSON.parse(publicReceipt.snapshots[0].snapshot);
  assert.ok(publicReceipt.rows.every((row) => row.withheldPredictions.length === 1));
  assert.ok(publicReceipt.rows.every((row) => row.withheldPredictions.every((item) => !("brierScore" in item) && !("observedCategory" in item))));
  assert.ok(publicSnapshot.wiring, "public replay state contains wiring and may support mechanism inference");
  assert.equal("mechanismId" in publicSnapshot, false);
  assert.ok(auditor.auditorRows.some((row) => row.withheldEvaluations.some((item) => typeof item.brierScore === "number")));
  assert.ok(auditor.auditorRows.some((row) => FAMILY_IDS.includes(row.mechanismId)));
  const publicText = JSON.stringify(publicReceipt);
  for (const hiddenField of ["mechanismId", "ruleFamilyId", "auditorRows", "withheldEvaluations", "brierScore"]) {
    assert.equal(publicText.includes(`\"${hiddenField}\"`), false, `${hiddenField} must remain auditor-only`);
  }
});

test("receiptImportRoundTripsWithoutMutationOnFailure", async () => {
  const batch = await execute();
  const text = await sealReceipt(await createPublicReceipt(batch));
  const validation = await validateReceipt(text);
  assert.equal(validation.ok, true);
  const initial = createSessionState();
  const imported = await importReceiptIntoSession(text, initial);
  assert.equal(imported.ok, true);
  assert.equal(imported.session.receipts.length, 1);
  assert.equal(initial.receipts.length, 0);

  const invalid = JSON.parse(text);
  invalid.digest.value = `${invalid.digest.value.slice(0, -1)}${invalid.digest.value.endsWith("0") ? "1" : "0"}`;
  const failed = await importReceiptIntoSession(JSON.stringify(invalid), imported.session);
  assert.equal(failed.ok, false);
  assert.strictEqual(failed.session, imported.session);
  assert.equal(imported.session.receipts.length, 1);
});

test("cancelledBrowserRunCannotBePromoted", async () => {
  const publicReceipt = await createPublicReceipt(await execute());
  let session = createSessionState();
  session = reduceSession(session, { type: "JOB_STARTED", jobId: "cancel-me", totalSeedBlocks: 2 });
  session = reduceSession(session, { type: "JOB_CANCELLED", jobId: "cancel-me" });
  const cancelled = session;
  session = reduceSession(session, { type: "JOB_COMPLETED", jobId: "cancel-me", status: "completed", receipt: publicReceipt });
  assert.strictEqual(session, cancelled);
  assert.equal(session.job.status, "cancelled");
  assert.equal(session.receipts.length, 0);
});
