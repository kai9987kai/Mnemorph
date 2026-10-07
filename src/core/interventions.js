import { validateRunConfig } from "./config.js";
import { randomForEvent } from "./random.js";

const OPERATION_TYPES = Object.freeze([
  "lesion",
  "silence",
  "scramble",
  "transplant",
  "delay",
  "regrow",
  "context-shift",
  "sham",
]);
const REGIONS = new Set(["head", "body", "tail", "wound-border"]);
const CHANNELS = new Set(["voltage", "trace", "plasticity"]);
const MAX_OPERATION_TICKS = 10_000;

const OPERATION_FIELDS = Object.freeze({
  lesion: ["type", "armId", "region", "fraction", "atTick"],
  silence: ["type", "armId", "channel", "durationTicks", "atTick"],
  scramble: ["type", "armId", "region", "channel", "intensity", "atTick"],
  transplant: ["type", "sourceArm", "targetArm", "patch", "channel", "atTick"],
  delay: ["type", "ticks", "atTick"],
  regrow: ["type", "armId", "ticks", "atTick"],
  "context-shift": ["type", "armId", "cueToAction", "atTick"],
  sham: ["type", "armId", "region", "durationTicks", "atTick"],
});

function issue(path, code) {
  return { path, code };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function knownArmIds(knownArms) {
  if (knownArms instanceof Set) return [...knownArms];
  if (Array.isArray(knownArms)) return knownArms;
  if (isRecord(knownArms)) return Object.keys(knownArms);
  return [];
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_OPERATION_TICKS;
}

function isNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_OPERATION_TICKS;
}

function validateArmId(operation, field, arms, errors) {
  const id = operation[field];
  if (typeof id !== "string" || id.trim().length === 0) {
    errors.push(issue(field, "expected_arm_id"));
  } else if (!arms.includes(id)) {
    errors.push(issue(field, "unknown_arm"));
  }
}

function validateOperationShape(operation, arms, path = "$") {
  const errors = [];
  if (!isRecord(operation)) return [issue(path, "expected_operation_object")];
  if (!OPERATION_TYPES.includes(operation.type)) return [issue(`${path}.type`, "unknown_operation_type")];

  const fields = OPERATION_FIELDS[operation.type];
  for (const key of Object.keys(operation)) {
    if (!fields.includes(key)) errors.push(issue(`${path}.${key}`, "unknown_field"));
  }
  for (const key of fields) {
    if (!(key in operation)) errors.push(issue(`${path}.${key}`, "required_field"));
  }
  if ("atTick" in operation && !isNonnegativeInteger(operation.atTick)) {
    errors.push(issue(`${path}.atTick`, "expected_bounded_tick"));
  }

  switch (operation.type) {
    case "lesion":
      validateArmId(operation, "armId", arms, errors);
      validateRegion(operation.region, `${path}.region`, errors);
      validateFraction(operation.fraction, `${path}.fraction`, errors);
      break;
    case "silence":
      validateArmId(operation, "armId", arms, errors);
      validateChannel(operation.channel, `${path}.channel`, errors);
      validateDuration(operation.durationTicks, `${path}.durationTicks`, errors);
      if (Number.isSafeInteger(operation.atTick) && Number.isSafeInteger(operation.durationTicks)
        && operation.atTick + operation.durationTicks > MAX_OPERATION_TICKS) {
        errors.push(issue(`${path}.durationTicks`, "interval_exceeds_tick_cap"));
      }
      break;
    case "scramble":
      validateArmId(operation, "armId", arms, errors);
      validateRegion(operation.region, `${path}.region`, errors);
      validateChannel(operation.channel, `${path}.channel`, errors);
      validateFraction(operation.intensity, `${path}.intensity`, errors);
      break;
    case "transplant":
      validateArmId(operation, "sourceArm", arms, errors);
      validateArmId(operation, "targetArm", arms, errors);
      if (operation.sourceArm === operation.targetArm) errors.push(issue(`${path}.targetArm`, "arms_must_differ"));
      validateChannel(operation.channel, `${path}.channel`, errors);
      validatePatch(operation.patch, `${path}.patch`, errors);
      break;
    case "delay":
      validateDuration(operation.ticks, `${path}.ticks`, errors);
      break;
    case "regrow":
      validateArmId(operation, "armId", arms, errors);
      validateDuration(operation.ticks, `${path}.ticks`, errors);
      break;
    case "context-shift":
      validateArmId(operation, "armId", arms, errors);
      if (!Array.isArray(operation.cueToAction)
        || operation.cueToAction.length !== 2
        || !operation.cueToAction.every((action) => Number.isInteger(action) && action >= 0 && action <= 1)
        || new Set(operation.cueToAction).size !== 2) {
        errors.push(issue(`${path}.cueToAction`, "expected_binary_permutation"));
      }
      break;
    case "sham":
      validateArmId(operation, "armId", arms, errors);
      validateRegion(operation.region, `${path}.region`, errors);
      validateDuration(operation.durationTicks, `${path}.durationTicks`, errors);
      break;
    default:
      break;
  }

  return errors.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
}

