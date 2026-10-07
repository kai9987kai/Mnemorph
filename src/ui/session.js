const VALID_CLAIM_STATUSES = new Set(["exploratory", "confirmatory", "null", "invalid"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isPublicReceipt(receipt) {
  return isRecord(receipt)
    && receipt.schemaVersion === 1
    && receipt.receiptType === "public-run"
    && typeof receipt.experimentId === "string"
    && VALID_CLAIM_STATUSES.has(receipt.claimStatus)
    && Array.isArray(receipt.rows)
    && Array.isArray(receipt.rawRows)
    && Array.isArray(receipt.snapshots)
    && Array.isArray(receipt.methods)
    && Array.isArray(receipt.seedKeys)
    && isRecord(receipt.digest)
    && receipt.digest.algorithm === "SHA-256"
    && typeof receipt.digest.value === "string";
}

function hasVerifiedClaim(receipt) {
  if (!isPublicReceipt(receipt)) return false;
  if (receipt.claimStatus === "confirmatory") {
    return receipt.confirmatoryPlan?.locked === true
      && receipt.confirmatoryAnalysis?.status === "confirmatory_success";
  }
  if (receipt.claimStatus === "null") {
    return receipt.confirmatoryPlan?.locked === true
      && receipt.confirmatoryAnalysis?.status === "null_supported";
  }
  return true;
}

function withReceipt(state, receipt) {
  const existingIndex = state.receipts.findIndex((item) => item.experimentId === receipt.experimentId);
  const receipts = [...state.receipts];
  if (existingIndex >= 0) receipts[existingIndex] = receipt;
  else receipts.push(receipt);
  return { ...state, receipts, selectedReceiptId: receipt.experimentId };
}

export function createSessionState() {
  return {
    job: {
      status: "idle",
      jobId: null,
      progress: { completedSeedBlocks: 0, totalSeedBlocks: 0 },
      diagnostic: null,
    },
    receipts: [],
    selectedReceiptId: null,
    ledgerQuery: "",
    replay: null,
  };
}

export function reduceSession(state, action) {
  if (!isRecord(state) || !isRecord(action) || typeof action.type !== "string") return state;
  switch (action.type) {
    case "JOB_STARTED": {
      if (state.job?.status === "running" || typeof action.jobId !== "string" || action.jobId.length === 0) return state;
      return {
        ...state,
        job: {
          status: "running",
          jobId: action.jobId,
          progress: { completedSeedBlocks: 0, totalSeedBlocks: action.totalSeedBlocks ?? 0 },
          diagnostic: null,
        },
        replay: null,
      };
    }
    case "JOB_PROGRESS": {
      if (state.job?.status !== "running" || action.jobId !== state.job.jobId || !isRecord(action.progress)) return state;
      const { completedSeedBlocks, totalSeedBlocks } = action.progress;
      if (!Number.isSafeInteger(completedSeedBlocks) || completedSeedBlocks < state.job.progress.completedSeedBlocks
        || !Number.isSafeInteger(totalSeedBlocks) || totalSeedBlocks < completedSeedBlocks) return state;
      return { ...state, job: { ...state.job, progress: { completedSeedBlocks, totalSeedBlocks } } };
    }
    case "JOB_COMPLETED": {
      if (state.job?.status !== "running" || action.jobId !== state.job.jobId) return state;
      if (action.status !== "completed") {
        return {
          ...state,
          job: { ...state.job, status: action.status === "invalid" ? "invalid" : "failed", diagnostic: action.diagnostic ?? null },
        };
      }
      if (!hasVerifiedClaim(action.receipt)) {
        return {
          ...state,
          job: { ...state.job, status: "failed", diagnostic: "completion receipt failed claim or schema checks" },
        };
      }
      return { ...withReceipt(state, action.receipt), job: { ...state.job, status: "completed", diagnostic: null } };
    }
    case "JOB_CANCELLED": {
      if (state.job?.status !== "running" || action.jobId !== state.job.jobId) return state;
      return { ...state, job: { ...state.job, status: "cancelled", diagnostic: null }, replay: null };
    }
    case "IMPORT_RECEIPT": {
      if (!hasVerifiedClaim(action.receipt)) return state;
      return withReceipt(state, action.receipt);
    }
    case "REPLAY_RECEIPT": {
      if (action.result) {
        const replay = state.replay;
        if (!replay || replay.status !== "ready" || replay.spec.experimentId !== action.experimentId
          || replay.spec.methodId !== action.methodId || replay.spec.seedBlockIndex !== action.seedBlockIndex) return state;
        return { ...state, replay: { ...replay, status: "completed", result: action.result } };
      }
      const receipt = state.receipts.find((item) => item.experimentId === action.experimentId);
      const row = receipt?.rows.find((item) => item.methodId === action.methodId && item.seedBlockIndex === action.seedBlockIndex);
      const snapshot = receipt?.snapshots.find((item) => item.seedBlockIndex === action.seedBlockIndex);
      if (!receipt || !row || !snapshot || !row.selectedProgram
        || row.initialSnapshotHash !== snapshot.snapshotHash || row.masterSeed !== snapshot.masterSeed) return state;
      const spec = {
        experimentId: receipt.experimentId,
        methodId: row.methodId,
        seedBlockIndex: row.seedBlockIndex,
        masterSeed: snapshot.masterSeed,
        lineageId: snapshot.lineageId,
        config: receipt.config,
        snapshot: snapshot.snapshot,
        snapshotHash: snapshot.snapshotHash,
        protocol: row.selectedProgram,
      };
      return { ...state, selectedReceiptId: receipt.experimentId, replay: { status: "ready", spec, result: null } };
    }
    case "SET_LEDGER_QUERY":
      return typeof action.query === "string" ? { ...state, ledgerQuery: action.query } : state;
    case "SELECT_RECEIPT":
      return state.receipts.some((receipt) => receipt.experimentId === action.experimentId)
        ? { ...state, selectedReceiptId: action.experimentId, replay: null }
        : state;
    case "CLEAR_RECEIPTS":
      return { ...state, receipts: [], selectedReceiptId: null, ledgerQuery: "", replay: null };
    default:
      return state;
  }
}

export function selectVisibleReceipts(state) {
  if (!Array.isArray(state?.receipts)) return [];
  const query = String(state.ledgerQuery ?? "").trim().toLocaleLowerCase();
  const receipts = [...state.receipts].reverse();
  if (!query) return receipts;
  return receipts.filter((receipt) => {
    const searchable = [
      receipt.experimentId,
      receipt.claimStatus,
      receipt.source?.version,
      ...receipt.methods,
      ...receipt.rows.flatMap((row) => [
        row.methodId,
        row.selectedProgram?.programId,
        ...(row.selectedProgram?.operations ?? []).map((operation) => operation.type),
        row.status,
      ]),
      ...receipt.seedKeys,
    ].filter((value) => value !== undefined && value !== null).join(" ").toLocaleLowerCase();
    return searchable.includes(query);
  });
}
