import { analyzeConfirmatoryResults } from "./statistics.js";
import { validateRunConfig } from "./config.js";
import { runAssayProgram } from "./assay.js";
import { canonicalJson, forkSubject, restoreSubjectSnapshot, sha256Hex } from "./snapshot.js";

const RECEIPT_SCHEMA_VERSION = 1;
const RECEIPT_TYPE = "public-run";
const SOFTWARE_VERSION = "0.1.0";
const COMPILER_VERSION = "bounded-assay-compiler-v1";
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const SOURCE_DIRECTORIES = ["src/core", "src/worker", "src/ui", "tools"];
const SOURCE_FILES = [
  "package.json",
  "configs/ablations.json",
  "configs/benchmark-smoke.json",
  "configs/confirmatory-template.json",
  "schemas/receipt-v1.json",
];
const FORBIDDEN_KEYS = new Set([
  "auditor", "auditoronly", "auditorrecord", "auditorrows", "groundtruth", "hiddenlabel",
  "hiddenmechanism", "mechanism", "mechanismfamily", "mechanismid", "mechanismtruth",
  "recipe", "truefamily", "truemechanism", "truth",
]);
const HIDDEN_LABELS = [
  "local-trace", "distributed-trace", "regenerative-reconstruction", "readout-adaptation",
  "context-gated", "open-substrate",
];
const RAW_ROW_FIELDS = [
  "methodIndex", "seedBlockIndex", "armIndex", "stageIndex", "trial", "cue",
  "targetAction", "chosenAction", "correctBit", "contextIndex",
];
const RAW_ROW_DICTIONARIES = Object.freeze({
  arms: ["control", "treatment"],
  stages: ["before", "afterRegrowth", "transfer"],
  contexts: ["familiar", "transfer", "custom"],
});
const RECEIPT_FIELDS = new Set([
  "schemaVersion", "receiptType", "experimentId", "createdAt", "source", "runtime", "platform",
  "task", "compilerVersion", "randomizationMethod", "config", "methods", "seedKeys", "runFingerprint", "snapshots", "rows", "rawRows",
  "rawRowEncoding", "outcomes", "failures", "claimStatus", "confirmatoryPlan", "confirmatoryAnalysis", "digest",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function copy(value) {
  return structuredClone(value);
}

function inspectPublicData(value, path = "$", stack = new WeakSet()) {
  if (value === null || ["string", "boolean", "number"].includes(typeof value)) {
    if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${path} is not JSON-compatible`);
  if (stack.has(value)) throw new TypeError(`${path} contains a cycle`);
  if (!Array.isArray(value) && !isRecord(value)) throw new TypeError(`${path} must be plain JSON data`);
  stack.add(value);
  if (Array.isArray(value)) {
    value.forEach((child, index) => inspectPublicData(child, `${path}[${index}]`, stack));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
        throw new TypeError(`${path}.${key} contains auditor-only data`);
      }
      inspectPublicData(child, `${path}.${key}`, stack);
    }
  }
  stack.delete(value);
}

function textBytes(text) {
  return new TextEncoder().encode(text).byteLength;
}

function normalizeSourceFiles(paths) {
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

async function walkSourceFiles(directory, relativePath, fs) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relative = `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walkSourceFiles(`${directory}/${entry.name}`, relative, fs));
    else if (entry.isFile() && /\.(?:js|html|css)$/.test(entry.name)) files.push(relative);
  }
  return files;
}

function browserRuntime() {
  return typeof navigator === "object" ? navigator.userAgent || "browser" : "browser";
}

function browserPlatform() {
  return typeof navigator === "object" ? navigator.platform || "unknown" : "unknown";
}

async function sourceMetadataFromNode() {
  const fs = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const paths = [...SOURCE_FILES];
  for (const directory of SOURCE_DIRECTORIES) {
    paths.push(...await walkSourceFiles(`${root}/${directory}`, directory, fs));
  }
  const sourceFiles = normalizeSourceFiles(paths);
  const manifest = [];
  for (const relative of sourceFiles) {
    const text = await fs.readFile(`${root}/${relative}`, "utf8");
    manifest.push({ path: relative, text });
  }
  let version = SOFTWARE_VERSION;
  try {
    version = JSON.parse(await fs.readFile(`${root}/package.json`, "utf8")).version;
  } catch {
    // The constant keeps receipt construction usable in embedded test harnesses.
  }
  return {
    version,
    hash: `sha256:${await sha256Hex(canonicalJson(manifest))}`,
    hashKind: "source-tree",
    runtime: `Node.js ${globalThis.process?.version ?? "unknown"}`,
    platform: globalThis.process?.platform ?? "unknown",
  };
}

async function sourceMetadataFromBrowser() {
  try {
    const response = await fetch(new URL("/__mnemorph-build.json", import.meta.url), { cache: "no-store" });
    if (response.ok) {
      const build = await response.json();
      if (typeof build.version === "string" && /^sha256:[a-f0-9]{64}$/.test(build.hash)) {
        return {
          version: build.version,
          hash: build.hash,
          hashKind: build.hashKind === "source-tree" ? "source-tree" : "build-manifest",
          runtime: browserRuntime(),
          platform: browserPlatform(),
        };
      }
    }
  } catch {
    // A static build manifest remains available when the loopback endpoint is absent.
  }
  const fallback = await sha256Hex(canonicalJson({ project: "Mnemorph", version: SOFTWARE_VERSION, files: SOURCE_FILES }));
  return {
    version: SOFTWARE_VERSION,
    hash: `sha256:${fallback}`,
    hashKind: "build-manifest",
    runtime: browserRuntime(),
    platform: browserPlatform(),
  };
}

export async function computeSourceMetadata() {
  if (globalThis.process?.versions?.node) return sourceMetadataFromNode();
  return sourceMetadataFromBrowser();
}

function requiredBatchFields(batchResult) {
  if (!isRecord(batchResult) || batchResult.schemaVersion !== 1
    || !Array.isArray(batchResult.publicRows) || !Array.isArray(batchResult.auditorRows)
    || !Array.isArray(batchResult.initialSnapshots) || !Array.isArray(batchResult.masterSeeds)
    || !Array.isArray(batchResult.methods) || !isRecord(batchResult.config)) {
    throw new TypeError("batch result is missing public rows, auditor rows, snapshots, seeds, methods, or config");
  }
  if (!batchResult.experimentId || typeof batchResult.experimentId !== "string") {
    throw new TypeError("batch result is missing its deterministic experiment ID");
  }
}

function outcomeFor(row) {
  const observations = row.assay?.observations ?? {};
  return {
    methodId: row.methodId,
    masterSeed: row.masterSeed,
    seedBlockIndex: row.seedBlockIndex,
    status: row.status,
    eligibleForMemoryEvaluation: row.eligibleForMemoryEvaluation ?? row.status !== "ineligible",
    selectedCategory: observations.treatment?.afterRegrowth?.category ?? row.selectedCategory ?? null,
    transferCategory: observations.treatment?.transfer?.category ?? null,
  };
}

function rawRowsFor(rows, methods) {
  const methodIndexes = new Map(methods.map((methodId, index) => [methodId, index]));
  const armIndexes = new Map(RAW_ROW_DICTIONARIES.arms.map((armId, index) => [armId, index]));
  const stageIndexes = new Map(RAW_ROW_DICTIONARIES.stages.map((stage, index) => [stage, index]));
  const contextIndexes = new Map(RAW_ROW_DICTIONARIES.contexts.map((context, index) => [context, index]));
  const encoded = [];
  for (const row of rows) {
    for (const event of row.assay?.rawRows ?? []) {
      const values = [
        methodIndexes.get(row.methodId),
        row.seedBlockIndex,
        armIndexes.get(event.armId),
        stageIndexes.get(event.stage),
        event.trial,
        event.cue,
        event.targetAction,
        event.chosenAction,
        Number(event.correct),
        contextIndexes.get(event.context),
      ];
      if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
        throw new TypeError("raw event row cannot be represented by receipt-v1 encoding");
      }
      encoded.push(values);
    }
  }
  return encoded;
}

