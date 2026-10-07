import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runExperimentBatch } from "../../src/worker/experiment-engine.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function readProjectText(path) {
  return readFile(new URL(path, `file://${ROOT.replaceAll("\\", "/")}/`), "utf8");
}

async function readProjectJson(path) {
  return JSON.parse(await readProjectText(path));
}

test("smokeCommandMatchesPackageScripts", async () => {
  const [readme, pkg, smoke] = await Promise.all([
    readProjectText("README.md"),
    readProjectJson("package.json"),
    readProjectJson("configs/benchmark-smoke.json"),
  ]);
  assert.equal(pkg.scripts.serve, "node tools/serve.js");
  assert.equal(pkg.scripts.benchmark, "node tools/run-benchmark.js");
  assert.match(readme, /npm run serve -- --port 4173/);
  assert.match(readme, /npm run benchmark -- --config configs\/benchmark-smoke\.json --out output\/smoke/);
  assert.equal(smoke.runConfig.measurementTrials, 8);
  assert.equal(smoke.masterSeeds.length, smoke.runConfig.seedBlockCount);
});

test("confirmatoryTemplateCannotRunWithoutLock", async () => {
  const template = await readProjectJson("configs/confirmatory-template.json");
  assert.equal(template.locked, false);
  assert.equal(template.lockState, "pilot-required");
  assert.equal(template.requiredSeedBlocks, null);
  assert.deepEqual(template.confirmatorySeeds, []);
  const execution = await runExperimentBatch({ config: template });
  assert.equal(execution.status, "invalid");
});

test("allEightAblationsAreNamed", async () => {
  const config = await readProjectJson("configs/ablations.json");
  assert.deepEqual(config.ablations.map(({ id }) => id), [
    "freeze_grammar",
    "freeze_hypothesis_updates",
    "random_selection",
    "remove_event_key_matching",
    "disable_transplant_delay",
    "disable_transfer_context",
    "no_grammar_mutation_equal_compute",
    "disable_null_audit",
  ]);
});

test("scientificBoundariesAppearInReadmeAndResearchNote", async () => {
  const [readme, research] = await Promise.all([
    readProjectText("README.md"),
    readProjectText("docs/research-note.md"),
  ]);
  for (const text of [readme, research]) {
    assert.match(text, /synthetic/i);
    assert.match(text, /biological/i);
    assert.match(text, /clinical/i);
  }
});

test("researchNoteStatesNullAndNoveltyLimits", async () => {
  const research = await readProjectText("docs/research-note.md");
  assert.match(research, /null/i);
  assert.match(research, /not an? exhaustive|not an exhaustive or systematic|not a systematic review/i);
  assert.match(research, /to our knowledge/i);
  assert.match(research, /falsif|unsupported/i);
});