function validateRegion(region, path, errors) {
  if (typeof region !== "string" || !REGIONS.has(region)) errors.push(issue(path, "unknown_region"));
}

function validateChannel(channel, path, errors) {
  if (typeof channel !== "string" || !CHANNELS.has(channel)) errors.push(issue(path, "unknown_channel"));
}

function validateFraction(value, path, errors) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    errors.push(issue(path, "expected_fraction_in_open_closed_unit_interval"));
  }
}

function validateDuration(value, path, errors) {
  if (!isPositiveInteger(value)) errors.push(issue(path, "expected_positive_bounded_ticks"));
}

function validatePatch(patch, path, errors) {
  if (!isRecord(patch)) {
    errors.push(issue(path, "expected_patch_object"));
    return;
  }
  for (const key of Object.keys(patch)) {
    if (!["x", "y", "width", "height"].includes(key)) errors.push(issue(`${path}.${key}`, "unknown_field"));
  }
  for (const key of ["x", "y", "width", "height"]) {
    if (!Number.isSafeInteger(patch[key]) || (key === "x" || key === "y" ? patch[key] < 0 : patch[key] < 1)) {
      errors.push(issue(`${path}.${key}`, "expected_bounded_patch_coordinate"));
    }
  }
}

function operationArms(operation) {
  if (!isRecord(operation)) return [];
  if (operation.type === "transplant") return [operation.sourceArm, operation.targetArm].filter((id) => typeof id === "string");
  if (operation.type === "delay") return [];
  return typeof operation.armId === "string" ? [operation.armId] : [];
}

export function validateIntervention(operation, knownArms) {
  const ids = knownArmIds(knownArms);
  const errors = validateOperationShape(operation, ids);
  return { ok: errors.length === 0, errors };
}

export function validateAssayProgram(program, config) {
  const errors = [];
  const configResult = validateRunConfig(config);
  if (!configResult.ok) {
    errors.push(...configResult.errors.map((entry) => issue(`config.${entry.path}`, entry.code)));
  }
  if (!isRecord(program)) {
    return { ok: false, errors: [issue("$", "expected_program_object"), ...errors] };
  }
  for (const key of Object.keys(program)) {
    if (!["programId", "operations"].includes(key)) errors.push(issue(key, "unknown_field"));
  }
  if (typeof program.programId !== "string" || program.programId.trim().length === 0 || program.programId.length > 100) {
    errors.push(issue("programId", "expected_nonempty_id_at_most_100_chars"));
  }
  if (!Array.isArray(program.operations)) {
    errors.push(issue("operations", "expected_operation_array"));
  } else {
    const maximum = configResult.ok ? configResult.value.protocolLengthCap : 4;
    if (program.operations.length > maximum) errors.push(issue("operations", "protocol_length_cap_exceeded"));
    const arms = [...new Set(program.operations.flatMap(operationArms))];
    let horizon = 0;
    program.operations.forEach((operation, index) => {
      errors.push(...validateOperationShape(operation, arms, `operations[${index}]`));
      if (!isRecord(operation)) return;
      const start = Number.isSafeInteger(operation.atTick) ? operation.atTick : 0;
      const duration = operation.type === "delay" || operation.type === "regrow"
        ? operation.ticks
        : operation.type === "silence" || operation.type === "sham"
          ? operation.durationTicks
          : 0;
      if (Number.isSafeInteger(duration) && duration > 0) horizon = Math.max(horizon, start + duration);
      else horizon = Math.max(horizon, start);
    });
    if (configResult.ok && horizon > configResult.value.maxTicks) {
      errors.push(issue("operations", "assay_tick_cap_exceeded"));
    }
  }
  errors.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  return { ok: errors.length === 0, errors };
}