function compactResultRows(rows) {
  return rows.map((row) => {
    const compact = copy(row);
    if (!compact.assay) return compact;
    delete compact.assay.rawRows;
    for (const observation of Object.values(compact.assay.observations ?? {})) delete observation.rows;
    return compact;
  });
}

function failuresFor(batchResult) {
  const failures = batchResult.publicRows
    .filter((row) => row.status === "invalid" || (row.assay?.errors?.length ?? 0) > 0)
    .map((row) => ({
      methodId: row.methodId,
      masterSeed: row.masterSeed,
      seedBlockIndex: row.seedBlockIndex,
      status: row.status,
      errors: copy(row.assay?.errors ?? []),
    }));
  if (batchResult.status !== "completed") failures.unshift({ status: batchResult.status, diagnostic: batchResult.diagnostic ?? null });
  return failures;
}

function validateSnapshotRecords(records) {
  if (!Array.isArray(records) || records.length === 0) throw new TypeError("batch result has no replay snapshots");
  return records.map((record) => {
    if (!isRecord(record) || !Number.isSafeInteger(record.masterSeed) || record.masterSeed < 0
      || !Number.isSafeInteger(record.seedBlockIndex) || record.seedBlockIndex < 0
      || typeof record.lineageId !== "string" || record.lineageId.length === 0
      || typeof record.snapshot !== "string" || typeof record.snapshotHash !== "string"
      || !/^[a-f0-9]{64}$/.test(record.snapshotHash)) throw new TypeError("invalid initial snapshot record");
    const subject = restoreSubjectSnapshot(record.snapshot);
    const encoded = record.snapshot.toLowerCase();
    if (HIDDEN_LABELS.some((label) => encoded.includes(label))) {
      throw new TypeError("public replay snapshot contains a hidden mechanism label");
    }
    return {
      masterSeed: record.masterSeed,
      seedBlockIndex: record.seedBlockIndex,
      lineageId: record.lineageId,
      snapshotHash: record.snapshotHash,
      snapshot: record.snapshot,
      subjectId: subject.subjectId,
    };
  });
}

