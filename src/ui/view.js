import { selectVisibleReceipts } from "./session.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function byId(document, id) {
  return document.getElementById(id);
}

function setText(document, id, value) {
  const node = byId(document, id);
  if (node) node.textContent = value;
}

function setHtml(document, id, value) {
  const node = byId(document, id);
  if (node) node.innerHTML = value;
}

function fillSelect(node, choices, value, emptyText) {
  if (!node) return "";
  if (choices.length === 0) {
    node.innerHTML = `<option value="">${escapeHtml(emptyText)}</option>`;
    node.disabled = true;
    return "";
  }
  node.disabled = false;
  node.innerHTML = choices.map((choice) => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`).join("");
  const chosen = choices.some((choice) => String(choice.value) === String(value)) ? String(value) : String(choices[0].value);
  node.value = chosen;
  return chosen;
}

function channelValue(cell, channel) {
  const value = cell.channels[channel];
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + item, 0) / Math.max(1, value.length);
  return value;
}

function percentageClass(value) {
  const bounded = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return `width-${Math.round(bounded * 100)}`;
}

function renderSubject(document, receipt, preferences) {
  const selector = byId(document, "snapshot-select");
  const snapshots = receipt?.snapshots ?? [];
  const selectedBlock = fillSelect(selector, snapshots.map((snapshot) => ({
    value: snapshot.seedBlockIndex,
    label: `Block ${snapshot.seedBlockIndex + 1} · seed ${snapshot.masterSeed}`,
  })), preferences.snapshotIndex, "No snapshots");
  preferences.snapshotIndex = selectedBlock;
  const record = snapshots.find((snapshot) => String(snapshot.seedBlockIndex) === selectedBlock);
  if (!record) {
    setText(document, "subject-meta", "AWAITING RUN");
    setHtml(document, "subject-grid", "A completed run will add replayable subject snapshots here.");
    byId(document, "subject-grid")?.classList.add("empty-state");
    return;
  }
  const subject = JSON.parse(record.snapshot);
  const region = preferences.region ?? "all";
  const channel = preferences.channel ?? "voltage";
  const grid = byId(document, "subject-grid");
  if (grid) {
    grid.classList.remove("empty-state");
    for (let columns = 4; columns <= 64; columns += 1) grid.classList.remove(`columns-${columns}`);
    grid.classList.add(`columns-${subject.grid.width}`);
  }
  setText(document, "subject-meta", `${subject.grid.width} × ${subject.grid.height} CELLS · SEED ${record.masterSeed}`);
  setHtml(document, "subject-grid", subject.grid.cells.map((cell) => {
    const value = channelValue(cell, channel);
    const dimmed = region !== "all" && cell.region !== region ? " dimmed" : "";
    const numeric = Number.isFinite(value) ? value : 0;
    const brightness = Math.max(0.62, Math.min(1.22, 0.82 + Math.abs(numeric) * 0.25));
    const brightnessStep = Math.round((brightness - 0.62) / 0.05);
    const display = Number.isFinite(value) ? value.toFixed(2) : "—";
    const label = `Cell ${cell.index}, ${cell.region}, ${channel} ${display}${cell.alive ? "" : ", lost"}`;
    return `<button type="button" class="cell region-${escapeHtml(cell.region)}${dimmed} brightness-${brightnessStep}" data-cell-index="${cell.index}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${escapeHtml(display)}</button>`;
  }).join(""));
  setText(document, "cell-detail", "Select a cell to inspect its local state.");
}