function eventParts(eventContext, operation) {
  if (!isRecord(eventContext)) return null;
  const { masterSeed, programId, operationIndex } = eventContext;
  if (!Number.isSafeInteger(masterSeed) || masterSeed < 0 || masterSeed > 0xffff_ffff
    || typeof programId !== "string" || programId.length === 0
    || !Number.isSafeInteger(operationIndex) || operationIndex < 0) return null;
  if (Array.isArray(eventContext.eventKey)) {
    const validParts = eventContext.eventKey.every((part) => part === null || ["string", "boolean"].includes(typeof part)
      || (typeof part === "number" && Number.isFinite(part)));
    if (!validParts) return null;
    return [...eventContext.eventKey, operationIndex, operation.type];
  }
  return ["intervention-v1", programId, operationIndex, operation.type];
}

function cloneArms(arms) {
  if (!isRecord(arms)) return null;
  try {
    return structuredClone(arms);
  } catch {
    return null;
  }
}

function invalidResult(arms, operation, reasonCode, operationIndex) {
  return {
    arms: cloneArms(arms) ?? arms,
    operationReceipt: {
      operationIndex: Number.isSafeInteger(operationIndex) ? operationIndex : null,
      type: isRecord(operation) && typeof operation.type === "string" ? operation.type : "unknown",
      status: "invalid",
      reasonCode,
      affectedArms: [],
      affectedCells: 0,
      elapsedTicks: 0,
    },
  };
}

function armFor(arms, id) {
  return arms[id] && arms[id].armId === id && arms[id].subject?.grid?.cells ? arms[id] : null;
}

function sortByEventKey(items, seed, parts, suffix) {
  return items
    .map((item) => ({ item, key: randomForEvent(seed, [...parts, suffix, item.index ?? item]) }))
    .sort((a, b) => a.key - b.key || String(a.item.index ?? a.item).localeCompare(String(b.item.index ?? b.item)))
    .map(({ item }) => item);
}

function selectCount(length, fraction) {
  return Math.min(length, Math.max(1, Math.ceil(length * fraction)));
}

function regionCells(arm, region) {
  return arm.subject.grid.cells.filter((cell) => cell.region === region && cell.alive);
}

function getChannelState(cell, channel) {
  const value = cell.channels[channel];
  return Array.isArray(value) ? [...value] : value;
}

function setChannelState(cell, channel, value) {
  cell.channels[channel] = Array.isArray(value) ? [...value] : value;
}

function incrementTime(arm, ticks) {
  arm.subject.step += ticks;
  arm.subject.development.age += ticks;
}

export function isChannelSilenced(arm, channel, tick) {
  if (!Number.isSafeInteger(tick) || tick < 0 || !Array.isArray(arm?.activeSilences)) return false;
  return arm.activeSilences.some((silence) => silence.channel === channel
    && Number.isSafeInteger(silence.startedTick)
    && Number.isSafeInteger(silence.untilTick)
    && silence.startedTick <= tick && tick < silence.untilTick);
}

function expireSilences(arm, tick) {
  if (!Array.isArray(arm.activeSilences)) return;
  arm.activeSilences = arm.activeSilences.filter((silence) => silence.untilTick > tick);
}

function neighborCells(grid, cell) {
  const candidates = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
      const neighbor = grid.cells[y * grid.width + x];
      if (neighbor?.alive) candidates.push(neighbor);
    }
  }
  return candidates;
}

