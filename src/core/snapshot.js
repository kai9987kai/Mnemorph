const SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_CELLS = 2048;
const REGIONS = new Set(["head", "body", "wound-border", "tail"]);
const TOP_LEVEL_KEYS = [
  "schemaVersion", "subjectId", "seed", "step", "randomness", "grid",
  "development", "task", "wiring", "readout",
];

function fail(path, message) {
  throw new TypeError(`invalid subject snapshot at ${path}: ${message}`);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value, path) {
  if (!isRecord(value)) fail(path, "expected plain object");
  return value;
}

function requireKeys(value, expected, path) {
  requireRecord(value, path);
  const actual = Object.keys(value).sort();
  const desired = [...expected].sort();
  if (actual.length !== desired.length || actual.some((key, index) => key !== desired[index])) {
    fail(path, "unexpected or missing fields");
  }
}

function finiteNumber(value, path, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(path, "expected finite number in range");
  }
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(path, "expected integer in range");
}

function finiteArray(value, path, length) {
  if (!Array.isArray(value) || value.length !== length) fail(path, `expected array of length ${length}`);
  value.forEach((item, index) => finiteNumber(item, `${path}[${index}]`));
}

function validateSubject(subject) {
  requireKeys(subject, TOP_LEVEL_KEYS, "$");
  if (subject.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) fail("schemaVersion", "unsupported version");
  if (typeof subject.subjectId !== "string" || subject.subjectId.length === 0 || subject.subjectId.length > 160) {
    fail("subjectId", "expected nonempty bounded string");
  }
  integer(subject.seed, "seed", { max: 0xffff_ffff });
  integer(subject.step, "step");
  requireKeys(subject.randomness, ["algorithm", "eventCounter"], "randomness");
  if (subject.randomness.algorithm !== "event-keyed-v1") fail("randomness.algorithm", "unsupported algorithm");
  integer(subject.randomness.eventCounter, "randomness.eventCounter");
  if (subject.randomness.eventCounter !== subject.step) fail("randomness.eventCounter", "must equal subject step");

  requireKeys(subject.grid, ["width", "height", "cells"], "grid");
  integer(subject.grid.width, "grid.width", { min: 4, max: 64 });
  integer(subject.grid.height, "grid.height", { min: 4, max: 64 });
  const expectedCells = subject.grid.width * subject.grid.height;
  if (expectedCells > MAX_CELLS) fail("grid", "subject cell cap exceeded");
  if (!Array.isArray(subject.grid.cells) || subject.grid.cells.length !== expectedCells) {
    fail("grid.cells", "cell count does not match grid dimensions");
  }
  subject.grid.cells.forEach((cell, index) => {
    const path = `grid.cells[${index}]`;
    requireKeys(cell, ["index", "x", "y", "region", "alive", "channels"], path);
    integer(cell.index, `${path}.index`, { max: expectedCells - 1 });
    integer(cell.x, `${path}.x`, { max: subject.grid.width - 1 });
    integer(cell.y, `${path}.y`, { max: subject.grid.height - 1 });
    if (cell.index !== index || cell.x !== index % subject.grid.width
      || cell.y !== Math.floor(index / subject.grid.width)) fail(path, "coordinate/index mismatch");
    if (!REGIONS.has(cell.region)) fail(`${path}.region`, "unknown tissue region");
    if (typeof cell.alive !== "boolean") fail(`${path}.alive`, "expected boolean");
    requireKeys(cell.channels, ["voltage", "trace", "plasticity"], `${path}.channels`);
    finiteNumber(cell.channels.voltage, `${path}.channels.voltage`);
    finiteArray(cell.channels.trace, `${path}.channels.trace`, 4);
    finiteArray(cell.channels.plasticity, `${path}.channels.plasticity`, 4);
  });

  requireKeys(subject.development, ["ruleId", "frozen", "age", "generation"], "development");
  if (typeof subject.development.ruleId !== "string" || subject.development.ruleId.length === 0) {
    fail("development.ruleId", "expected nonempty string");
  }
  if (subject.development.frozen !== true) fail("development.frozen", "development rule must remain frozen");
  integer(subject.development.age, "development.age");
  integer(subject.development.generation, "development.generation");

  requireKeys(subject.task, [
    "cueToAction", "rewardNoise", "preflightAccuracy", "retainedAccuracy",
    "partialAccuracy", "measurementTrials",
  ], "task");
  if (!Array.isArray(subject.task.cueToAction) || subject.task.cueToAction.length !== 2
    || !subject.task.cueToAction.every((action) => action === 0 || action === 1)
    || new Set(subject.task.cueToAction).size !== 2) fail("task.cueToAction", "expected binary permutation");
  finiteNumber(subject.task.rewardNoise, "task.rewardNoise", { min: 0, max: 0.25 });
  finiteNumber(subject.task.preflightAccuracy, "task.preflightAccuracy", { min: 0.500001, max: 1 });
  finiteNumber(subject.task.retainedAccuracy, "task.retainedAccuracy", { min: 0.500001, max: 1 });
  finiteNumber(subject.task.partialAccuracy, "task.partialAccuracy", { min: 0.500001, max: 1 });
  if (subject.task.partialAccuracy >= subject.task.retainedAccuracy) {
    fail("task.partialAccuracy", "must be below retained threshold");
  }
  integer(subject.task.measurementTrials, "task.measurementTrials", { min: 1, max: 1000 });

  requireKeys(subject.wiring, ["cellRouteIds", "cellRouteWeight", "readoutWeight"], "wiring");
  if (!Array.isArray(subject.wiring.cellRouteIds)) fail("wiring.cellRouteIds", "expected array");
  const seenRouteIds = new Set();
  subject.wiring.cellRouteIds.forEach((index, routeIndex) => {
    integer(index, `wiring.cellRouteIds[${routeIndex}]`, { max: expectedCells - 1 });
    if (seenRouteIds.has(index)) fail(`wiring.cellRouteIds[${routeIndex}]`, "duplicate cell route");
    seenRouteIds.add(index);
  });
  finiteNumber(subject.wiring.cellRouteWeight, "wiring.cellRouteWeight", { min: 0, max: 1 });
  finiteNumber(subject.wiring.readoutWeight, "wiring.readoutWeight", { min: 0, max: 1 });
  requireKeys(subject.readout, ["scores"], "readout");
  finiteArray(subject.readout.scores, "readout.scores", 4);
  return subject;
}

