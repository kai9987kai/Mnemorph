import { validateRunConfig } from "./config.js";
import { applyOperation, validateAssayProgram } from "./interventions.js";
import { measureBehavior } from "./subject.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}

function validSeed(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function safeEventParts(eventContext) {
  const supplied = Array.isArray(eventContext.eventKey)
    ? eventContext.eventKey
    : typeof eventContext.batchId === "string"
      ? [eventContext.batchId]
      : [];
  const allowed = supplied.every((part) => part === null || ["string", "boolean"].includes(typeof part)
    || (typeof part === "number" && Number.isFinite(part)));
  if (!allowed) return null;
  return ["assay-v1", eventContext.masterSeed, ...supplied];
}

function invalidResponse(arms, errors = [], observations = {}, operationReceipts = []) {
  return {
    arms: clone(arms) ?? arms,
    observations,
    rawRows: Object.values(observations).flatMap((record) => Object.values(record).flatMap((stage) => stage.rows ?? [])),
    operationReceipts,
    status: "invalid",
    errors,
  };
}

function validateArms(arms) {
  if (!isRecord(arms) || Object.keys(arms).length < 1) return [{ path: "arms", code: "expected_nonempty_arm_map" }];
  const errors = [];
  for (const [armId, arm] of Object.entries(arms)) {
    if (!isRecord(arm) || arm.armId !== armId) errors.push({ path: `arms.${armId}`, code: "arm_id_mismatch" });
    if (!isRecord(arm?.subject) || !Array.isArray(arm.subject.grid?.cells)
      || !Array.isArray(arm.subject.task?.cueToAction)) {
      errors.push({ path: `arms.${armId}.subject`, code: "invalid_subject_state" });
    }
  }
  return errors.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
}

function durationOf(operation) {
  if (operation.type === "delay" || operation.type === "regrow") return operation.ticks;
  if (operation.type === "sham") return operation.durationTicks;
  return 0;
}

function advanceClock(arms, ticks) {
  if (ticks <= 0) return;
  for (const arm of Object.values(arms)) {
    arm.subject.step += ticks;
    arm.subject.development.age += ticks;
  }
}

function cueMapForTransfer(arm, config) {
  if (Array.isArray(arm.context?.cueToAction)) return [...arm.context.cueToAction];
  return config.cueToAction.map((action) => 1 - action);
}

function observeStage(arms, stage, { config, eventParts, transfer = false }) {
  const observations = {};
  for (const armId of Object.keys(arms).sort()) {
    const arm = arms[armId];
    const cueToAction = transfer ? cueMapForTransfer(arm, config) : undefined;
    const context = transfer ? { cueToAction } : "familiar";
    const measured = measureBehavior(arm.subject, {
      context,
      trials: config.measurementTrials,
      eventKey: [...eventParts, stage],
    });
    observations[armId] = {
      stage,
      context: transfer ? "transfer" : "familiar",
      ...(transfer ? { cueToAction } : {}),
      accuracy: measured.accuracy,
      category: measured.category,
      rows: measured.rows.map((row) => ({ ...row, armId, stage })),
    };
  }
  return observations;
}

export function runAssayProgram({ arms, program, config, eventContext }) {
  const configResult = validateRunConfig(config);
  if (!configResult.ok) return invalidResponse(arms, configResult.errors.map((entry) => ({ ...entry, path: `config.${entry.path}` })));
  const armErrors = validateArms(arms);
  if (armErrors.length > 0) return invalidResponse(arms, armErrors);
  if (!isRecord(eventContext) || !validSeed(eventContext.masterSeed)) {
    return invalidResponse(arms, [{ path: "eventContext.masterSeed", code: "expected_unsigned_32_bit_seed" }]);
  }
  if (!isRecord(program)) return invalidResponse(arms, [{ path: "program", code: "expected_program_object" }]);
  const eventParts = safeEventParts(eventContext);
  if (!eventParts) return invalidResponse(arms, [{ path: "eventContext.eventKey", code: "expected_stable_primitive_tuple" }]);
  const protocolValidation = validateAssayProgram(program, configResult.value);
  if (!protocolValidation.ok) return invalidResponse(arms, protocolValidation.errors);

  let workingArms = clone(arms);
  if (!workingArms) return invalidResponse(arms, [{ path: "arms", code: "not_cloneable" }]);
  const observations = {};
  const before = observeStage(workingArms, "before", { config: configResult.value, eventParts });
  for (const [armId, record] of Object.entries(before)) observations[armId] = { before: record };

  const operationReceipts = [];
  let clockTick = 0;
  let status = "completed";
  for (let operationIndex = 0; operationIndex < program.operations.length; operationIndex += 1) {
    const operation = program.operations[operationIndex];
    const startTick = Math.max(clockTick, operation.atTick);
    const waitingTicks = startTick - clockTick;
    const duration = durationOf(operation);
    if (startTick + duration > configResult.value.maxTicks) {
      operationReceipts.push({
        operationIndex,
        type: operation.type,
        status: "invalid",
        reasonCode: "assay_tick_cap_exceeded",
        affectedArms: [],
        affectedCells: 0,
        elapsedTicks: 0,
        scheduledWaitTicks: 0,
      });
      status = "invalid";
      break;
    }
    if (waitingTicks > 0) advanceClock(workingArms, waitingTicks);
    clockTick = startTick;
    const applied = applyOperation(workingArms, { ...operation, atTick: startTick }, {
      masterSeed: eventContext.masterSeed,
      programId: program.programId,
      operationIndex,
      eventKey: [...eventParts, startTick, operation.type],
    });
    const receipt = { ...applied.operationReceipt, scheduledWaitTicks: waitingTicks };
    operationReceipts.push(receipt);
    workingArms = applied.arms;
    if (receipt.status !== "applied") {
      status = "invalid";
      break;
    }
    clockTick += receipt.elapsedTicks;
  }

  if (status === "completed") {
    const after = observeStage(workingArms, "afterRegrowth", { config: configResult.value, eventParts });
    const transfer = observeStage(workingArms, "transfer", {
      config: configResult.value,
      eventParts,
      transfer: true,
    });
    for (const armId of Object.keys(workingArms)) {
      observations[armId].afterRegrowth = after[armId];
      observations[armId].transfer = transfer[armId];
    }
  }

  const rawRows = Object.values(observations).flatMap((record) => Object.values(record).flatMap((stage) => stage.rows ?? []));
  return {
    arms: workingArms,
    observations,
    rawRows,
    operationReceipts,
    status,
    errors: [],
  };
}
