import assert from "node:assert/strict";
import test from "node:test";

const randomModule = await import("../../src/core/random.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

function requireRandom() {
  assert.ok(randomModule, "expected src/core/random.js to export the deterministic random API");
  return randomModule;
}

test("replaysPrngFromSnapshot", () => {
  const { createRng } = requireRandom();
  const first = createRng(42);
  first.nextUint32();
  const state = first.snapshot();
  const expected = [first.nextUint32(), first.nextUint32(), first.nextFloat()];
  const resumed = createRng(42, state);
  assert.deepEqual([resumed.nextUint32(), resumed.nextUint32(), resumed.nextFloat()], expected);
});

test("eventDrawIsStableAcrossCallOrder", () => {
  const { randomForEvent } = requireRandom();
  const event = ["weather", "lineage-4", 17, "shared"];
  const expected = randomForEvent(9, event);
  randomForEvent(9, ["other", "lineage-4", 17, "shared"]);
  randomForEvent(9, ["weather", "lineage-4", 18, "shared"]);
  assert.equal(randomForEvent(9, event), expected);
});

test("sharedEventTupleHasNoArmComponent", () => {
  const { randomForEvent } = requireRandom();
  const sharedTuple = ["mnemorph-event-v1", 11, "lineage-3", 22, "rain"];
  const treatmentArm = "treatment";
  const controlArm = "control";
  assert.equal(sharedTuple.includes(treatmentArm), false);
  assert.equal(sharedTuple.includes(controlArm), false);
  assert.equal(randomForEvent(11, sharedTuple), randomForEvent(11, sharedTuple));
});

test("differentChannelsUseDifferentDraws", () => {
  const { randomForEvent } = requireRandom();
  const shared = ["mnemorph-event-v1", 5, "subject-1", 7, "shared-weather"];
  const treatmentSpecific = ["mnemorph-event-v1", 5, "subject-1", 7, "treatment-regrowth"];
  assert.notEqual(randomForEvent(5, shared), randomForEvent(5, treatmentSpecific));
});
