import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RUN_CONFIG } from "../../src/core/config.js";
import { createBenchmarkCase, trainSubject } from "../../src/core/subject.js";
import { forkSubject } from "../../src/core/snapshot.js";

const interventionModule = await import("../../src/core/interventions.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

function requireInterventions() {
  assert.ok(interventionModule, "expected src/core/interventions.js to export the typed assay API");
  return interventionModule;
}

function makeArms() {
  const { subject } = createBenchmarkCase({
    seed: 43,
    config: DEFAULT_RUN_CONFIG,
    mechanismId: "distributed-trace",
    ruleId: "rule-assay-a",
  });
  const trained = trainSubject(subject, { episodes: 64 }).subject;
  return {
    treatment: { armId: "treatment", subject: forkSubject(trained), activeSilences: [] },
    control: { armId: "control", subject: forkSubject(trained), activeSilences: [] },
  };
}

const operations = [
  { type: "lesion", armId: "treatment", region: "body", fraction: 0.25, atTick: 0 },
  { type: "silence", armId: "treatment", channel: "trace", durationTicks: 3, atTick: 0 },
  { type: "scramble", armId: "treatment", region: "body", channel: "trace", intensity: 1, atTick: 0 },
  {
    type: "transplant",
    sourceArm: "treatment",
    targetArm: "control",
    patch: { x: 0, y: 1, width: 2, height: 1 },
    channel: "trace",
    atTick: 0,
  },
  { type: "delay", ticks: 2, atTick: 0 },
  { type: "regrow", armId: "treatment", ticks: 2, atTick: 0 },
  { type: "context-shift", armId: "treatment", cueToAction: [1, 0], atTick: 0 },
  { type: "sham", armId: "control", region: "body", durationTicks: 2, atTick: 0 },
];

test("acceptsAllEightTypedOperations", () => {
  const { validateAssayProgram, validateIntervention } = requireInterventions();
  for (const operation of operations) {
    assert.equal(validateIntervention(operation, ["treatment", "control"]).ok, true, operation.type);
  }
  const program = { programId: "four-op", operations: operations.slice(0, 4) };
  assert.equal(validateAssayProgram(program, DEFAULT_RUN_CONFIG).ok, true);
});

test("rejectsFifthOperationAndUnknownType", () => {
  const { validateAssayProgram, validateIntervention } = requireInterventions();
  assert.equal(validateAssayProgram({ programId: "too-long", operations }, DEFAULT_RUN_CONFIG).ok, false);
  assert.equal(validateIntervention({ type: "execute-code", source: "anything" }, ["treatment"]).ok, false);
});

test("lesionChangesOnlyNamedClone", () => {
  const { applyOperation } = requireInterventions();
  const arms = makeArms();
  const beforeControl = structuredClone(arms.control.subject);
  const result = applyOperation(arms, operations[0], { masterSeed: 3, programId: "lesion", operationIndex: 0 });
  assert.equal(result.operationReceipt.status, "applied");
  assert.ok(result.operationReceipt.affectedCells > 0);
  assert.ok(result.arms.treatment.subject.grid.cells.some((cell) => !cell.alive));
  assert.deepEqual(result.arms.control.subject, beforeControl);
  assert.deepEqual(arms.treatment.subject, makeArms().treatment.subject, "the input arm map remains unchanged");
});

test("silenceBlocksNamedChannelForDuration", () => {
  const { applyOperation } = requireInterventions();
  const arms = makeArms();
  const before = arms.treatment.subject.grid.cells.map((cell) => [...cell.channels.trace]);
  const result = applyOperation(arms, operations[1], { masterSeed: 2, programId: "silence", operationIndex: 1 });
  assert.deepEqual(result.arms.treatment.subject.grid.cells.map((cell) => cell.channels.trace), before);
  assert.equal(result.arms.treatment.activeSilences.length, 1);
  assert.equal(result.arms.treatment.activeSilences[0].channel, "trace");
  assert.equal(result.arms.treatment.activeSilences[0].untilTick, 3);
  assert.equal(result.arms.control.activeSilences.length, 0);
});

test("scramblePreservesValueHistogram", () => {
  const { applyOperation } = requireInterventions();
  const arms = makeArms();
  for (const cell of arms.treatment.subject.grid.cells.filter((item) => item.region === "body")) {
    cell.channels.trace = [cell.index, cell.index + 1, cell.index + 2, cell.index + 3];
  }
  const before = arms.treatment.subject.grid.cells
    .filter((cell) => cell.region === "body")
    .flatMap((cell) => cell.channels.trace)
    .sort((a, b) => a - b);
  const result = applyOperation(arms, operations[2], { masterSeed: 4, programId: "scramble", operationIndex: 2 });
  const after = result.arms.treatment.subject.grid.cells
    .filter((cell) => cell.region === "body")
    .flatMap((cell) => cell.channels.trace)
    .sort((a, b) => a - b);
  assert.deepEqual(after, before);
});

test("transplantSwapsNamedPatchOnly", () => {
  const { applyOperation } = requireInterventions();
  const arms = makeArms();
  const source = arms.treatment.subject.grid.cells[12];
  const target = arms.control.subject.grid.cells[12];
  source.channels.trace = [1, 2, 3, 4];
  target.channels.trace = [11, 12, 13, 14];
  const sourceOutside = arms.treatment.subject.grid.cells[20].channels.trace;
  const targetOutside = arms.control.subject.grid.cells[20].channels.trace;
  const result = applyOperation(arms, operations[3], { masterSeed: 5, programId: "transplant", operationIndex: 3 });
  assert.deepEqual(result.arms.treatment.subject.grid.cells[12].channels.trace, [11, 12, 13, 14]);
  assert.deepEqual(result.arms.control.subject.grid.cells[12].channels.trace, [1, 2, 3, 4]);
  assert.deepEqual(result.arms.treatment.subject.grid.cells[20].channels.trace, sourceOutside);
  assert.deepEqual(result.arms.control.subject.grid.cells[20].channels.trace, targetOutside);
});

test("shamPreservesStateAndTiming", () => {
  const { applyOperation } = requireInterventions();
  const arms = makeArms();
  const before = structuredClone(arms.control.subject);
  const result = applyOperation(arms, operations[7], { masterSeed: 6, programId: "sham", operationIndex: 7 });
  assert.deepEqual(result.arms.control.subject.grid, before.grid);
  assert.equal(result.arms.control.subject.step, before.step + 2);
  assert.equal(result.arms.control.subject.development.age, before.development.age + 2);
  assert.equal(result.operationReceipt.elapsedTicks, 2);
});

test("invalidTargetProducesExplicitReceipt", () => {
  const { applyOperation } = requireInterventions();
  const arms = makeArms();
  const before = structuredClone(arms);
  const result = applyOperation(arms, { ...operations[0], armId: "missing" }, {
    masterSeed: 7,
    programId: "invalid",
    operationIndex: 0,
  });
  assert.equal(result.operationReceipt.status, "invalid");
  assert.equal(typeof result.operationReceipt.reasonCode, "string");
  assert.deepEqual(result.arms, before);
});

test("rejectsUnknownFieldsAndIntervalsPastRunLimit", () => {
  const { validateIntervention, validateAssayProgram } = requireInterventions();
  assert.equal(validateIntervention({ ...operations[0], script: "nope" }, ["treatment", "control"]).ok, false);
  assert.equal(validateAssayProgram({
    programId: "over-time",
    operations: [{ type: "delay", ticks: 2, atTick: 0 }],
  }, { ...DEFAULT_RUN_CONFIG, maxTicks: 1 }).ok, false);
});

test("eventKeyMakesCellSelectionDeterministic", () => {
  const { applyOperation } = requireInterventions();
  const arms = makeArms();
  const context = { masterSeed: 909, programId: "deterministic-lesion", operationIndex: 0 };
  const first = applyOperation(arms, operations[0], context);
  const second = applyOperation(arms, operations[0], context);
  const changedKey = applyOperation(arms, operations[0], { ...context, operationIndex: 1 });
  assert.deepEqual(first.arms, second.arms);
  assert.notDeepEqual(
    first.arms.treatment.subject.grid.cells.map((cell) => cell.alive),
    changedKey.arms.treatment.subject.grid.cells.map((cell) => cell.alive),
  );
});

test("regrowUsesSurvivingNeighborConsensus", () => {
  const { applyOperation } = requireInterventions();
  const arms = makeArms();
  const treatment = arms.treatment.subject;
  treatment.grid.cells[13].alive = false;
  treatment.grid.cells[14].alive = false;
  for (const cell of treatment.grid.cells) {
    if (cell.alive) cell.channels.trace = [7, 3, 9, 1];
  }
  const result = applyOperation(arms, operations[5], {
    masterSeed: 13,
    programId: "regrow",
    operationIndex: 0,
  });
  assert.equal(result.operationReceipt.status, "applied");
  assert.equal(result.operationReceipt.affectedCells, 2);
  assert.deepEqual(result.arms.treatment.subject.grid.cells[13].channels.trace, [7, 3, 9, 1]);
  assert.deepEqual(result.arms.treatment.subject.grid.cells[14].channels.trace, [7, 3, 9, 1]);
});

test("silenceIsActiveOnHalfOpenDeclaredInterval", () => {
  const { applyOperation, isChannelSilenced } = requireInterventions();
  const result = applyOperation(makeArms(), operations[1], {
    masterSeed: 3,
    programId: "silence-window",
    operationIndex: 0,
  });
  assert.equal(typeof isChannelSilenced, "function");
  assert.equal(isChannelSilenced(result.arms.treatment, "trace", 0), true);
  assert.equal(isChannelSilenced(result.arms.treatment, "trace", 2), true);
  assert.equal(isChannelSilenced(result.arms.treatment, "trace", 3), false);
});