function renderProtocol(document, receipt, preferences) {
  const methods = receipt?.methods ?? [];
  const methodSelect = byId(document, "method-select");
  const methodId = fillSelect(methodSelect, methods.map((id) => ({ value: id, label: id })), preferences.methodId, "No method rows");
  preferences.methodId = methodId;
  const methodRows = (receipt?.rows ?? []).filter((row) => row.methodId === methodId);
  const blockSelect = byId(document, "block-select");
  const blockIndex = fillSelect(blockSelect, methodRows.map((row) => ({
    value: row.seedBlockIndex,
    label: `Block ${row.seedBlockIndex + 1} · seed ${row.masterSeed}`,
  })), preferences.blockIndex, "No seed blocks");
  preferences.blockIndex = blockIndex;
  const row = methodRows.find((entry) => String(entry.seedBlockIndex) === blockIndex) ?? methodRows[0];
  if (!row) {
    setText(document, "protocol-cost", "—");
    setHtml(document, "protocol-list", '<li class="muted">Protocol details appear after a run.</li>');
    setHtml(document, "hypothesis-board", '<p class="muted">Prediction distributions appear here.</p>');
    setText(document, "claim-badge", "NO RESULT");
    return null;
  }
  const program = row.selectedProgram;
  const operations = program?.operations ?? [];
  setText(document, "protocol-cost", `${operations.length} OP${operations.length === 1 ? "" : "S"} · ${row.budget?.candidateEvaluationsUsed ?? 0} CANDIDATES`);
  setHtml(document, "protocol-list", operations.length === 0
    ? '<li class="muted">No intervention operations were selected.</li>'
    : operations.map((operation) => `<li><span class="operation-code">${escapeHtml(operation.type)} · ${escapeHtml(JSON.stringify(operation))}</span></li>`).join(""));
  const prediction = row.selectedPrediction?.predictions;
  const categories = ["retained", "partial", "lost"];
  setHtml(document, "hypothesis-board", prediction
    ? Object.entries(prediction).map(([id, distribution]) => {
      const values = categories.map((category) => Number(distribution[category] ?? 0));
      return `<div class="hypothesis-row"><span class="hypothesis-name">${escapeHtml(id)}</span><span class="probability-stack" role="img" aria-label="${escapeHtml(id)} prediction: retained ${values[0].toFixed(3)}, partial ${values[1].toFixed(3)}, lost ${values[2].toFixed(3)}"><i class="${percentageClass(values[0])}"></i><i class="${percentageClass(values[1])}"></i><i class="${percentageClass(values[2])}"></i></span><span class="probability-value">${values[0].toFixed(2)}</span></div>`;
    }).join("")
    : '<p class="muted">This method did not record a hypothesis prediction.</p>');
  const badge = byId(document, "claim-badge");
  if (badge) {
    badge.textContent = receipt.claimStatus.toUpperCase();
    badge.className = `pill subtle ${receipt.claimStatus}`;
  }
  return row;
}

function categoryFor(row, stage) {
  return row.assay?.observations?.treatment?.[stage]?.category ?? null;
}

function categoryBadge(category) {
  return `<span class="category ${escapeHtml(category ?? "none")}">${escapeHtml(category ?? "—")}</span>`;
}

function renderOutcomes(document, receipt) {
  const rows = receipt?.rows ?? [];
  if (rows.length === 0) {
    setHtml(document, "outcome-chart", "Run an experiment to compare outcome categories across methods.");
    byId(document, "outcome-chart")?.classList.add("empty-state");
    setHtml(document, "outcome-rows", '<tr><td colspan="5" class="muted">No outcomes yet.</td></tr>');
    return;
  }
  byId(document, "outcome-chart")?.classList.remove("empty-state");
  const methodIds = [...new Set(rows.map((row) => row.methodId))];
  const chartHtml = methodIds.map((methodId) => {
    const methodRows = rows.filter((row) => row.methodId === methodId);
    const counts = { retained: 0, partial: 0, lost: 0, ineligible: 0 };
    for (const row of methodRows) {
      if (row.status === "ineligible") counts.ineligible += 1;
      else {
        const category = categoryFor(row, "afterRegrowth");
        if (Object.hasOwn(counts, category)) counts[category] += 1;
      }
    }
    const total = methodRows.length || 1;
    return `<div class="method-bar"><span class="method-bar-name">${escapeHtml(methodId)}</span><span class="stacked-bar" role="img" aria-label="${escapeHtml(methodId)} outcomes: retained ${counts.retained}, partial ${counts.partial}, lost ${counts.lost}, ineligible ${counts.ineligible}"><span class="retained ${percentageClass(counts.retained / total)}"></span><span class="partial ${percentageClass(counts.partial / total)}"></span><span class="lost ${percentageClass(counts.lost / total)}"></span><span class="ineligible ${percentageClass(counts.ineligible / total)}"></span></span><span class="bar-count">${methodRows.length}</span></div>`;
  }).join("");
  setHtml(document, "outcome-chart", chartHtml);
  const shown = rows.slice(0, 100);
  const table = shown.map((row) => `<tr><td>${escapeHtml(row.methodId)}</td><td>${escapeHtml(row.masterSeed)}</td><td>${escapeHtml(row.status)}</td><td>${categoryBadge(categoryFor(row, "afterRegrowth"))}</td><td>${categoryBadge(categoryFor(row, "transfer"))}</td></tr>`).join("");
  setHtml(document, "outcome-rows", `${table}${rows.length > shown.length ? `<tr><td colspan="5" class="muted">Showing ${shown.length} of ${rows.length} rows; raw receipt retains every outcome.</td></tr>` : ""}`);
}

