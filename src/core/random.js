const RNG_ALGORITHM = "mulberry32-v1";
const EVENT_KEY_VERSION = "mnemorph-event-key-v1";
const UINT32_MAX = 0xffff_ffff;
const UINT32_RANGE = 0x1_0000_0000;

function asUint32(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new TypeError(`${name} must be an integer in [0, 4294967295]`);
  }
  return value >>> 0;
}

function validateEventParts(parts) {
  if (!Array.isArray(parts)) throw new TypeError("eventParts must be an array tuple");
  for (const part of parts) {
    const type = typeof part;
    if (part !== null && type !== "string" && type !== "boolean"
      && !(type === "number" && Number.isFinite(part))) {
      throw new TypeError("eventParts must contain only strings, finite numbers, booleans, or null");
    }
  }
}

function hashEventKey(seed, parts) {
  const text = JSON.stringify([EVENT_KEY_VERSION, seed, ...parts]);
  const bytes = new TextEncoder().encode(text);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Create a replayable Mulberry32 generator. Snapshot state is the last 32-bit counter. */
export function createRng(seed, state = undefined) {
  asUint32(seed, "seed");
  let counter;
  if (state === undefined) {
    counter = seed >>> 0;
  } else {
    if (state === null || typeof state !== "object" || state.algorithm !== RNG_ALGORITHM) {
      throw new TypeError(`state.algorithm must be ${RNG_ALGORITHM}`);
    }
    counter = asUint32(state.counter, "state.counter");
  }

  const nextUint32 = () => {
    counter = (counter + 0x6d2b79f5) >>> 0;
    let value = counter;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };

  return Object.freeze({
    nextUint32,
    nextFloat: () => nextUint32() / UINT32_RANGE,
    snapshot() {
      return Object.freeze({ algorithm: RNG_ALGORITHM, counter });
    },
  });
}

/** Return a call-order-independent draw for a stable primitive event-key tuple. */
export function randomForEvent(masterSeed, eventParts) {
  const seed = asUint32(masterSeed, "masterSeed");
  validateEventParts(eventParts);
  const eventSeed = hashEventKey(seed, eventParts);
  return createRng(eventSeed).nextFloat();
}