function majority(values, seed, parts) {
  if (values.length === 0) return 0;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const max = Math.max(...counts.values());
  const winners = [...counts.entries()].filter(([, count]) => count === max).map(([value]) => value).sort((a, b) => a - b);
  if (winners.length === 1) return winners[0];
  const choice = Math.floor(randomForEvent(seed, [...parts, "tie"]) * winners.length);
  return winners[choice];
}

function regrow(arm, ticks, seed, parts, startTick) {
  const grid = arm.subject.grid;
  let restored = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    const currentGrid = { width: grid.width, height: grid.height, cells: structuredClone(grid.cells) };
    const deadCells = currentGrid.cells.filter((cell) => !cell.alive).sort((a, b) => a.index - b.index);
    const pending = [];
    for (const cell of deadCells) {
      const neighbors = neighborCells(currentGrid, cell);
      if (neighbors.length === 0) continue;
      const nextChannels = {};
      for (const [channel, current] of Object.entries(cell.channels)) {
        if (isChannelSilenced(arm, channel, startTick + tick)) {
          nextChannels[channel] = Array.isArray(current) ? [...current] : current;
          continue;
        }
        if (Array.isArray(current)) {
          nextChannels[channel] = current.map((_, slot) => majority(
            neighbors.map((neighbor) => neighbor.channels[channel][slot]),
            seed,
            [...parts, "development-rule", arm.subject.development.ruleId, "regrow", tick, cell.index, channel, slot],
          ));
        } else {
          nextChannels[channel] = majority(
            neighbors.map((neighbor) => neighbor.channels[channel]),
            seed,
            [...parts, "development-rule", arm.subject.development.ruleId, "regrow", tick, cell.index, channel],
          );
        }
      }
      pending.push({ index: cell.index, channels: nextChannels });
    }
    for (const update of pending) {
      const cell = grid.cells[update.index];
      cell.channels = update.channels;
      cell.alive = true;
      restored += 1;
    }
    incrementTime(arm, 1);
    expireSilences(arm, startTick + tick + 1);
  }
  return restored;
}

function patchCells(arm, patch) {
  const { width, height } = arm.subject.grid;
  if (patch.x + patch.width > width || patch.y + patch.height > height) return null;
  const cells = [];
  for (let y = patch.y; y < patch.y + patch.height; y += 1) {
    for (let x = patch.x; x < patch.x + patch.width; x += 1) {
      cells.push(arm.subject.grid.cells[y * width + x]);
    }
  }
  return cells;
}

