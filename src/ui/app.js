import {
  decodeRawRows,
  replayReceiptAssay,
  sealReceipt,
  validateReceipt,
} from "../core/receipt.js";
import {
  createSessionState,
  reduceSession,
} from "./session.js";
import { describeCell, renderSession } from "./view.js";

let session = createSessionState();
let runConfig = null;
let activeJobId = null;
const preferences = {
  canRun: false,
  channel: "voltage",
  region: "all",
  snapshotIndex: "",
  methodId: "",
  blockIndex: "",
  message: "",
};

const worker = (() => {
  try {
    return new Worker(new URL("../worker/worker-entry.js", import.meta.url), { type: "module" });
  } catch (error) {
    preferences.message = `Could not start the local experiment worker: ${error.message}`;
    return null;
  }
})();

function render() {
  renderSession(document, session, preferences);
}

function updateMessage(message) {
  preferences.message = message;
  render();
}

function dispatch(action) {
  session = reduceSession(session, action);
  render();
}

function selectedReceipt() {
  return session.receipts.find((receipt) => receipt.experimentId === session.selectedReceiptId)
    ?? session.receipts.at(-1)
    ?? null;
}

function saveDownload(filename, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function receiptFilename(receipt, extension) {
  const safeId = receipt.experimentId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
  return `${safeId}.${extension}`;
}

async function exportJson() {
  const receipt = selectedReceipt();
  if (!receipt) return;
  try {
    const text = await sealReceipt(receipt);
    saveDownload(receiptFilename(receipt, "json"), text, "application/json");
  } catch (error) {
    preferences.message = `Receipt export failed: ${error.message}`;
    render();
  }
}

function exportCsv() {
  const receipt = selectedReceipt();
  if (!receipt) return;
  const rows = decodeRawRows(receipt);
  const columns = ["methodId", "masterSeed", "seedBlockIndex", "lineageId", "armId", "stage", "trial", "cue", "targetAction", "chosenAction", "correct", "context"];
  const csv = [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n");
  saveDownload(receiptFilename(receipt, "csv"), csv, "text/csv;charset=utf-8");
}

async function loadBundledConfig() {
  try {
    const response = await fetch("/__mnemorph-smoke.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`local server returned ${response.status}`);
    runConfig = await response.json();
    preferences.canRun = true;
    document.getElementById("config-name").textContent = runConfig.name ?? "Loaded benchmark";
    document.getElementById("config-summary").textContent = `${runConfig.masterSeeds?.length ?? 0} seed blocks · ${runConfig.familyIds?.length ?? 0} synthetic families · ${runConfig.methods?.length ?? 0} methods`;
    document.getElementById("connection-status").textContent = worker ? "LOCAL WORKER READY" : "WORKER UNAVAILABLE";
    preferences.message = "Bundled smoke configuration loaded. Runs stay in this local browser session.";
  } catch (error) {
    preferences.canRun = false;
    preferences.message = `Start the Mnemorph loopback server to load its smoke config. ${error.message}`;
  }
  render();
}

async function loadConfigFile(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("configuration must be a JSON object");
    runConfig = parsed;
    preferences.canRun = true;
    document.getElementById("config-name").textContent = parsed.name ?? file.name;
    document.getElementById("config-summary").textContent = `${parsed.masterSeeds?.length ?? 0} seed blocks · ${parsed.familyIds?.length ?? 0} synthetic families · ${parsed.methods?.length ?? 0} methods`;
    preferences.message = "Configuration loaded. The worker will validate all bounds before starting.";
  } catch (error) {
    preferences.message = `Configuration was not loaded: ${error.message}`;
  }
  render();
}

async function importReceiptFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const validation = await validateReceipt(text);
    if (!validation.ok) {
      preferences.message = `Receipt rejected: ${validation.errors.join(", ")}`;
      render();
      return;
    }
    dispatch({ type: "IMPORT_RECEIPT", receipt: validation.value });
    preferences.message = `Imported ${validation.value.experimentId}. Raw event rows remain available for export.`;
    render();
  } catch (error) {
    preferences.message = `Receipt import failed: ${error.message}`;
    render();
  }
}

