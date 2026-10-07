import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { DEFAULT_RUN_CONFIG } from "../../src/core/config.js";

const toolsModule = await import("../../tools/serve.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TEMP_BASE = join(ROOT, "output");
let tempRoot;
let configPath;

function requireTools() {
  assert.ok(toolsModule, "expected tools/serve.js to export the loopback server");
  return toolsModule;
}

function smallBenchmarkConfig() {
  return {
    schemaVersion: 1,
    name: "tools-test-v1",
    runConfig: {
      ...DEFAULT_RUN_CONFIG,
      gridWidth: 8,
      gridHeight: 8,
      trainingEpisodes: 128,
      measurementTrials: 8,
      seedBlockCount: 1,
      candidateEvaluationsPerBatch: 4,
      protocolLengthCap: 2,
    },
    masterSeeds: [81],
    familyIds: ["local-trace"],
    methods: ["adaptive-revisable-grammar", "frozen-grammar-information-gain"],
    withheldPrograms: [{
      programId: "tools-withheld-transfer",
      operations: [{ type: "context-shift", armId: "treatment", cueToAction: [1, 0], atTick: 0 }],
    }],
  };
}

async function startServerForTest() {
  const { startMnemorphServer } = requireTools();
  return startMnemorphServer({ port: 0 });
}

async function request(url, { method = "GET", path } = {}) {
  const address = new URL(url);
  return new Promise((resolvePromise, reject) => {
    const req = http.request({
      host: address.hostname,
      port: address.port,
      method,
      path: path ?? `${address.pathname}${address.search}`,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolvePromise({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

function runCli(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(ROOT, "tools", "run-benchmark.js"), ...args], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

before(async () => {
  await mkdir(TEMP_BASE, { recursive: true });
  tempRoot = await mkdtemp(join(TEMP_BASE, ".mnemorph-tools-"));
  configPath = join(tempRoot, "benchmark.json");
  await writeFile(configPath, JSON.stringify(smallBenchmarkConfig(), null, 2));
});

after(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

test("serverBindsLoopbackOnly", async () => {
  const { startMnemorphServer } = requireTools();
  const server = await startMnemorphServer({ port: 0 });
  try {
    assert.equal(server.address().address, "127.0.0.1");
    await assert.rejects(startMnemorphServer({ host: "0.0.0.0", port: 0 }), /loopback/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("rejectsTraversalAndUnsupportedMethods", async () => {
  const server = await startServerForTest();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const traversal = await request(base, { path: "/src/ui/%2e%2e/%2e%2e/package.json" });
    const post = await request(base, { method: "POST", path: "/" });
    assert.ok([400, 403].includes(traversal.status));
    assert.equal(post.status, 405);
    assert.match(post.headers.allow, /GET/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("servesHtmlModulesAndWorkerWithMimeTypes", async () => {
  const server = await startServerForTest();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const [html, module, worker, css, config, build] = await Promise.all([
      request(`${base}/`),
      request(`${base}/src/core/experiment.js`),
      request(`${base}/src/worker/worker-entry.js`),
      request(`${base}/src/ui/styles.css`),
      request(`${base}/__mnemorph-smoke.json`),
      request(`${base}/__mnemorph-build.json`),
    ]);
    assert.equal(html.status, 200);
    assert.match(html.headers["content-type"], /text\/html/);
    assert.match(html.body, /href="\/src\/ui\/styles\.css"/);
    assert.match(html.body, /src="\/src\/ui\/app\.js"/);
    assert.equal(module.status, 200);
    assert.match(module.headers["content-type"], /javascript/);
    assert.equal(worker.status, 200);
    assert.match(worker.headers["content-type"], /javascript/);
    assert.match(css.headers["content-type"], /text\/css/);
    assert.match(config.headers["content-type"], /application\/json/);
    assert.match(JSON.parse(build.body).hash, /^sha256:[a-f0-9]{64}$/);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("runnerWritesSeparateAuditorFile", async () => {
  const out = join(tempRoot, "separate");
  const result = await runCli(["--config", configPath, "--out", relative(ROOT, out)]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const files = JSON.parse(result.stdout);
  const publicReceipt = JSON.parse(await readFile(files.publicReceipt, "utf8"));
  const auditor = JSON.parse(await readFile(files.auditorRecord, "utf8"));
  const csv = await readFile(files.rawCsv, "utf8");
  assert.equal(publicReceipt.receiptType, "public-run");
  assert.equal("auditorRows" in publicReceipt, false);
  assert.equal(auditor.receiptType, "auditor-evaluation");
  assert.ok(auditor.auditorRows.some((row) => row.mechanismId === "local-trace"));
  assert.match(csv, /methodId,masterSeed,seedBlockIndex/);
  assert.ok(csv.split(/\r?\n/).length > 2);
});

test("runnerOutputReplaysFromSameConfigAndSeeds", async () => {
  const outA = join(tempRoot, "replay-a");
  const outB = join(tempRoot, "replay-b");
  const [resultA, resultB] = await Promise.all([
    runCli(["--config", configPath, "--out", relative(ROOT, outA)]),
    runCli(["--config", configPath, "--out", relative(ROOT, outB)]),
  ]);
  assert.equal(resultA.code, 0, resultA.stderr || resultA.stdout);
  assert.equal(resultB.code, 0, resultB.stderr || resultB.stdout);
  const filesA = JSON.parse(resultA.stdout);
  const filesB = JSON.parse(resultB.stdout);
  const receiptA = JSON.parse(await readFile(filesA.publicReceipt, "utf8"));
  const receiptB = JSON.parse(await readFile(filesB.publicReceipt, "utf8"));
  const comparable = (receipt) => {
    const { createdAt: _createdAt, digest: _digest, ...stable } = receipt;
    return stable;
  };
  assert.deepEqual(comparable(receiptA), comparable(receiptB));
  assert.equal(await readFile(filesA.rawCsv, "utf8"), await readFile(filesB.rawCsv, "utf8"));
  assert.equal(await readFile(filesA.auditorRecord, "utf8"), await readFile(filesB.auditorRecord, "utf8"));
});

test("runnerRejectsOutputPathsOutsideTheProject", async () => {
  const result = await runCli(["--config", configPath, "--out", "../mnemorph-escape-test"]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /output path must remain inside the project/);
});