async function checkedSource(batchResult) {
  if (isRecord(batchResult.source) && typeof batchResult.source.version === "string"
    && typeof batchResult.source.hash === "string" && /^sha256:[a-f0-9]{64}$/.test(batchResult.source.hash)) {
    return {
      version: batchResult.source.version,
      hash: batchResult.source.hash,
      hashKind: batchResult.source.hashKind ?? "source-tree",
      runtime: batchResult.source.runtime ?? "unknown",
      platform: batchResult.source.platform ?? "unknown",
    };
  }
  return computeSourceMetadata();
}

export async function createPublicReceipt(batchResult) {
  requiredBatchFields(batchResult);
  inspectPublicData(batchResult.publicRows, "publicRows");
  const snapshots = validateSnapshotRecords(batchResult.initialSnapshots);
  for (const snapshot of snapshots) {
    if (await sha256Hex(snapshot.snapshot) !== snapshot.snapshotHash) throw new TypeError("initial snapshot digest does not match its bytes");
  }
  const source = await checkedSource(batchResult);
  const confirmatoryPlan = batchResult.confirmatoryPlan ? copy(batchResult.confirmatoryPlan) : null;
  let confirmatoryAnalysis = null;
  if (confirmatoryPlan && batchResult.confirmatoryResults) {
    confirmatoryAnalysis = analyzeConfirmatoryResults(confirmatoryPlan, batchResult.confirmatoryResults);
  }
  const claimStatus = batchResult.status !== "completed"
    ? "invalid"
    : confirmatoryAnalysis?.status === "confirmatory_success"
      ? "confirmatory"
      : confirmatoryAnalysis?.status === "null_supported"
        ? "null"
        : "exploratory";
  const rawRows = rawRowsFor(batchResult.publicRows, batchResult.methods);
  const rows = compactResultRows(batchResult.publicRows);
  const runIdentity = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    sourceHash: source.hash,
    config: batchResult.config,
    methods: batchResult.methods,
    seedKeys: batchResult.masterSeeds,
    snapshots: snapshots.map(({ snapshotHash, masterSeed, seedBlockIndex }) => ({ snapshotHash, masterSeed, seedBlockIndex })),
    initialSnapshotHash: snapshots[0]?.snapshotHash,
  };
  const runFingerprint = await sha256Hex(canonicalJson(runIdentity));
  const createdAt = typeof batchResult.createdAt === "string" ? batchResult.createdAt : new Date().toISOString();
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    receiptType: RECEIPT_TYPE,
    experimentId: batchResult.experimentId,
    createdAt,
    source: {
      version: source.version,
      hash: source.hash,
      hashKind: source.hashKind,
    },
    runtime: source.runtime,
    platform: source.platform,
    compilerVersion: COMPILER_VERSION,
    randomizationMethod: "event-keyed-v1",
    task: {
      runLabel: batchResult.config.runLabel,
      measurementTrials: batchResult.config.measurementTrials,
      cueToAction: [...batchResult.config.cueToAction],
      rewardNoise: batchResult.config.rewardNoise,
    },
    config: copy(batchResult.config),
    methods: copy(batchResult.methods),
    seedKeys: copy(batchResult.masterSeeds),
    runFingerprint,
    snapshots,
    rows,
    rawRows,
    rawRowEncoding: {
      fields: RAW_ROW_FIELDS,
      methods: copy(batchResult.methods),
      seedBlocks: snapshots.map(({ seedBlockIndex, masterSeed, lineageId }) => ({ seedBlockIndex, masterSeed, lineageId })),
      ...copy(RAW_ROW_DICTIONARIES),
    },
    outcomes: rows.map(outcomeFor),
    failures: failuresFor(batchResult),
    claimStatus,
    ...(confirmatoryPlan ? { confirmatoryPlan } : {}),
    ...(confirmatoryAnalysis ? { confirmatoryAnalysis } : {}),
  };
  inspectPublicData(receipt, "receipt");
  return receipt;
}

