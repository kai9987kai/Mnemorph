import { runExperimentJob } from "./experiment-engine.js";

export function attachExperimentWorker(scope = globalThis.self) {
  if (!scope || typeof scope.postMessage !== "function") {
    throw new TypeError("worker scope must provide postMessage");
  }
  const activeJobs = new Map();

  const handleMessage = async (event) => {
    const message = event?.data;
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      scope.postMessage({ type: "result", status: "invalid", jobId: "", diagnostic: "worker message must be an object" });
      return;
    }
    if (message.type === "cancel") {
      const job = activeJobs.get(message.jobId);
      if (job) job.cancelled = true;
      return;
    }
    if (message.type !== "start") {
      scope.postMessage({
        type: "result",
        status: "invalid",
        jobId: typeof message.jobId === "string" ? message.jobId : "",
        diagnostic: "worker message type must be start or cancel",
      });
      return;
    }
    if (activeJobs.has(message.jobId)) {
      scope.postMessage({
        type: "result",
        status: "invalid",
        jobId: message.jobId,
        diagnostic: "jobId is already active",
      });
      return;
    }

    const job = { cancelled: false };
    activeJobs.set(message.jobId, job);
    const result = await runExperimentJob({
      jobId: message.jobId,
      config: message.config,
      isCancelled: () => job.cancelled,
      onProgress: (progress) => scope.postMessage(progress),
    });
    if (activeJobs.get(message.jobId) === job) activeJobs.delete(message.jobId);
    scope.postMessage({ type: "result", ...result });
  };

  if (typeof scope.addEventListener === "function") scope.addEventListener("message", handleMessage);
  else scope.onmessage = handleMessage;
  return handleMessage;
}

if (globalThis.self && typeof globalThis.self.postMessage === "function") attachExperimentWorker(globalThis.self);