function renderLedger(document, state, selectedReceipt) {
  const visible = selectVisibleReceipts(state);
  const search = byId(document, "ledger-search");
  if (search && search.value !== state.ledgerQuery) search.value = state.ledgerQuery ?? "";
  setHtml(document, "receipt-ledger", visible.length === 0
    ? '<p class="muted">No receipts match this search.</p>'
    : visible.map((receipt) => `<button type="button" class="receipt-item" data-receipt-id="${escapeHtml(receipt.experimentId)}" aria-pressed="${receipt.experimentId === selectedReceipt?.experimentId}"><span><strong>${escapeHtml(receipt.experimentId)}</strong><small>${escapeHtml(receipt.source.version)} · ${receipt.seedKeys.length} seeds · ${receipt.rows.length} method rows</small></span><span class="claim-tag ${escapeHtml(receipt.claimStatus)}">${escapeHtml(receipt.claimStatus)}</span></button>`).join(""));
}

function updateControls(document, state, preferences, selectedRow) {
  const running = state.job?.status === "running";
  const receipt = state.receipts.find((item) => item.experimentId === state.selectedReceiptId);
  const selectedReceipt = receipt ?? state.receipts.at(-1);
  const available = Boolean(selectedReceipt);
  const selectedRowExists = Boolean(selectedRow);
  const start = byId(document, "start-button");
  const cancel = byId(document, "cancel-button");
  if (start) start.disabled = running || preferences.canRun !== true;
  if (cancel) cancel.disabled = !running;
  for (const id of ["export-json-button", "export-csv-button"]) if (byId(document, id)) byId(document, id).disabled = !available;
  if (byId(document, "clear-button")) byId(document, "clear-button").disabled = state.receipts.length === 0;
  if (byId(document, "replay-button")) byId(document, "replay-button").disabled = !selectedRowExists || !available;
}

export function renderSession(document, state, preferences = {}) {
  const selected = state.receipts.find((receipt) => receipt.experimentId === state.selectedReceiptId)
    ?? state.receipts.at(-1)
    ?? null;
  const job = state.job ?? {};
  const progress = job.progress ?? { completedSeedBlocks: 0, totalSeedBlocks: 0 };
  const progressNode = byId(document, "run-progress");
  if (progressNode) {
    progressNode.max = Math.max(1, progress.totalSeedBlocks || 1);
    progressNode.value = progress.completedSeedBlocks || 0;
  }
  const status = {
    idle: "Ready for a local synthetic run.",
    running: `Running · ${progress.completedSeedBlocks} of ${progress.totalSeedBlocks} seed blocks complete.`,
    completed: `Completed · ${selected?.claimStatus ?? "receipt saved"}.`,
    cancelled: `Cancelled · ${progress.completedSeedBlocks} of ${progress.totalSeedBlocks} seed blocks finished; no partial receipt was saved.`,
    invalid: `Invalid configuration · ${job.diagnostic ?? "check the selected run configuration"}`,
    failed: `Run failed · ${job.diagnostic ?? "diagnostic unavailable"}`,
  }[job.status] ?? "Ready.";
  setText(document, "run-status", status);
  renderSubject(document, selected, preferences);
  const selectedRow = renderProtocol(document, selected, preferences);
  renderOutcomes(document, selected);
  renderLedger(document, state, selected);
  setText(document, "replay-status", state.replay
    ? state.replay.status === "completed"
      ? `Replay ${state.replay.result.reproducible ? "matches" : "differs from"} the saved raw events · ${state.replay.result.rawRows.length} rows.`
      : `Ready to replay ${state.replay.spec.protocol.programId} from seed ${state.replay.spec.masterSeed}.`
    : "Choose a method and seed block, then replay its saved protocol.");
  setText(document, "app-message", preferences.message ?? "");
  updateControls(document, state, preferences, selectedRow);
}

export function describeCell(snapshotText, cellIndex, channel) {
  const subject = JSON.parse(snapshotText);
  const cell = subject.grid.cells[cellIndex];
  if (!cell) return "No cell selected.";
  return `Cell ${cell.index} · ${cell.region} · ${cell.alive ? "alive" : "lost"} · ${channel}: ${JSON.stringify(cell.channels[channel])}`;
}
