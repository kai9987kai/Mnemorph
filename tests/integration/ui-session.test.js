import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_RUN_CONFIG } from "../../src/core/config.js";

const sessionModule = await import("../../src/ui/session.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});
const replayModule = await import("../../src/core/receipt.js");
const experimentModule = await import("../../src/core/experiment.js");

function requireSession() {
  assert.ok(sessionModule, "expected src/ui/session.js to export the session reducer");
  return sessionModule;
}

const smallConfig = {
  ...DEFAULT_RUN_CONFIG,
  gridWidth: 8,
  gridHeight: 8,
  trainingEpisodes: 128,
  measurementTrials: 8,
  seedBlockCount: 1,
  candidateEvaluationsPerBatch: 4,
  protocolLengthCap: 2,
};

let receiptPromise;
function receipt() {
  receiptPromise ??= (async () => {
    const batch = await experimentModule.runMatchedBatch({
      config: smallConfig,
      methods: [{
        id: "replay-method",
        kind: "fixed-one-factor",
        programs: [{
          programId: "exact-replay",
          operations: [{ type: "context-shift", armId: "treatment", cueToAction: [1, 0], atTick: 0 }],
        }],
      }],
      masterSeeds: [81],
      familyIds: ["local-trace"],
      withheldPrograms: [],
    });
    const publicReceipt = await replayModule.createPublicReceipt(batch);
    const text = await replayModule.sealReceipt(publicReceipt);
    const validation = await replayModule.validateReceipt(text);
    assert.equal(validation.ok, true);
    return validation.value;
  })();
  return receiptPromise;
}

test("cancelDoesNotPublishPartialReceipt", async () => {
  const { createSessionState, reduceSession } = requireSession();
  let state = createSessionState();
  state = reduceSession(state, { type: "JOB_STARTED", jobId: "cancel-ui" });
  state = reduceSession(state, {
    type: "JOB_PROGRESS", jobId: "cancel-ui", progress: { completedSeedBlocks: 1, totalSeedBlocks: 3 },
  });
  state = reduceSession(state, { type: "JOB_CANCELLED", jobId: "cancel-ui" });
  assert.equal(state.job.status, "cancelled");
  assert.deepEqual(state.receipts, []);
});

test("failedImportLeavesCurrentSessionIntact", async () => {
  const { createSessionState, reduceSession } = requireSession();
  let state = createSessionState();
  state = reduceSession(state, { type: "IMPORT_RECEIPT", receipt: await receipt() });
  const before = state;
  state = reduceSession(state, { type: "IMPORT_RECEIPT", receipt: { schemaVersion: 99, rows: [] } });
  assert.equal(state, before);
});

test("confirmatoryStatusRequiresAnalysisReceipt", async () => {
  const { createSessionState, reduceSession } = requireSession();
  let state = createSessionState();
  state = reduceSession(state, { type: "JOB_STARTED", jobId: "forged-confirmation" });
  state = reduceSession(state, {
    type: "JOB_COMPLETED",
    jobId: "forged-confirmation",
    status: "completed",
    receipt: { ...(await receipt()), claimStatus: "confirmatory", confirmatoryPlan: { locked: false } },
  });
  assert.equal(state.job.status, "failed");
  assert.equal(state.receipts.length, 0);
});

test("ledgerKeepsRawRowsForExport", async () => {
  const { createSessionState, reduceSession, selectVisibleReceipts } = requireSession();
  let state = createSessionState();
  state = reduceSession(state, { type: "IMPORT_RECEIPT", receipt: await receipt() });
  const visible = selectVisibleReceipts(state);
  assert.equal(visible.length, 1);
  assert.ok(visible[0].rawRows.length > 0);
  assert.deepEqual(visible[0].rawRowEncoding.fields, [
    "methodIndex", "seedBlockIndex", "armIndex", "stageIndex", "trial", "cue",
    "targetAction", "chosenAction", "correctBit", "contextIndex",
  ]);
});

test("replayUsesReceiptSnapshotProtocolAndSeed", async () => {
  const { createSessionState, reduceSession } = requireSession();
  const source = await receipt();
  let state = createSessionState();
  state = reduceSession(state, { type: "IMPORT_RECEIPT", receipt: source });
  state = reduceSession(state, {
    type: "REPLAY_RECEIPT",
    experimentId: source.experimentId,
    methodId: "replay-method",
    seedBlockIndex: 0,
  });
  assert.equal(state.replay.status, "ready");
  const row = source.rows.find((candidate) => candidate.methodId === "replay-method");
  const snapshot = source.snapshots.find((candidate) => candidate.seedBlockIndex === row.seedBlockIndex);
  assert.equal(state.replay.spec.snapshot, snapshot.snapshot);
  assert.deepEqual(state.replay.spec.protocol, row.selectedProgram);
  assert.equal(state.replay.spec.masterSeed, snapshot.masterSeed);

  const replay = await replayModule.replayReceiptAssay(source, "replay-method", 0);
  const expected = replayModule.decodeRawRows(source, { methodId: "replay-method", seedBlockIndex: 0 });
  assert.deepEqual(replay.rawRows, expected);
});

test("searchFiltersLedgerRows", async () => {
  const { createSessionState, reduceSession, selectVisibleReceipts } = requireSession();
  const original = await receipt();
  const alternate = structuredClone(original);
  alternate.experimentId = "mnemorph-alternate-run";
  alternate.rows[0].selectedProgram.programId = "another-protocol";
  let state = createSessionState();
  state = reduceSession(state, { type: "IMPORT_RECEIPT", receipt: original });
  state = reduceSession(state, { type: "IMPORT_RECEIPT", receipt: alternate });
  state = reduceSession(state, { type: "SET_LEDGER_QUERY", query: "another-protocol" });
  assert.deepEqual(selectVisibleReceipts(state).map((entry) => entry.experimentId), ["mnemorph-alternate-run"]);
});

test("allVisibleControlsHaveAccessibleNames", async () => {
  const html = await readFile(new URL("../../src/ui/index.html", import.meta.url), "utf8");
  const idLabels = new Set([...html.matchAll(/<label\b[^>]*\bfor=["']([^"']+)["']/gi)].map((match) => match[1]));
  for (const match of html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const attrs = match[2];
    const id = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
    const hasAccessibleName = /\baria-label=["'][^"']+/.test(attrs) || (id && idLabels.has(id));
    assert.ok(hasAccessibleName, `${match[1]} must have a label or aria-label`);
  }
  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const text = match[2].replace(/<[^>]*>/g, " ").trim();
    assert.ok(text || /\baria-label=["'][^"']+/.test(match[1]), "button must have visible text or aria-label");
  }
});

test("renderedUIUsesCspCompatibleStyleClasses", async () => {
  const view = await readFile(new URL("../../src/ui/view.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../../src/ui/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(view, /\bstyle=/);
  assert.match(view, /brightness-/);
  assert.match(view, /width-/);
  assert.match(styles, /\.columns-12\b/);
  assert.match(styles, /\.brightness-0\b/);
  assert.match(styles, /\.width-100\b/);
});

test("jsonExportUsesTheBoundedReceiptSerializer", async () => {
  const app = await readFile(new URL("../../src/ui/app.js", import.meta.url), "utf8");
  assert.match(app, /sealReceipt,\s*validateReceipt/);
  assert.match(app, /await sealReceipt\(receipt\)/);
  assert.doesNotMatch(app, /JSON\.stringify\(receipt,\s*null,\s*2\)/);
});
