import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RUN_CONFIG } from "../../src/core/config.js";
import { createBenchmarkCase, trainSubject } from "../../src/core/subject.js";
import { forkSubject } from "../../src/core/snapshot.js";
import { randomForEvent } from "../../src/core/random.js";

const assayModule = await import("../../src/core/assay.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

function requireAssay() {
  assert.ok(assayModule, "expected src/core/assay.js to export runAssayProgram");
  return assayModule;
}

function makeArms({ seed = 47, ruleId = "rule-assay" } = {}) {
  const { subject } = createBenchmarkCase({
    seed,
    config: DEFAULT_RUN_CONFIG,
    mechanismId: "distributed-trace",
    ruleId,
  });
  const trained = trainSubject(subject, { episodes: 128 }).subject;
  return {
    treatment: { armId: "treatment", subject: forkSubject(trained), activeSilences: [] },
    control: { armId: "control", subject: forkSubject(trained), activeSilences: [] },
  };
}

const eventContext = { masterSeed: 47, batchId: "assay-tests" };

function run(arms, operations = [], config = DEFAULT_RUN_CONFIG, programId = "assay-test") {
  const { runAssayProgram } = requireAssay();
  return runAssayProgram({
    arms,
    program: { programId, operations },
    config,
    eventContext,
  });
}

test("recordsBeforeAfterAndTransferRows", () => {
  const result = run(makeArms());
  for (const armId of ["treatment", "control"]) {
    const record = result.observations[armId];
    for (const stage of ["before", "afterRegrowth", "transfer"]) {
      assert.equal(record[stage].rows.length, DEFAULT_RUN_CONFIG.measurementTrials);
      assert.equal(record[stage].accuracy, stage === "transfer" ? 0 : 1);
      assert.ok(["retained", "partial", "lost"].includes(record[stage].category));
      assert.ok(record[stage].rows.every((row) => row.armId === armId && row.stage === stage));
    }
  }
  assert.equal(result.rawRows.length, DEFAULT_RUN_CONFIG.measurementTrials * 2 * 3);
  assert.equal(result.status, "completed");
});

test("executesDelayBeforeLaterOperation", () => {
  const arms = makeArms();
  const beforeSteps = Object.fromEntries(Object.entries(arms).map(([id, arm]) => [id, arm.subject.step]));
  const result = run(arms, [
    { type: "delay", ticks: 2, atTick: 0 },
    { type: "lesion", armId: "treatment", region: "body", fraction: 0.25, atTick: 2 },
  ]);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.operationReceipts.map((receipt) => receipt.type), ["delay", "lesion"]);
  assert.equal(result.arms.treatment.subject.step, beforeSteps.treatment + 2);
  assert.equal(result.arms.control.subject.step, beforeSteps.control + 2);
  assert.ok(result.arms.treatment.subject.grid.cells.some((cell) => !cell.alive));
});

test("regrowsOnlyAfterRegrowOperation", () => {
  const withoutRegrow = run(makeArms(), [
    { type: "lesion", armId: "treatment", region: "body", fraction: 0.2, atTick: 0 },
  ], DEFAULT_RUN_CONFIG, "lesion-only");
  const withRegrow = run(makeArms(), [
    { type: "lesion", armId: "treatment", region: "body", fraction: 0.2, atTick: 0 },
    { type: "regrow", armId: "treatment", ticks: 2, atTick: 0 },
  ], DEFAULT_RUN_CONFIG, "lesion-regrow");
  const deadWithout = withoutRegrow.arms.treatment.subject.grid.cells.filter((cell) => !cell.alive).length;
  const deadWith = withRegrow.arms.treatment.subject.grid.cells.filter((cell) => !cell.alive).length;
  assert.ok(deadWithout > 0);
  assert.ok(deadWith < deadWithout);
  assert.equal(withRegrow.arms.control.subject.grid.cells.every((cell) => cell.alive), true);
});