export function createAuditorRecord(batchResult) {
  requiredBatchFields(batchResult);
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    receiptType: "auditor-evaluation",
    experimentId: batchResult.experimentId,
    status: batchResult.status,
    auditorRows: copy(batchResult.auditorRows),
    ...(batchResult.confirmatoryResults ? { confirmatoryEvaluation: copy(batchResult.confirmatoryResults) } : {}),
  };
}

function receiptShapeErrors(receipt) {
  const errors = [];
  if (!isRecord(receipt)) return ["receipt_must_be_an_object"];
  if (Object.keys(receipt).some((key) => !RECEIPT_FIELDS.has(key))) errors.push("receipt_has_unknown_fields");
  if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) errors.push("receipt_schema_version_unsupported");
  if (receipt.receiptType !== RECEIPT_TYPE) errors.push("receipt_type_unsupported");
  if (typeof receipt.experimentId !== "string" || receipt.experimentId.length < 8 || receipt.experimentId.length > 128) {
    errors.push("experiment_id_invalid");
  }
  if (typeof receipt.createdAt !== "string" || !Number.isFinite(Date.parse(receipt.createdAt))) errors.push("created_at_invalid");
  if (!isRecord(receipt.source) || typeof receipt.source.version !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(receipt.source.hash ?? "")
    || !["source-tree", "build-manifest"].includes(receipt.source.hashKind)) errors.push("source_provenance_invalid");
  if (typeof receipt.runtime !== "string" || typeof receipt.platform !== "string") errors.push("runtime_provenance_invalid");
  if (receipt.compilerVersion !== COMPILER_VERSION || receipt.randomizationMethod !== "event-keyed-v1") {
    errors.push("experiment_software_provenance_invalid");
  }
  let configOk = false;
  try {
    configOk = validateRunConfig(receipt.config).ok;
  } catch {
    configOk = false;
  }
  if (!configOk || !Array.isArray(receipt.methods) || receipt.methods.length === 0
    || !receipt.methods.every((method) => typeof method === "string" && method.length > 0)
    || new Set(receipt.methods).size !== receipt.methods.length) errors.push("run_configuration_invalid");
  if (!Array.isArray(receipt.seedKeys) || receipt.seedKeys.length === 0
    || !receipt.seedKeys.every((seed) => Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffff_ffff)) {
    errors.push("seed_keys_invalid");
  }
  if (!Array.isArray(receipt.snapshots) || receipt.snapshots.length === 0
    || !receipt.snapshots.every((record) => isRecord(record) && typeof record.snapshot === "string"
      && Number.isSafeInteger(record.masterSeed) && record.masterSeed >= 0
      && Number.isSafeInteger(record.seedBlockIndex) && record.seedBlockIndex >= 0
      && typeof record.lineageId === "string" && typeof record.subjectId === "string"
      && typeof record.snapshotHash === "string" && /^[a-f0-9]{64}$/.test(record.snapshotHash))) errors.push("snapshots_invalid");
  if (!Array.isArray(receipt.rows) || !Array.isArray(receipt.rawRows)
    || !isRecord(receipt.rawRowEncoding) || !Array.isArray(receipt.outcomes)
    || !Array.isArray(receipt.failures)) errors.push("receipt_rows_invalid");
  if (Array.isArray(receipt.snapshots)) {
    const blockIds = receipt.snapshots.map((snapshot) => snapshot.seedBlockIndex);
    if (new Set(blockIds).size !== blockIds.length) errors.push("snapshot_block_ids_duplicate");
    if (receipt.snapshots.some((snapshot) => !receipt.seedKeys?.includes(snapshot.masterSeed))) errors.push("snapshot_seed_not_preregistered");
  }
  if (Array.isArray(receipt.methods) && isRecord(receipt.rawRowEncoding)) {
    const encoding = receipt.rawRowEncoding;
    const dictionaryFieldsPresent = [encoding.fields, encoding.methods, encoding.arms, encoding.stages,
      encoding.contexts, encoding.seedBlocks].every(Array.isArray);
    let encodingValid = false;
    if (dictionaryFieldsPresent) {
      try {
        encodingValid = canonicalJson(encoding.fields) === canonicalJson(RAW_ROW_FIELDS)
          && canonicalJson(encoding.methods) === canonicalJson(receipt.methods)
          && canonicalJson(encoding.arms) === canonicalJson(RAW_ROW_DICTIONARIES.arms)
          && canonicalJson(encoding.stages) === canonicalJson(RAW_ROW_DICTIONARIES.stages)
          && canonicalJson(encoding.contexts) === canonicalJson(RAW_ROW_DICTIONARIES.contexts);
      } catch {
        encodingValid = false;
      }
    }
    if (!encodingValid) errors.push("raw_row_encoding_invalid");
    if (encodingValid && Array.isArray(receipt.rawRows)) {
      const blockIndexes = new Set(encoding.seedBlocks?.map((block) => block.seedBlockIndex) ?? []);
      for (const row of receipt.rawRows) {
        if (!Array.isArray(row) || row.length !== RAW_ROW_FIELDS.length
          || !row.every((value) => Number.isSafeInteger(value) && value >= 0)
          || row[0] >= receipt.methods.length || !blockIndexes.has(row[1])
          || row[2] >= RAW_ROW_DICTIONARIES.arms.length || row[3] >= RAW_ROW_DICTIONARIES.stages.length
          || row[8] > 1 || row[9] >= RAW_ROW_DICTIONARIES.contexts.length) {
          errors.push("raw_event_row_invalid");
          break;
        }
      }
    }
  }
  if (!["exploratory", "confirmatory", "null", "invalid"].includes(receipt.claimStatus)) errors.push("claim_status_invalid");
  if (receipt.claimStatus === "confirmatory"
    && (receipt.confirmatoryPlan?.locked !== true || receipt.confirmatoryAnalysis?.status !== "confirmatory_success")) {
    errors.push("confirmatory_claim_unverified");
  }
  if (receipt.claimStatus === "null"
    && (receipt.confirmatoryPlan?.locked !== true || receipt.confirmatoryAnalysis?.status !== "null_supported")) {
    errors.push("null_claim_unverified");
  }
  try {
    inspectPublicData(receipt, "receipt");
  } catch {
    errors.push("auditor_data_in_public_receipt");
  }
  return [...new Set(errors)];
}