function canonicalValue(value, stack, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`cannot canonicalize non-finite number at ${path}`);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError(`cannot canonicalize ${typeof value} at ${path}`);
  if (stack.has(value)) throw new TypeError(`cannot canonicalize circular value at ${path}`);
  stack.add(value);
  let result;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError(`cannot canonicalize sparse array at ${path}[${index}]`);
    }
    result = `[${value.map((item, index) => canonicalValue(item, stack, `${path}[${index}]`)).join(",")}]`;
  } else {
    if (!isRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`cannot canonicalize non-plain object at ${path}`);
    }
    const entries = Object.keys(value).sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`cannot canonicalize accessor or hidden property at ${path}.${key}`);
      }
      return `${JSON.stringify(key)}:${canonicalValue(descriptor.value, stack, `${path}.${key}`)}`;
    });
    result = `{${entries.join(",")}}`;
  }
  stack.delete(value);
  return result;
}

export function canonicalJson(value) {
  return canonicalValue(value, new WeakSet(), "$ ");
}

export function snapshotSubject(subject) {
  validateSubject(subject);
  const text = canonicalJson(subject);
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new RangeError("subject snapshot exceeds 2 MiB");
  }
  return text;
}

export function restoreSubjectSnapshot(text) {
  if (typeof text !== "string") throw new TypeError("snapshot must be text");
  if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new RangeError("subject snapshot exceeds 2 MiB");
  }
  let subject;
  try {
    subject = JSON.parse(text);
  } catch {
    throw new TypeError("subject snapshot is not valid JSON");
  }
  validateSubject(subject);
  return structuredClone(subject);
}

export function forkSubject(subject) {
  return restoreSubjectSnapshot(snapshotSubject(subject));
}

export async function sha256Hex(text) {
  if (typeof text !== "string") throw new TypeError("SHA-256 input must be text");
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
