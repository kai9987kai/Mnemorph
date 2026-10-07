import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_RUN_CONFIG } from "../../src/core/config.js";

const receiptModule = await import("../../src/core/receipt.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});
const experimentModule = await import("../../src/core/experiment.js");

function requireReceipt() {
  assert.ok(receiptModule, "expected src/core/receipt.js to export the receipt API");
  return receiptModule;
}

const receiptConfig = {
  ...DEFAULT_RUN_CONFIG,
  gridWidth: 8,
  gridHeight: 8,
  trainingEpisodes: 128,
  measurementTrials: 8,
  seedBlockCount: 1,
  candidateEvaluationsPerBatch: 4,
  protocolLengthCap: 2,
};

let batchPromise;
function batch() {
  batchPromise ??= experimentModule.runMatchedBatch({
    config: receiptConfig,
    masterSeeds: [81],
    familyIds: ["local-trace"],
    withheldPrograms: [{
      programId: "withheld-transfer",
      operations: [{ type: "context-shift", armId: "treatment", cueToAction: [1, 0], atTick: 0 }],
    }],
  });
  return batchPromise;
}

function lockedPlan(overrides = {}) {
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
    pilotRuleFamilyIds: ["pilot-rule"],
    confirmatoryRuleFamilyIds: ["heldout-rule"],
    stoppingRule: "fixed-n-no-peeking",
    primaryComparison: {
      methodA: "adaptive-revisable-grammar",
      methodB: "frozen-grammar-information-gain",
      metric: "brier",
      difference: "methodA-minus-methodB",
    },
    budgets: { assayCount: 1, candidateEvaluationsPerBatch: 4, protocolLengthCap: 2 },
    withheldAssayHash: "a".repeat(64),
    heldOutRuleFamilies: ["heldout-rule"],
    transferContexts: ["reversed-cue-map"],
    nullClaimRateMax: 0.05,
    thresholds: { maxCalibrationBrier: 0.25 },
    ...overrides,
  };
}

function confirmatoryResults() {
  const primaryResults = [];
  for (const [index, seedBlockId] of ["c1", "c2", "c3", "c4"].entries()) {
    primaryResults.push({ methodId: "adaptive-revisable-grammar", seedBlockId, brierScore: 0.12 + index * 0.005 });
    primaryResults.push({ methodId: "frozen-grammar-information-gain", seedBlockId, brierScore: 0.32 + index * 0.005 });
  }
  return {
    primaryResults,
    heldOutRuleFamilyIds: ["heldout-rule"],
    heldOutRuleDifferences: [-0.12, -0.11, -0.13, -0.1],
    transferContexts: ["reversed-cue-map"],
    transferContextDifferences: [-0.1, -0.12, -0.11, -0.13],
    nullControl: { claimCount: 0, trialCount: 100 },
    calibration: { brierScores: [0.12, 0.18, 0.15, 0.16] },
  };
}

test("receiptRetainsRawRowsAndProvenance", async () => {
  const { createPublicReceipt } = requireReceipt();
  const result = await batch();
  const receipt = await createPublicReceipt(result);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.claimStatus, "exploratory");
  assert.equal(receipt.source.version, "0.1.0");
  assert.match(receipt.source.hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(receipt.compilerVersion, "bounded-assay-compiler-v1");
  assert.equal(receipt.randomizationMethod, "event-keyed-v1");
  assert.deepEqual(receipt.config, result.config);
  assert.deepEqual(receipt.seedKeys, result.masterSeeds);
  assert.ok(receipt.snapshots.length > 0);
  assert.ok(receipt.snapshots.every((snapshot) => snapshot.snapshot && snapshot.snapshotHash));
  assert.ok(receipt.rows.some((row) => row.selectedPrediction));
  assert.ok(receipt.rawRows.length > 0);
  assert.equal(receipt.rawRows.length, result.publicRows.reduce((count, row) => count + (row.assay?.rawRows?.length ?? 0), 0));
  assert.ok(receipt.rawRows.every((row) => Array.isArray(row) && row.length === 10));
  assert.ok(receipt.rows.every((row) => row.assay?.rawRows === undefined));
  assert.deepEqual(receipt.rawRowEncoding.methods, result.methods);
  assert.ok(receipt.outcomes.length > 0);
  assert.deepEqual(receipt.failures, []);
  for (const snapshot of receipt.snapshots) {
    assert.equal(snapshot.snapshot.includes("local-trace"), false, "snapshot must not expose the hidden family label");
  }
});