function startRun() {
  if (!worker || !runConfig || session.job.status === "running") return;
  activeJobId = globalThis.crypto?.randomUUID?.() ?? `mnemorph-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  preferences.message = "Starting the worker. It will yield after each seed block.";
  dispatch({ type: "JOB_STARTED", jobId: activeJobId, totalSeedBlocks: runConfig.masterSeeds?.length ?? 0 });
  worker.postMessage({ type: "start", jobId: activeJobId, config: runConfig });
}

function requestCancel() {
  if (!worker || session.job.status !== "running") return;
  preferences.message = "Cancellation requested; the worker will stop at the next seed-block boundary.";
  render();
  worker.postMessage({ type: "cancel", jobId: session.job.jobId });
}

async function handleWorkerMessage(event) {
  const message = event.data;
  if (message?.type === "progress") {
    dispatch({ type: "JOB_PROGRESS", jobId: message.jobId, progress: message });
    return;
  }
  if (message?.type !== "result" || message.jobId !== activeJobId) return;
  if (message.status === "completed") {
    const validation = await validateReceipt(message.publicReceipt);
    if (!validation.ok) {
      preferences.message = `Worker receipt did not pass validation: ${validation.errors.join(", ")}`;
      dispatch({ type: "JOB_COMPLETED", jobId: message.jobId, status: "failed", diagnostic: preferences.message });
      return;
    }
    preferences.message = "Completed public receipt verified. Auditor labels and withheld scores are separate; replay snapshots include visible subject state.";
    dispatch({ type: "JOB_COMPLETED", jobId: message.jobId, status: "completed", receipt: validation.value });
    return;
  }
  if (message.status === "cancelled") {
    preferences.message = "Run cancelled at a seed-block boundary. No partial receipt was created.";
    dispatch({ type: "JOB_CANCELLED", jobId: message.jobId });
    return;
  }
  preferences.message = message.diagnostic ?? `Worker finished with status ${message.status}.`;
  dispatch({
    type: "JOB_COMPLETED",
    jobId: message.jobId,
    status: message.status,
    diagnostic: message.diagnostic ?? "worker did not complete the run",
  });
}

function replaySelected() {
  const receipt = selectedReceipt();
  const methodId = preferences.methodId;
  const seedBlockIndex = Number(preferences.blockIndex);
  if (!receipt || !methodId || !Number.isSafeInteger(seedBlockIndex)) return;
  dispatch({ type: "REPLAY_RECEIPT", experimentId: receipt.experimentId, methodId, seedBlockIndex });
  const replay = session.replay;
  if (!replay) return;
  Promise.resolve().then(() => replayReceiptAssay(receipt, methodId, seedBlockIndex)).then((result) => {
    dispatch({ type: "REPLAY_RECEIPT", experimentId: receipt.experimentId, methodId, seedBlockIndex, result });
  }).catch((error) => {
    preferences.message = `Replay failed: ${error.message}`;
    render();
  });
}

document.getElementById("start-button").addEventListener("click", startRun);
document.getElementById("cancel-button").addEventListener("click", requestCancel);
document.getElementById("export-json-button").addEventListener("click", () => { void exportJson(); });
document.getElementById("export-csv-button").addEventListener("click", exportCsv);
document.getElementById("clear-button").addEventListener("click", () => {
  dispatch({ type: "CLEAR_RECEIPTS" });
  preferences.message = "Local receipt ledger cleared.";
  render();
});
document.getElementById("replay-button").addEventListener("click", replaySelected);
document.getElementById("config-file").addEventListener("change", (event) => loadConfigFile(event.target.files?.[0]));
document.getElementById("receipt-file").addEventListener("change", (event) => importReceiptFile(event.target.files?.[0]));
document.getElementById("ledger-search").addEventListener("input", (event) => dispatch({ type: "SET_LEDGER_QUERY", query: event.target.value }));
document.getElementById("snapshot-select").addEventListener("change", (event) => { preferences.snapshotIndex = event.target.value; render(); });
document.getElementById("method-select").addEventListener("change", (event) => { preferences.methodId = event.target.value; preferences.blockIndex = ""; render(); });
document.getElementById("block-select").addEventListener("change", (event) => { preferences.blockIndex = event.target.value; render(); });
document.getElementById("region-select").addEventListener("change", (event) => { preferences.region = event.target.value; render(); });
document.getElementById("channel-select").addEventListener("change", (event) => { preferences.channel = event.target.value; render(); });
document.getElementById("receipt-ledger").addEventListener("click", (event) => {
  const button = event.target.closest("[data-receipt-id]");
  if (!button) return;
  preferences.methodId = "";
  preferences.blockIndex = "";
  preferences.snapshotIndex = "";
  dispatch({ type: "SELECT_RECEIPT", experimentId: button.dataset.receiptId });
});
document.getElementById("subject-grid").addEventListener("click", (event) => {
  const cell = event.target.closest("[data-cell-index]");
  const receipt = selectedReceipt();
  const snapshot = receipt?.snapshots.find((entry) => String(entry.seedBlockIndex) === String(preferences.snapshotIndex));
  if (!cell || !snapshot) return;
  document.getElementById("cell-detail").textContent = describeCell(snapshot.snapshot, Number(cell.dataset.cellIndex), preferences.channel);
});

if (worker) worker.addEventListener("message", (event) => { void handleWorkerMessage(event); });
if (worker) worker.addEventListener("error", (event) => updateMessage(`Worker error: ${event.message}`));
render();
void loadBundledConfig();
