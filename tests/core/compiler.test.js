import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RUN_CONFIG } from "../../src/core/config.js";
import { createHypothesisBank } from "../../src/core/hypotheses.js";

const compilerModule = await import("../../src/core/compiler.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return null;
  throw error;
});

function requireCompiler() {
  assert.ok(compilerModule, "expected src/core/compiler.js to export the bounded compiler API");
  return compilerModule;
}

function makeGrammar() {
  return {
    schemaVersion: 1,
    grammarId: "starter",
    version: 0,
    operationTemplates: [
      { type: "lesion", armId: "treatment", region: "body", fraction: 0.25, atTick: 0 },
      { type: "lesion", armId: "treatment", region: "head", fraction: 0.25, atTick: 0 },
      { type: "scramble", armId: "treatment", region: "body", channel: "trace", intensity: 0.5, atTick: 0 },
      { type: "context-shift", armId: "treatment", cueToAction: [1, 0], atTick: 0 },
    ],
    protocolTemplates: [],
  };
}

test("enumerationNeverExceedsConfiguredBudget", () => {
  const { enumerateCandidates } = requireCompiler();
  const grammar = makeGrammar();
  grammar.operationTemplates = Array.from({ length: 12 }, (_, index) => ({
    type: "lesion",
    armId: "treatment",
    region: index % 2 === 0 ? "body" : "head",
    fraction: 0.1 + (index % 4) * 0.1,
    atTick: 0,
  }));
  const config = { ...DEFAULT_RUN_CONFIG, candidateEvaluationsPerBatch: 7, protocolLengthCap: 4 };
  const candidates = enumerateCandidates(grammar, config);
  assert.ok(candidates.length <= 7);
  assert.ok(candidates.every((program) => program.operations.length <= 4));
});

test("informationGainPrefersDiscriminatingProgram", () => {
  const { scoreCandidate } = requireCompiler();
  const bank = createHypothesisBank();
  const baseline = scoreCandidate({ programId: "empty", operations: [] }, bank, { runConfig: DEFAULT_RUN_CONFIG });
  const discriminating = scoreCandidate({
    programId: "transfer-context",
    operations: [{ type: "context-shift", armId: "treatment", cueToAction: [1, 0], atTick: 0 }],
  }, bank, { runConfig: DEFAULT_RUN_CONFIG, visibleHistory: { stage: "transfer" } });
  assert.ok(discriminating.informationGain > baseline.informationGain);
  assert.ok(discriminating.score > baseline.score);
});

test("penalizesInvalidAndDestructiveProgram", () => {
  const { scoreCandidate } = requireCompiler();
  const bank = createHypothesisBank();
  const valid = scoreCandidate({ programId: "valid", operations: [] }, bank, {});
  const destructive = scoreCandidate({
    programId: "destructive",
    operations: [{ type: "lesion", armId: "treatment", region: "body", fraction: 1, atTick: 0 }],
  }, bank, { allArmsLostProbability: 0.95 });
  const invalid = scoreCandidate({ programId: "invalid", operations: [{ type: "execute-code", source: "x" }] }, bank, {});
  assert.ok(destructive.score < valid.score);
  assert.ok(invalid.score < valid.score);
  assert.equal(invalid.penalties.invalidProbability, 1);
  assert.equal(destructive.penalties.allArmsLostProbability, 0.95);
});

test("tieBreakUsesCanonicalJson", () => {
  const { selectAssays } = requireCompiler();
  const grammar = makeGrammar();
  grammar.operationTemplates = [];
  grammar.protocolTemplates = [
    { programId: "zeta", operations: [] },
    { programId: "alpha", operations: [] },
  ];
  const selected = selectAssays({
    grammar,
    bank: createHypothesisBank(),
    history: {},
    budget: { candidateEvaluations: 2, assayCount: 2, config: DEFAULT_RUN_CONFIG },
  });
  assert.deepEqual(selected.map((entry) => entry.program.programId), ["alpha", "zeta"]);
  assert.equal(selected[0].score, selected[1].score);
});

test("grammarRevisionAddsSuccessfulTemplateOnlyBetweenBatches", () => {
  const { reviseGrammar } = requireCompiler();
  const grammar = makeGrammar();
  const successful = {
    programId: "successful-template",
    operations: [{ type: "lesion", armId: "treatment", region: "head", fraction: 0.25, atTick: 0 }],
  };
  const completedBatch = {
    status: "completed",
    protocolResults: [{
      program: successful,
      preAssayPrediction: { retained: 0.1, partial: 0.1, lost: 0.8 },
      postAssayPrediction: { retained: 0.8, partial: 0.1, lost: 0.1 },
      observedCategory: "retained",
    }],
  };
  assert.throws(() => reviseGrammar(grammar, { ...completedBatch, status: "running" }), /completed batch/i);
  const revised = reviseGrammar(grammar, completedBatch);
  assert.equal(revised.version, 1);
  assert.ok(revised.protocolTemplates.some((program) => program.programId === "successful-template"));
});

test("grammarRevisionIsDeterministicAndBounded", () => {
  const { reviseGrammar } = requireCompiler();
  const grammar = makeGrammar();
  const manyResults = Array.from({ length: 100 }, (_, index) => ({
    program: {
      programId: `success-${index}`,
      operations: [{ type: "context-shift", armId: "treatment", cueToAction: [1, 0], atTick: 0 }],
    },
    preAssayPrediction: { retained: 0.05, partial: 0.05, lost: 0.9 },
    postAssayPrediction: { retained: 0.9, partial: 0.05, lost: 0.05 },
    observedCategory: "retained",
  }));
  const batch = { status: "completed", protocolResults: manyResults };
  const first = reviseGrammar(grammar, batch);
  const second = reviseGrammar(grammar, batch);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(first.protocolTemplates.length <= 64);
  assert.ok(first.protocolTemplates.every((program) => program.operations.length <= 4));
});

test("grammarCannotAddExecutableOperation", () => {
  const { enumerateCandidates, reviseGrammar } = requireCompiler();
  const grammar = makeGrammar();
  grammar.operationTemplates.push({ type: "execute-code", source: "process.env" });
  assert.throws(() => enumerateCandidates(grammar, DEFAULT_RUN_CONFIG), /invalid|operation|vocabulary/i);
  const revised = reviseGrammar(makeGrammar(), {
    status: "completed",
    protocolResults: [{
      program: { programId: "unsafe", operations: [{ type: "execute-code", source: "process.env" }] },
      preAssayPrediction: { retained: 0.1, partial: 0.1, lost: 0.8 },
      postAssayPrediction: { retained: 0.9, partial: 0.05, lost: 0.05 },
      observedCategory: "retained",
    }],
  });
  assert.equal(revised.protocolTemplates.some((program) => program.programId === "unsafe"), false);
});