test("auditorRecordIsSeparateFromPublicReceipt", async () => {
  const { createPublicReceipt, createAuditorRecord } = requireReceipt();
  const result = await batch();
  const receipt = await createPublicReceipt(result);
  const auditor = createAuditorRecord(result);
  assert.equal(JSON.stringify(receipt).toLowerCase().includes("auditorrows"), false);
  assert.equal(JSON.stringify(receipt).toLowerCase().includes("mechanismid"), false);
  assert.ok(auditor.auditorRows.some((row) => row.mechanismId === "local-trace"));
  assert.equal(auditor.experimentId, receipt.experimentId);
});

test("sealAndValidateRoundTrip", async () => {
  const { createPublicReceipt, sealReceipt, validateReceipt } = requireReceipt();
  const { canonicalJson, sha256Hex } = await import("../../src/core/snapshot.js");
  const receipt = await createPublicReceipt(await batch());
  const sealedText = await sealReceipt(receipt);
  const sealed = JSON.parse(sealedText);
  const { digest, ...payload } = sealed;
  assert.equal(digest.algorithm, "SHA-256");
  assert.equal(digest.value, await sha256Hex(canonicalJson(payload)));
  const validation = await validateReceipt(sealedText);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.value, sealed);
});

test("rejectsDigestSchemaAndSizeMismatch", async () => {
  const { createPublicReceipt, sealReceipt, validateReceipt } = requireReceipt();
  const sealed = JSON.parse(await sealReceipt(await createPublicReceipt(await batch())));
  sealed.rows[0].status = "tampered";
  assert.equal((await validateReceipt(JSON.stringify(sealed))).ok, false);
  const wrongSchema = JSON.parse(await sealReceipt(await createPublicReceipt(await batch())));
  wrongSchema.schemaVersion = 99;
  const schemaResult = await validateReceipt(JSON.stringify(wrongSchema));
  assert.equal(schemaResult.ok, false);
  assert.ok(schemaResult.errors.includes("receipt_schema_version_unsupported"));
  const oversize = `{"padding":"${"x".repeat(2 * 1024 * 1024)}"}`;
  const sizeResult = await validateReceipt(oversize);
  assert.equal(sizeResult.ok, false);
  assert.ok(sizeResult.errors.includes("receipt_size_exceeded"));
});

test("importFailureLeavesSessionReferenceUnchanged", async () => {
  const { createPublicReceipt, sealReceipt, importReceiptIntoSession } = requireReceipt();
  const valid = JSON.parse(await sealReceipt(await createPublicReceipt(await batch())));
  valid.rows[0].status = "tampered";
  const text = JSON.stringify(valid);
  const session = { receipts: [], selectedReceiptId: null };
  const outcome = await importReceiptIntoSession(text, session);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.session, session);
  assert.deepEqual(session, { receipts: [], selectedReceiptId: null });
});

test("claimStatusUsesLockedCriteria", async () => {
  const { createPublicReceipt } = requireReceipt();
  const base = await batch();
  const unlocked = await createPublicReceipt({
    ...base,
    confirmatoryPlan: lockedPlan({ locked: false }),
    confirmatoryResults: confirmatoryResults(),
  });
  const locked = await createPublicReceipt({
    ...base,
    confirmatoryPlan: lockedPlan(),
    confirmatoryResults: confirmatoryResults(),
  });
  assert.equal(unlocked.claimStatus, "exploratory");
  assert.equal(locked.claimStatus, "confirmatory");
  assert.equal(locked.confirmatoryAnalysis.status, "confirmatory_success");
});

test("receiptSchemaDeclaresVersionedSizeBoundAndAuditorSeparation", async () => {
  const schema = JSON.parse(await readFile(new URL("../../schemas/receipt-v1.json", import.meta.url), "utf8"));
  assert.equal(schema.$id, "mnemorph/receipt-v1");
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.equal(schema.properties.receiptType.const, "public-run");
  assert.equal(schema.properties.claimStatus.enum.includes("confirmatory"), true);
  assert.equal(schema.properties.auditorRows, undefined);
  assert.equal(schema.maxBytes, 2 * 1024 * 1024);
});