function applyValidOperation(arms, operation, eventContext, parts) {
  const seed = eventContext.masterSeed;
  let affectedArms = [];
  let affectedCells = 0;
  let elapsedTicks = 0;
  switch (operation.type) {
    case "lesion": {
      const arm = armFor(arms, operation.armId);
      const candidates = regionCells(arm, operation.region);
      if (candidates.length === 0) return { reasonCode: "no_viable_cells_in_region" };
      const selected = sortByEventKey(candidates, seed, parts, "lesion")
        .slice(0, selectCount(candidates.length, operation.fraction));
      for (const cell of selected) cell.alive = false;
      affectedArms = [operation.armId];
      affectedCells = selected.length;
      break;
    }
    case "silence": {
      const arm = armFor(arms, operation.armId);
      arm.activeSilences ??= [];
      arm.activeSilences.push({
        channel: operation.channel,
        startedTick: operation.atTick,
        untilTick: operation.atTick + operation.durationTicks,
      });
      affectedArms = [operation.armId];
      break;
    }
    case "scramble": {
      const arm = armFor(arms, operation.armId);
      const candidates = regionCells(arm, operation.region);
      if (candidates.length < 2) return { reasonCode: "insufficient_viable_cells_in_region" };
      const selectedCount = Math.min(candidates.length, Math.max(2, Math.ceil(candidates.length * operation.intensity)));
      const selected = sortByEventKey(candidates, seed, parts, "scramble-select").slice(0, selectedCount);
      const states = selected.map((cell) => getChannelState(cell, operation.channel));
      const order = sortByEventKey(states.map((_, index) => index), seed, parts, "scramble-permute");
      selected.forEach((cell, index) => setChannelState(cell, operation.channel, states[order[index]]));
      affectedArms = [operation.armId];
      affectedCells = selected.length;
      break;
    }
    case "transplant": {
      const sourceArm = armFor(arms, operation.sourceArm);
      const targetArm = armFor(arms, operation.targetArm);
      if (sourceArm.subject.grid.width !== targetArm.subject.grid.width
        || sourceArm.subject.grid.height !== targetArm.subject.grid.height) return { reasonCode: "incompatible_grid_dimensions" };
      const sourceCells = patchCells(sourceArm, operation.patch);
      const targetCells = patchCells(targetArm, operation.patch);
      if (!sourceCells || !targetCells) return { reasonCode: "patch_out_of_bounds" };
      const sourceState = sourceCells.map((cell) => getChannelState(cell, operation.channel));
      const targetState = targetCells.map((cell) => getChannelState(cell, operation.channel));
      sourceCells.forEach((cell, index) => setChannelState(cell, operation.channel, targetState[index]));
      targetCells.forEach((cell, index) => setChannelState(cell, operation.channel, sourceState[index]));
      affectedArms = [operation.sourceArm, operation.targetArm];
      affectedCells = sourceCells.length + targetCells.length;
      break;
    }
    case "delay":
      for (const arm of Object.values(arms)) {
        incrementTime(arm, operation.ticks);
        expireSilences(arm, operation.atTick + operation.ticks);
      }
      affectedArms = Object.keys(arms).sort();
      elapsedTicks = operation.ticks;
      break;
    case "regrow": {
      const arm = armFor(arms, operation.armId);
      affectedCells = regrow(arm, operation.ticks, seed, parts, operation.atTick);
      affectedArms = [operation.armId];
      elapsedTicks = operation.ticks;
      break;
    }
    case "context-shift": {
      const arm = armFor(arms, operation.armId);
      arm.context = { cueToAction: [...operation.cueToAction] };
      affectedArms = [operation.armId];
      break;
    }
    case "sham": {
      const arm = armFor(arms, operation.armId);
      incrementTime(arm, operation.durationTicks);
      expireSilences(arm, operation.atTick + operation.durationTicks);
      affectedArms = [operation.armId];
      elapsedTicks = operation.durationTicks;
      break;
    }
    default:
      return { reasonCode: "unknown_operation_type" };
  }
  return { affectedArms, affectedCells, elapsedTicks };
}

export function applyOperation(arms, operation, eventContext) {
  const operationIndex = isRecord(eventContext) ? eventContext.operationIndex : null;
  const ids = isRecord(arms) ? Object.keys(arms) : [];
  const validation = validateIntervention(operation, ids);
  if (!validation.ok) {
    const missingTarget = validation.errors.some((entry) => entry.code === "unknown_arm");
    return invalidResult(arms, operation, missingTarget ? "unknown_arm" : "invalid_operation", operationIndex);
  }
  const parts = eventParts(eventContext, operation);
  if (!parts) return invalidResult(arms, operation, "invalid_event_context", operationIndex);
  const cloned = cloneArms(arms);
  if (!cloned || Object.values(cloned).some((arm) => !armFor(cloned, arm?.armId))) {
    return invalidResult(arms, operation, "invalid_arm_state", operationIndex);
  }
  const result = applyValidOperation(cloned, operation, eventContext, parts);
  if (result.reasonCode) return invalidResult(arms, operation, result.reasonCode, operationIndex);
  return {
    arms: cloned,
    operationReceipt: {
      operationIndex,
      type: operation.type,
      status: "applied",
      reasonCode: null,
      affectedArms: result.affectedArms,
      affectedCells: result.affectedCells,
      elapsedTicks: result.elapsedTicks,
    },
  };
}

export const INTERVENTION_TYPES = OPERATION_TYPES;