async function payloadErrors(receipt) {
  const errors = receiptShapeErrors(receipt);
  if (!isRecord(receipt)) return errors;
  if (!isRecord(receipt.digest) || receipt.digest.algorithm !== "SHA-256"
    || !/^[a-f0-9]{64}$/.test(receipt.digest.value ?? "")) errors.push("receipt_digest_invalid");
  if (Array.isArray(receipt.snapshots)) {
    for (const snapshot of receipt.snapshots) {
      try {
        restoreSubjectSnapshot(snapshot.snapshot);
        if (await sha256Hex(snapshot.snapshot) !== snapshot.snapshotHash) errors.push("snapshot_digest_mismatch");
      } catch {
        errors.push("snapshot_invalid");
      }
    }
  }
  if (isRecord(receipt.digest) && receipt.digest.algorithm === "SHA-256" && /^[a-f0-9]{64}$/.test(receipt.digest.value ?? "")) {
    try {
      const { digest, ...payload } = receipt;
      if (await sha256Hex(canonicalJson(payload)) !== digest.value) errors.push("receipt_digest_mismatch");
    } catch {
      errors.push("receipt_payload_not_canonicalizable");
    }
  }
  return [...new Set(errors)];
}

export async function sealReceipt(receipt) {
  if (!isRecord(receipt)) throw new TypeError("receipt must be an object");
  const { digest: _priorDigest, ...payload } = receipt;
  const shapeErrors = receiptShapeErrors(payload);
  if (shapeErrors.length > 0) throw new TypeError(`cannot seal invalid receipt: ${shapeErrors.join(",")}`);
  const sealed = {
    ...payload,
    digest: { algorithm: "SHA-256", value: await sha256Hex(canonicalJson(payload)) },
  };
  const text = JSON.stringify(sealed);
  if (textBytes(text) > MAX_RECEIPT_BYTES) throw new RangeError("sealed receipt exceeds 2 MiB");
  return text;
}

