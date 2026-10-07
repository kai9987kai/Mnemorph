import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createAuditorRecord,
  createPublicReceipt,
  decodeRawRows,
  sealReceipt,
} from "../src/core/receipt.js";
import { runExperimentBatch } from "../src/worker/experiment-engine.js";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function parseBenchmarkArgs(args) {
  const options = { config: "configs/benchmark-smoke.json", out: "output/smoke", help: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument !== "--config" && argument !== "--out") throw new TypeError(`unknown option ${argument}`);
    if (seen.has(argument)) throw new TypeError(`${argument} may be supplied only once`);
    seen.add(argument);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${argument} requires a value`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function rawCsv(receipt) {
  const columns = ["methodId", "masterSeed", "seedBlockIndex", "lineageId", "armId", "stage", "trial", "cue", "targetAction", "chosenAction", "correct", "context"];
  const rows = decodeRawRows(receipt);
  return [columns.join(","), ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(","))].join("\r\n");
}

async function atomicWrite(path, contents) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function resolveOutputDirectory(outputArgument) {
  const absolute = resolve(PROJECT_ROOT, outputArgument);
  if (!inside(PROJECT_ROOT, absolute)) throw new TypeError("output path must remain inside the project");
  await mkdir(absolute, { recursive: true });
  const [realRoot, realOutput] = await Promise.all([realpath(PROJECT_ROOT), realpath(absolute)]);
  if (!inside(realRoot, realOutput)) throw new TypeError("output path must remain inside the project");
  return realOutput;
}

export async function runBenchmark({ configPath = "configs/benchmark-smoke.json", outputPath = "output/smoke", onProgress } = {}) {
  const absoluteConfig = resolve(configPath);
  const config = JSON.parse(await readFile(absoluteConfig, "utf8"));
  const outputDirectory = await resolveOutputDirectory(outputPath);
  const execution = await runExperimentBatch({
    jobId: `cli-${basename(absoluteConfig)}`,
    config,
    onProgress: onProgress ?? ((progress) => {
      process.stderr.write(`Seed blocks ${progress.completedSeedBlocks}/${progress.totalSeedBlocks}\n`);
    }),
  });
  if (execution.status !== "completed") {
    throw new Error(execution.diagnostic ?? `benchmark ended with status ${execution.status}`);
  }
  const publicReceipt = await createPublicReceipt(execution.batchResult);
  const sealedText = await sealReceipt(publicReceipt);
  const auditorText = `${JSON.stringify(createAuditorRecord(execution.batchResult), null, 2)}\n`;
  const csv = `${rawCsv(publicReceipt)}\r\n`;
  const paths = {
    publicReceipt: resolve(outputDirectory, "public-receipt.json"),
    auditorRecord: resolve(outputDirectory, "auditor-evaluation.json"),
    rawCsv: resolve(outputDirectory, "raw-events.csv"),
  };
  await Promise.all([
    atomicWrite(paths.publicReceipt, sealedText),
    atomicWrite(paths.auditorRecord, auditorText),
    atomicWrite(paths.rawCsv, csv),
  ]);
  return paths;
}

async function main() {
  try {
    const options = parseBenchmarkArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write("Usage: npm run benchmark -- [--config configs/benchmark-smoke.json] [--out output/smoke]\n");
      return;
    }
    const paths = await runBenchmark({ configPath: options.config, outputPath: options.out });
    process.stdout.write(`${JSON.stringify(paths)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void main();
