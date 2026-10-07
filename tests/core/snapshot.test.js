import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RUN_CONFIG } from "../../src/core/config.js";
import { createBenchmarkCase, trainSubject } from "../../src/core/subject.js";

const snapshotModule = await import("../../src/core/snapshot.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

function requireSnapshots() {
  assert.ok(snapshotModule, "expected src/core/snapshot.js to export the snapshot API");
  return snapshotModule;
}

function freshTrainedSubject(episodes = 12) {
  const { subject } = createBenchmarkCase({
    seed: 314,
    config: DEFAULT_RUN_CONFIG,
    mechanismId: "distributed-trace",
    ruleId: "rule-snapshot-a",
  });
  return trainSubject(subject, { episodes }).subject;
}

test("snapshotRestoreContinuesBitExactly", () => {
  const { restoreSubjectSnapshot, snapshotSubject } = requireSnapshots();
  const { subject: initial } = createBenchmarkCase({
    seed: 314,
    config: DEFAULT_RUN_CONFIG,
    mechanismId: "distributed-trace",
    ruleId: "rule-snapshot-a",
  });
  const uninterrupted = trainSubject(initial, { episodes: 24 }).subject;
  const firstSegment = trainSubject(initial, { episodes: 12 }).subject;
  const restored = restoreSubjectSnapshot(snapshotSubject(firstSegment));
  const continued = trainSubject(restored, { episodes: 12 }).subject;
  assert.deepEqual(continued, uninterrupted);
  assert.equal(continued.randomness.eventCounter, 24);
});

test("forksStartFromEqualStateButAreIndependent", () => {
  const { forkSubject } = requireSnapshots();
  const subject = freshTrainedSubject();
  const treatment = forkSubject(subject);
  const control = forkSubject(subject);
  assert.deepEqual(treatment, control);
  treatment.grid.cells[0].channels.trace[0] += 10;
  assert.notEqual(treatment.grid.cells[0].channels.trace[0], control.grid.cells[0].channels.trace[0]);
  assert.notEqual(treatment.grid.cells[0].channels.trace[0], subject.grid.cells[0].channels.trace[0]);
});

test("rejectsTruncatedUnknownVersionAndOversizedSnapshots", () => {
  const { restoreSubjectSnapshot, snapshotSubject } = requireSnapshots();
  const valid = snapshotSubject(freshTrainedSubject());
  assert.throws(() => restoreSubjectSnapshot(valid.slice(0, -3)));
  const unknown = JSON.parse(valid);
  unknown.schemaVersion = 99;
  assert.throws(() => restoreSubjectSnapshot(JSON.stringify(unknown)));
  assert.throws(() => restoreSubjectSnapshot(" ".repeat(2 * 1024 * 1024 + 1)));
});

test("canonicalJsonIgnoresObjectInsertionOrder", () => {
  const { canonicalJson } = requireSnapshots();
  assert.equal(
    canonicalJson({ z: 1, nested: { b: true, a: [2, 1] }, a: "x" }),
    canonicalJson({ a: "x", nested: { a: [2, 1], b: true }, z: 1 }),
  );
  assert.throws(() => canonicalJson({ value: Number.NaN }));
  assert.throws(() => canonicalJson({ value: undefined }));
});

test("digestChangesWhenSnapshotChanges", async () => {
  const { canonicalJson, sha256Hex } = requireSnapshots();
  const first = await sha256Hex(canonicalJson({ value: 1 }));
  const second = await sha256Hex(canonicalJson({ value: 2 }));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});