export async function validateReceipt(text) {
  if (typeof text !== "string") return { ok: false, errors: ["receipt_text_required"] };
  if (textBytes(text) > MAX_RECEIPT_BYTES) return { ok: false, errors: ["receipt_size_exceeded"] };
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["receipt_json_invalid"] };
  }
  const errors = await payloadErrors(value);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value, errors: [] };
}

export async function importReceiptIntoSession(text, session) {
  if (!isRecord(session)) throw new TypeError("session must be a plain object");
  const validation = await validateReceipt(text);
  if (!validation.ok) return { ok: false, session, receipt: null, errors: validation.errors };
  const currentReceipts = Array.isArray(session.receipts) ? session.receipts : [];
  return {
    ok: true,
    session: { ...session, receipts: [...currentReceipts, validation.value] },
    receipt: validation.value,
    errors: [],
  };
}

export function decodeRawRows(receipt, filter = {}) {
  if (!isRecord(receipt) || receipt.receiptType !== RECEIPT_TYPE || !isRecord(receipt.rawRowEncoding)
    || !Array.isArray(receipt.rawRows)) throw new TypeError("receipt does not contain v1 raw event rows");
  const snapshots = new Map((receipt.rawRowEncoding.seedBlocks ?? []).map((block) => [block.seedBlockIndex, block]));
  const decoded = [];
  for (const values of receipt.rawRows) {
    if (!Array.isArray(values) || values.length !== RAW_ROW_FIELDS.length) throw new TypeError("receipt contains an invalid compact raw row");
    const [methodIndex, seedBlockIndex, armIndex, stageIndex, trial, cue, targetAction, chosenAction, correctBit, contextIndex] = values;
    const seedBlock = snapshots.get(seedBlockIndex);
    const event = {
      methodId: receipt.rawRowEncoding.methods[methodIndex],
      masterSeed: seedBlock?.masterSeed,
      seedBlockIndex,
      lineageId: seedBlock?.lineageId,
      armId: receipt.rawRowEncoding.arms[armIndex],
      stage: receipt.rawRowEncoding.stages[stageIndex],
      trial,
      cue,
      targetAction,
      chosenAction,
      correct: correctBit === 1,
      context: receipt.rawRowEncoding.contexts[contextIndex],
    };
    if (filter.methodId !== undefined && event.methodId !== filter.methodId) continue;
    if (filter.seedBlockIndex !== undefined && event.seedBlockIndex !== filter.seedBlockIndex) continue;
    decoded.push(event);
  }
  return decoded;
}