test("regrowthUsesSurvivingNeighborhoodAndRule", () => {
  const arms = makeArms();
  const subject = arms.treatment.subject;
  const liveNeighbors = [12, 14];
  subject.grid.cells.forEach((cell, index) => {
    cell.alive = liveNeighbors.includes(index);
    if (cell.alive) cell.channels.trace = index === 12 ? [0, 0, 0, 0] : [9, 9, 9, 9];
  });
  subject.grid.cells[13].alive = false;
  const protocol = [{ type: "regrow", armId: "treatment", ticks: 1, atTick: 0 }];
  const first = run(arms, protocol, DEFAULT_RUN_CONFIG, "regrow-tie");
  const second = run(arms, protocol, DEFAULT_RUN_CONFIG, "regrow-tie");
  assert.ok([0, 9].includes(first.arms.treatment.subject.grid.cells[13].channels.trace[0]));
  assert.deepEqual(first.arms.treatment.subject.grid.cells[13].channels.trace,
    second.arms.treatment.subject.grid.cells[13].channels.trace);
  assert.equal(first.arms.treatment.subject.grid.cells[13].alive, true);
});

test("frozenDevelopmentRuleResolvesRegrowthTiesDeterministically", () => {
  const firstRuleId = "rule-tie-left";
  const programId = "regrow-rule-tie";
  const tieDraw = (ruleId) => randomForEvent(47, [
    "assay-v1", 47, "assay-tests", 0, "regrow", 0, "regrow",
    "development-rule", ruleId, "regrow", 0, 13, "trace", 0, "tie",
  ]);
  let secondRuleId = "rule-tie-0";
  while ((tieDraw(firstRuleId) < 0.5) === (tieDraw(secondRuleId) < 0.5)) {
    secondRuleId = `rule-tie-${Number(secondRuleId.split("-").at(-1)) + 1}`;
  }
  const runTie = (ruleId) => {
    const arms = makeArms({ ruleId });
    const subject = arms.treatment.subject;
    subject.grid.cells.forEach((cell, index) => {
      cell.alive = index === 12 || index === 14;
      if (cell.alive) cell.channels.trace = index === 12 ? [0, 0, 0, 0] : [9, 9, 9, 9];
    });
    return run(arms, [{ type: "regrow", armId: "treatment", ticks: 1, atTick: 0 }], DEFAULT_RUN_CONFIG, programId)
      .arms.treatment.subject.grid.cells[13].channels.trace[0];
  };
  assert.equal(runTie(firstRuleId), tieDraw(firstRuleId) < 0.5 ? 0 : 9);
  assert.equal(runTie(secondRuleId), tieDraw(secondRuleId) < 0.5 ? 0 : 9);
  assert.notEqual(runTie(firstRuleId), runTie(secondRuleId));
});

test("contextShiftUsesLockedCueMapping", () => {
  const result = run(makeArms(), [
    { type: "context-shift", armId: "treatment", cueToAction: [1, 0], atTick: 0 },
  ]);
  const transfer = result.observations.treatment.transfer;
  assert.deepEqual(transfer.cueToAction, [1, 0]);
  assert.ok(transfer.rows.every((row) => row.targetAction === 1 - row.cue));
  assert.deepEqual(result.arms.treatment.subject.task.cueToAction, [0, 1]);
});

test("invalidOperationDoesNotDisappear", () => {
  const arms = makeArms();
  const before = structuredClone(arms);
  const result = run(arms, [
    { type: "lesion", armId: "missing", region: "body", fraction: 0.5, atTick: 0 },
    { type: "delay", ticks: 2, atTick: 0 },
  ]);
  assert.equal(result.status, "invalid");
  assert.equal(result.operationReceipts.length, 1);
  assert.equal(result.operationReceipts[0].status, "invalid");
  assert.equal(result.operationReceipts[0].reasonCode, "unknown_arm");
  assert.ok(result.operationReceipts.every((receipt) => receipt.status !== "applied"));
  assert.deepEqual(result.arms, before);
});

test("allArmsSharePreInterventionState", () => {
  const arms = makeArms();
  const before = structuredClone(arms);
  const result = run(arms, [
    { type: "lesion", armId: "treatment", region: "body", fraction: 0.25, atTick: 0 },
  ]);
  const treatmentRows = result.observations.treatment.before.rows.map(({ armId, ...row }) => row);
  const controlRows = result.observations.control.before.rows.map(({ armId, ...row }) => row);
  assert.equal(result.observations.treatment.before.accuracy, result.observations.control.before.accuracy);
  assert.deepEqual(treatmentRows, controlRows);
  assert.deepEqual(arms, before, "assay execution does not mutate caller-owned arms");
  assert.deepEqual(result.arms.control.subject, before.control.subject);
  assert.notDeepEqual(result.arms.treatment.subject, before.treatment.subject);
});