export async function replayReceiptAssay(receipt, methodId, seedBlockIndex) {
  if (!isRecord(receipt) || receipt.receiptType !== RECEIPT_TYPE) throw new TypeError("replay requires a public run receipt");
  if (typeof methodId !== "string" || !Number.isSafeInteger(seedBlockIndex) || seedBlockIndex < 0) {
    throw new TypeError("replay requires a method id and seed-block index");
  }
  const row = receipt.rows.find((entry) => entry.methodId === methodId && entry.seedBlockIndex === seedBlockIndex);
  const snapshot = receipt.snapshots.find((entry) => entry.seedBlockIndex === seedBlockIndex);
  if (!row || !snapshot) throw new RangeError("receipt has no matching method row and initial snapshot");
  if (!row.selectedProgram || row.initialSnapshotHash !== snapshot.snapshotHash
    || row.masterSeed !== snapshot.masterSeed) throw new TypeError("receipt replay provenance does not match its selected row");
  if (await sha256Hex(snapshot.snapshot) !== snapshot.snapshotHash) throw new TypeError("receipt snapshot digest does not match its bytes");
  const subject = restoreSubjectSnapshot(snapshot.snapshot);
  if (subject.subjectId !== snapshot.subjectId) {
    throw new TypeError("receipt snapshot identity is inconsistent");
  }
  if (row.status === "ineligible") {
    return {
      status: "ineligible",
      methodId,
      seedBlockIndex,
      masterSeed: snapshot.masterSeed,
      snapshotHash: snapshot.snapshotHash,
      program: copy(row.selectedProgram),
      rawRows: [],
      reproducible: true,
    };
  }
  const arms = {
    treatment: { armId: "treatment", subject: forkSubject(subject), activeSilences: [] },
    control: { armId: "control", subject: forkSubject(subject), activeSilences: [] },
  };
  const assay = runAssayProgram({
    arms,
    program: row.selectedProgram,
    config: receipt.config,
    eventContext: {
      masterSeed: snapshot.masterSeed,
      eventKey: [snapshot.lineageId, 0, "shared-assay-events"],
    },
  });
  const actualRawRows = assay.rawRows.map((event) => ({
    methodId,
    masterSeed: snapshot.masterSeed,
    seedBlockIndex,
    lineageId: snapshot.lineageId,
    ...event,
  }));
  const expectedRawRows = decodeRawRows(receipt, { methodId, seedBlockIndex });
  return {
    status: assay.status,
    methodId,
    seedBlockIndex,
    masterSeed: snapshot.masterSeed,
    snapshotHash: snapshot.snapshotHash,
    program: copy(row.selectedProgram),
    observations: copy(assay.observations),
    operationReceipts: copy(assay.operationReceipts),
    errors: copy(assay.errors),
    rawRows: actualRawRows,
    reproducible: canonicalJson(actualRawRows) === canonicalJson(expectedRawRows),
  };
}
