# Mnemorph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, reproducible research MVP that compares adaptive sequential memory assays with fixed and frozen-grammar baselines on synthetic subjects that learn, lose tissue, and regenerate.

**Architecture:** Pure JavaScript ES modules in `src/core/` hold the deterministic subject, intervention, hypothesis, compiler, scoring, and receipt logic shared by a browser Web Worker and a headless Node runner. A vanilla browser UI talks to the worker; a loopback-only Node server serves the app. No mechanism truth enters compiler inputs, and every run emits replayable public receipts plus a separate auditor record.

**Tech Stack:** JavaScript ES modules, Node.js 20 or later, browser Web Workers, HTML/CSS/Canvas, Node's built-in `node:test`, Node built-in HTTP and crypto APIs, and Web Crypto in the browser. Runtime dependencies: none.

**Spec:** `docs/superpowers/specs/2026-10-06-mnemorph-design.md`

## Global Constraints

- “This is a synthetic software model. It does not model a particular species, establish biological memory mechanisms, measure consciousness, or support clinical or ecological conclusions.”
- “Each assay program has at most four interventions.”
- “The compiler may update its predictive model and add a successful protocol template only between batches.”
- “The assay compiler operates only on the local typed vocabulary; it has no shell, network, arbitrary-code, or external-device access.”
- “Grid size, tick count, subject count, protocol length, and branch count are bounded by a run configuration.”
- “The MVP uses plain JavaScript modules and a Web Worker for simulation, plus a headless Node runner for reproducible batches. A small loopback-only static server supports browser module loading. No cloud service, large model, remote inference, or package download is required at runtime.”

## Review Focus

- Non-finite, negative, unknown, or over-limit run settings must fail validation before allocating subjects; pin this in Task 1.
- Subjects that fail the locked learning preflight must not be counted as memory-retention results; pin this in Task 3.
- Malformed, oversized, or incompatible snapshots must fail without changing an existing session; pin this in Tasks 4 and 11.
- Invalid or inapplicable operations must appear as explicit invalid operation receipts and must not silently pass as successful no-ops; pin this in Task 5.
- Cancellation during a batch must produce a cancelled run with no confirmatory success receipt; pin this in Task 12.

---

## File Map

- `package.json` — ESM metadata and native Node commands; no dependency install step.
- `.gitignore` — generated run output and local dependency folders.
- `src/core/config.js` — defaults, bounds, and strict run-config validation.
- `src/core/random.js` — serializable seeded PRNG and stable event-keyed draws.
- `src/core/subject.js` — benchmark-case construction, grid state, learning, and behavior measurements.
- `src/core/snapshot.js` — canonical snapshot validation, cloning, restoration, and digesting.
- `src/core/interventions.js` — typed intervention validation and isolated paired-arm mutations.
- `src/core/assay.js` — ordered program execution, regeneration, transfer contexts, and outcome bucketing.
- `src/core/hypotheses.js` — candidate causal models, predictions, Bayesian update, and Brier score.
- `src/core/compiler.js` — bounded candidate grammar, search, information-gain scoring, and between-batch revision.
- `src/core/experiment.js` — matched seeds, baselines, preregistered batches, raw observations, and auditor boundary.
- `src/core/statistics.js` — paired intervals, randomization analysis, multiplicity correction, and pilot power sizing.
- `src/core/receipt.js` — public/auditor receipt construction, hashing, validation, and transactional import.
- `src/worker/experiment-engine.js` — cancellable, chunked batch executor independent of browser globals.
- `src/worker/worker-entry.js` — Web Worker message adapter.
- `src/ui/index.html`, `src/ui/styles.css`, `src/ui/app.js`, `src/ui/view.js`, `src/ui/session.js` — accessible local interface and session state.
- `tools/serve.js` — loopback-only static server with path containment and MIME handling.
- `tools/run-benchmark.js` — headless CLI runner and JSON/CSV export.
- `configs/benchmark-smoke.json`, `configs/confirmatory-template.json`, `configs/ablations.json` — versioned bounded experiment configurations.
- `schemas/receipt-v1.json` — receipt interchange shape and version.
- `tests/core/`, `tests/worker/`, `tests/integration/` — deterministic unit, worker, CLI, receipt, and end-to-end coverage.
- `README.md`, `docs/research-note.md`, `docs/experiment-protocol.md`, `docs/safety-and-limits.md`, `docs/roadmap.md` — operational and research documentation.

## Task 1: Project Shell and Configuration Contract

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/core/config.js`
- Create: `tests/core/config.test.js`

**Interfaces:**
- Produces: `DEFAULT_RUN_CONFIG` and `validateRunConfig(input) -> { ok: boolean, value?: RunConfig, errors: Array<{path: string, code: string}> }`. Defaults: grid `12×8`, cue map `[0,1]`, reward noise `0.05`, `256` training episodes, `10000` max ticks, `8` seed blocks, `2` arms, protocol cap `4`, `64` candidate evaluations per batch, `100` measurement trials, thresholds `0.70/0.75/0.55`, and label `smoke`.
- `RunConfig` is JSON-only and contains `gridWidth`, `gridHeight`, binary `cueToAction`, `rewardNoise`, `trainingEpisodes`, `maxTicks`, `seedBlockCount`, `branchCount`, `protocolLengthCap`, `candidateEvaluationsPerBatch`, `measurementTrials`, `preflightAccuracy`, `retainedAccuracy`, `partialAccuracy`, and `runLabel`.

- [ ] **Step 1: Write failing config tests** named `acceptsDefaultsAndValidOverrides`, `rejectsUnknownAndNonFiniteFields`, `rejectsNegativeOrNonIntegerCounts`, `enforcesProtocolAndResourceCaps`, `rejectsGridProductAboveCellCap`, and `validatesCueMapAndRewardNoise`. Assert default grid `12×8`; width/height range `4..64`; default cue map `[0,1]`; `rewardNoise` range `0..0.25`; maximum `4096` cells, `1000` training episodes, `10000` ticks, `1000` measurement trials, `256` seed blocks, `32` branches, `4` operations per protocol, and `256` candidate evaluations per batch. Default outcome thresholds are preflight `0.70`, retained `0.75`, and partial `0.55`; reject thresholds unless `0.5 < partialAccuracy < retainedAccuracy <= 1` and `0.5 < preflightAccuracy <= 1`.
- [ ] **Step 2: Run `node --test tests/core/config.test.js`** and confirm the tests fail because the module does not exist.
- [ ] **Step 3: Implement the config contract** in `src/core/config.js` and ignore `/output/` and `/node_modules/` in `.gitignore`; reject unknown keys, non-finite values, and values outside the listed limits with stable error codes.
- [ ] **Step 4: Run `node --test tests/core/config.test.js`** and confirm every config test passes.
- [ ] **Step 5: Commit** as `feat: add bounded run configuration`.

## Task 2: Deterministic Randomness and Matched Event Keys

**Files:**
- Create: `src/core/random.js`
- Create: `tests/core/random.test.js`

**Interfaces:**
- Produces: `createRng(seed, state?) -> { nextUint32(), nextFloat(), snapshot() }` and `randomForEvent(masterSeed, eventParts) -> number` in `[0,1)`.
- Event keys are stable JSON tuples. Shared environmental events omit arm identity; treatment-specific events use a distinct event-channel component.

- [ ] **Step 1: Write failing tests** named `replaysPrngFromSnapshot`, `eventDrawIsStableAcrossCallOrder`, `sharedEventTupleHasNoArmComponent`, and `differentChannelsUseDifferentDraws`; assert exact equality for replay and stable tuple keys.
- [ ] **Step 2: Run `node --test tests/core/random.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement a documented 32-bit seeded generator** with JSON-safe state and a versioned event-key hash; avoid global `Math.random` in experiment code.
- [ ] **Step 4: Run `node --test tests/core/random.test.js`** and confirm all replay and key-isolation assertions pass.
- [ ] **Step 5: Commit** as `feat: add deterministic event-keyed randomness`.

## Task 3: Synthetic Subject, Learning Preflight, and Mechanism Families

**Files:**
- Create: `src/core/subject.js`
- Create: `tests/core/subject.test.js`

**Interfaces:**
- Produces: `createBenchmarkCase({seed, config, mechanismId, ruleId}) -> {subject, auditorRecord}`, `trainSubject(subject, {episodes}) -> {subject, trainingRows, summary}`, and `measureBehavior(subject, {context, trials, eventKey}) -> {rows, accuracy, category}`. `mechanismId` accepts each of the five named families or `open-substrate`; the latter generates a seeded mixture and records its recipe only in `auditorRecord`. Cue mapping is `[0,1]` or `[1,0]`; the binary task applies configured reward noise and stores both settings in the run configuration.
- The public subject contains only ordinary simulator state. `auditorRecord` is a separate object; no mechanism-family string or truth label is stored in the subject or training rows.
- Mechanism IDs: `local-trace`, `distributed-trace`, `regenerative-reconstruction`, `readout-adaptation`, and `context-gated`.

- [ ] **Step 1: Write failing tests** named `allFamiliesLearnAboveChanceAfterTraining`, `familyTruthIsOutsideVisibleSubject`, `openSubstrateRecipeIsAuditorOnly`, `preflightRejectsUntrainedSubject`, `measureBehaviorReturnsRawTrials`, and `developmentRuleIsFrozenForLifetime`. Use the binary cue task and locked `0.70` preflight threshold; assert configurable cue remapping and reward noise appear in the run config.
- [ ] **Step 2: Run `node --test tests/core/subject.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement the finite-grid state and local cue/reward learner.** Keep the selected development rule fixed per lifetime; write learned state to distinct local, distributed, reconstructive, readout, or context-gated state locations according to `mechanismId`; keep the mechanism identifier only in `auditorRecord`.
- [ ] **Step 4: Run `node --test tests/core/subject.test.js`** and confirm all five families pass the configured learning preflight and family separation assertions.
- [ ] **Step 5: Commit** as `feat: implement synthetic learning subjects`.

## Task 4: Snapshots, Integrity, and Matched Clone Forks

**Files:**
- Create: `src/core/snapshot.js`
- Create: `tests/core/snapshot.test.js`

**Interfaces:**
- Produces: `canonicalJson(value) -> string`, `snapshotSubject(subject) -> string`, `restoreSubjectSnapshot(text) -> Subject`, `forkSubject(subject) -> Subject`, and async `sha256Hex(text) -> string`.
- Snapshot schema includes every simulator field, generator state, event counter, and schema version needed for exact continuation.

- [ ] **Step 1: Write failing tests** named `snapshotRestoreContinuesBitExactly`, `forksStartFromEqualStateButAreIndependent`, `rejectsTruncatedUnknownVersionAndOversizedSnapshots`, `canonicalJsonIgnoresObjectInsertionOrder`, and `digestChangesWhenSnapshotChanges`. Assert snapshots over `2 MiB` and unknown schema versions are rejected.
- [ ] **Step 2: Run `node --test tests/core/snapshot.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement canonical JSON, strict subject validation, deep fork, and Web Crypto SHA-256.** Do not accept `undefined`, `NaN`, infinities, non-plain objects, or oversized input.
- [ ] **Step 4: Run `node --test tests/core/snapshot.test.js`** and confirm bit-exact continuation, isolation, bounds, and digest tests pass.
- [ ] **Step 5: Commit** as `feat: add validated replayable subject snapshots`.

## Task 5: Typed Intervention Programs and Paired-Arm Semantics

**Files:**
- Create: `src/core/interventions.js`
- Create: `tests/core/interventions.test.js`

**Interfaces:**
- Produces: `validateAssayProgram(program, config) -> {ok, errors}`, `applyOperation(arms, operation, eventContext) -> {arms, operationReceipt}`, and `validateIntervention(operation, knownArms) -> {ok, errors}`.
- Each operation declares `type`, target arm(s), region/channel as applicable, intensity, and timing. `transplant` names `sourceArm`, `targetArm`, and patch; other operations name the arm they alter. An assay contains at most four ordered operations.
- Supported types: lesion, silence, scramble, transplant, delay, regrow, context shift, and sham. Invalid operations return a receipt with `status: "invalid"` and a stable reason code.

- [ ] **Step 1: Write failing tests** named `acceptsAllEightTypedOperations`, `rejectsFifthOperationAndUnknownType`, `lesionChangesOnlyNamedClone`, `silenceBlocksNamedChannelForDuration`, `scramblePreservesValueHistogram`, `transplantSwapsNamedPatchOnly`, `shamPreservesStateAndTiming`, and `invalidTargetProducesExplicitReceipt`. Assert invalid operations do not mutate either arm and never return `status: "applied"`.
- [ ] **Step 2: Run `node --test tests/core/interventions.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement schema validation and pure paired-arm transforms.** Use event-keyed cell selection; ensure lesion/silence/scramble cannot touch an unnamed arm, silence expires after its declared duration, and transplant swaps the selected state patch between the named source and target arms.
- [ ] **Step 4: Run `node --test tests/core/interventions.test.js`** and confirm every type, boundedness, locality, and invalid-receipt assertion passes.
- [ ] **Step 5: Commit** as `feat: add typed causal assay interventions`.

## Task 6: Ordered Assay Execution and Transfer Outcomes

**Files:**
- Create: `src/core/assay.js`
- Create: `tests/core/assay.test.js`

**Interfaces:**
- Produces: `runAssayProgram({arms, program, config, eventContext}) -> {arms, observations, operationReceipts, status}`.
- Each arm records behavior before intervention, after regrowth, and after transfer-context testing. Outcome buckets are `retained`, `partial`, or `lost`, with thresholds in the versioned run config.

- [ ] **Step 1: Write failing tests** named `recordsBeforeAfterAndTransferRows`, `executesDelayBeforeLaterOperation`, `regrowsOnlyAfterRegrowOperation`, `regrowthUsesSurvivingNeighborhoodAndRule`, `contextShiftUsesLockedCueMapping`, `invalidOperationDoesNotDisappear`, and `allArmsSharePreInterventionState`. Assert raw per-trial rows remain available beside aggregate accuracy.
- [ ] **Step 2: Run `node --test tests/core/assay.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement ordered program execution** using Task 5 transforms and Task 3 observations; each regrowth tick fills wound-border cells from the majority role/state among surviving Moore-neighbors, with ties resolved by the frozen development rule and event-keyed draw. Stop the assay as invalid if required operations are invalid and preserve the failure receipt.
- [ ] **Step 4: Run `node --test tests/core/assay.test.js`** and confirm timing, regeneration, contexts, and paired-state assertions pass.
- [ ] **Step 5: Commit** as `feat: execute paired regeneration assays`.

## Task 7: Hypothesis Predictions, Bayesian Updates, and Primary Score

**Files:**
- Create: `src/core/hypotheses.js`
- Create: `tests/core/hypotheses.test.js`

**Interfaces:**
- Produces: `createHypothesisBank() -> HypothesisBank`, `predictOutcomeDistribution(hypothesis, program, visibleHistory) -> {retained, partial, lost}`, `updateHypotheses(bank, predictionRecord, observedCategory) -> HypothesisBank`, and `multiclassBrier(prediction, observedCategory) -> number`.
- Prediction records are frozen before outcomes are revealed. Auditor labels and records are not accepted by these functions.

- [ ] **Step 1: Write failing tests** named `predictionDistributionIsNormalized`, `bayesUpdateRaisesCompatibleHypothesis`, `likelihoodFloorPreventsZeroingAllHypotheses`, `brierScoreMatchesThreeCategoryDefinition`, `predictionRecordFreezesBeforeObservation`, and `compilerInputRejectsAuditorFields`. Assert Brier is the mean of three squared category-probability errors.
- [ ] **Step 2: Run `node --test tests/core/hypotheses.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement normalized rule-based predictions** for the five candidate families, Bayesian posterior update with a likelihood floor of `0.01`, and the preregistered three-category Brier score.
- [ ] **Step 4: Run `node --test tests/core/hypotheses.test.js`** and confirm prediction, calibration, and auditor-separation assertions pass.
- [ ] **Step 5: Commit** as `feat: score and update causal hypotheses`.

## Task 8: Bounded Assay Compiler and Between-Batch Grammar Revision

**Files:**
- Create: `src/core/compiler.js`
- Create: `tests/core/compiler.test.js`

**Interfaces:**
- Produces: `enumerateCandidates(grammar, config) -> AssayProgram[]`, `scoreCandidate(program, bank, costConfig) -> {score, informationGain, penalties}`, `selectAssays({grammar, bank, history, budget}) -> SelectionReceipt[]`, and `reviseGrammar(grammar, completedBatch) -> Grammar`; `completedBatch.status` must be `completed`.
- Selection score is `informationGain / (1 + operationCount/4 + expectedTicks/10000) - 0.5 * invalidProbability - 0.5 * allArmsLostProbability`, with information gain in bits. Ties break by canonical program JSON ascending. These exact weights and cost terms are stored in the confirmatory lock.
- Grammar revision can add, remove, reorder, or combine existing operation templates, but cannot invent executable code or expand beyond the fixed intervention vocabulary. Revision occurs only between batches.

- [ ] **Step 1: Write failing tests** named `enumerationNeverExceedsConfiguredBudget`, `informationGainPrefersDiscriminatingProgram`, `penalizesInvalidAndDestructiveProgram`, `tieBreakUsesCanonicalJson`, `grammarRevisionAddsSuccessfulTemplateOnlyBetweenBatches`, `grammarRevisionIsDeterministicAndBounded`, and `grammarCannotAddExecutableOperation`. Assert a grammar cannot exceed four operations per program; a successful template must be valid and improve visible within-batch Brier score by at least `0.01` versus the batch's pre-assay prediction.
- [ ] **Step 2: Run `node --test tests/core/compiler.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement deterministic beam search** with an explicit cap of `256` candidate evaluations per batch, entropy reduction `H(prior) - Σ P(outcome)H(posterior|outcome)` in bits, the stated cost and penalty formula, recorded score components, and batch-boundary grammar revision. Add a protocol template only between batches when it is valid and reduces visible within-batch Brier score by at least `0.01` versus the batch's pre-assay prediction.
- [ ] **Step 4: Run `node --test tests/core/compiler.test.js`** and confirm budget, ranking, tie-break, and grammar-boundary assertions pass.
- [ ] **Step 5: Commit** as `feat: add bounded adaptive assay compiler`.

## Task 9: Matched Experiment Orchestration and Baselines

**Files:**
- Create: `src/core/experiment.js`
- Create: `tests/core/experiment.test.js`
- Create: `configs/benchmark-smoke.json`
- Create: `configs/ablations.json`

**Interfaces:**
- Produces: `runMatchedBatch({config, methods, masterSeeds, familyIds, withheldPrograms}) -> BatchResult` and `buildBaselineMethods(config) -> Method[]`.
- Methods: fixed one-factor, fixed factorial where bounded, random under equal budget, frozen-grammar information gain, adaptive revisable grammar, and auditor-only oracle diagnostic.
- Each method receives equal seed blocks, initial snapshot, observation history, assay budget, and candidate-evaluation cap. Auditor truth is held in orchestration state and passed only to the final evaluator.

- [ ] **Step 1: Write failing integration tests** named `allMethodsForkSameSnapshotHash`, `sharedEventsMatchAcrossPairedArms`, `methodsReceiveEqualAssayAndSearchBudgets`, `auditorTruthNeverAppearsInCompilerHistory`, `withheldPredictionsAreRecordedBeforeScoring`, `invalidRunsRemainInDenominatorWithStatus`, and `ablationConfigDisablesOnlyNamedFeature`. Assert public rows contain no auditor family ID and withheld results never enter compiler history.
- [ ] **Step 2: Run `node --test tests/core/experiment.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement master-seed blocks and method adapters.** Use event keys `(masterSeed, lineageId, tick, channel)` for shared draws without arm identity; keep treatment-specific draws on a separate channel. Generate each method's prediction before executing its selected assay.
- [ ] **Step 4: Run `node --test tests/core/experiment.test.js`** and confirm matched-pair, budget, leakage, and invalid-run assertions pass.
- [ ] **Step 5: Commit** as `feat: run matched assay comparisons`.

## Task 10: Confirmatory Analysis and Preregistered Run Lock

**Files:**
- Create: `src/core/statistics.js`
- Create: `configs/confirmatory-template.json`
- Create: `tests/core/statistics.test.js`

**Interfaces:**
- Produces: `pairedDifferences(results, methodA, methodB)`, `pairedBootstrapInterval(differences, options)`, `pairedRandomizationP(differences, options)`, `holmAdjust(pValues)`, `estimateConfirmatoryN(pilotDifferences, options)`, and `analyzeConfirmatoryResults(lockedPlan, results)`.
- Primary direction is revisable-grammar Brier minus frozen-grammar Brier; lower is better. A positive advantage is a negative paired difference with the preregistered interval excluding zero.

- [ ] **Step 1: Write failing tests** named `pairedDifferenceUsesSeedBlocks`, `bootstrapUsesDeterministicResamplingSeed`, `randomizationTestIsPaired`, `holmAdjustmentIsMonotone`, `pilotSizingReturnsBoundedSeedCount`, `underpoweredPlanCannotClaimConfirmatorySuccess`, `primaryClaimRequiresNegativeBrierDifferenceAnd95PercentInterval`, `requiresHeldOutRuleAndContextEffect`, `nullClaimRateWithinBound`, and `primaryConclusionRequiresCalibrationGuardrail`. Fix alpha at `0.05`, target power at `0.80`, and maximum confirmatory size at `256` seed blocks; a plan that exceeds the cap returns `inconclusive` instead of silently truncating. Pilot and confirmatory rule-family IDs and master seeds must be disjoint; the null-control observed claim rate may not exceed `0.05`.
- [ ] **Step 2: Run `node --test tests/core/statistics.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement deterministic resampling and confirmatory lock validation.** Use 10,000 paired bootstrap resamples for the percentile 95% interval; use exact paired sign flips for at most 20 seed blocks and 10,000 seeded Monte Carlo flips above that, with the plus-one p-value correction. Estimate sample size by 10,000 seeded draws with replacement from pilot paired differences, selecting the smallest `n ≤ 256` with at least `0.80` simulated power at two-sided `α=0.05`; otherwise return `inconclusive`. Keep exploratory pilot rule families and seeds separate from confirmatory rule families and seeds; freeze seed count, stopping rule, primary comparison, budgets, withheld-assay hash, held-out developmental rules, transfer contexts, null calibration bound, and thresholds before execution.
- [ ] **Step 4: Run `node --test tests/core/statistics.test.js`** and confirm paired analysis, multiplicity, power-cap, and fail-closed conclusion tests pass.
- [ ] **Step 5: Commit** as `feat: add preregistered paired analysis`.

## Task 11: Receipts, Schemas, and Transactional Import

**Files:**
- Create: `src/core/receipt.js`
- Create: `schemas/receipt-v1.json`
- Create: `tests/core/receipt.test.js`

**Interfaces:**
- Produces: `createPublicReceipt(batchResult) -> PublicReceipt`, `createAuditorRecord(batchResult) -> AuditorRecord`, async `sealReceipt(receipt) -> SealedReceipt`, `validateReceipt(text) -> {ok, value?, errors}`, and `importReceiptIntoSession(text, session) -> {session, receipt}`.
- Public receipt includes raw event-level outcomes, protocol/prediction, source version/hash, run config, seed keys, snapshots, outcomes, failures, and claim status. Auditor truth is in a separate evaluation record.

- [ ] **Step 1: Write failing tests** named `receiptRetainsRawRowsAndProvenance`, `auditorRecordIsSeparateFromPublicReceipt`, `sealAndValidateRoundTrip`, `rejectsDigestSchemaAndSizeMismatch`, `importFailureLeavesSessionReferenceUnchanged`, and `claimStatusUsesLockedCriteria`. Assert canonical JSON digests use SHA-256 and imports over `2 MiB` fail.
- [ ] **Step 2: Run `node --test tests/core/receipt.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement versioned receipt construction and all-or-nothing import.** Validate schema version, digest, byte cap, required rows, and status before returning a new session value; never mutate the supplied session during validation.
- [ ] **Step 4: Run `node --test tests/core/receipt.test.js`** and confirm integrity, separation, raw-data, and transactional assertions pass.
- [ ] **Step 5: Commit** as `feat: add verifiable experiment receipts`.

## Task 12: Cancellable Worker Experiment Engine

**Files:**
- Create: `src/worker/experiment-engine.js`
- Create: `src/worker/worker-entry.js`
- Create: `tests/worker/experiment-engine.test.js`

**Interfaces:**
- Produces: `runExperimentJob({jobId, config, onProgress, isCancelled}) -> Promise<JobResult>`; worker messages are `{type:"start", jobId, config}` and `{type:"cancel", jobId}`. Results are `completed`, `cancelled`, `invalid`, or `failed`.
- The engine yields between seed blocks so cancellation messages can be processed. A cancelled job cannot create a confirmatory-success receipt.

- [ ] **Step 1: Write failing tests** named `reportsMonotoneSeedProgress`, `cancelsBetweenSeedBlocks`, `cancelledJobHasNoSuccessReceipt`, `invalidConfigDoesNotStartWork`, and `failurePreservesDiagnostic`. Assert cancellation after the first progress event leaves no completion receipt.
- [ ] **Step 2: Run `node --test tests/worker/experiment-engine.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement chunked execution** with one seed block per yield and the Task 9 orchestration; add the thin browser message adapter in `worker-entry.js`.
- [ ] **Step 4: Run `node --test tests/worker/experiment-engine.test.js`** and confirm progress, cancellation, and result-state tests pass.
- [ ] **Step 5: Commit** as `feat: execute experiments in cancellable worker`.

## Task 13: Browser Interface and Session Workflow

**Files:**
- Create: `src/ui/index.html`
- Create: `src/ui/styles.css`
- Create: `src/ui/app.js`
- Create: `src/ui/view.js`
- Create: `src/ui/session.js`
- Create: `tests/integration/ui-session.test.js`

**Interfaces:**
- Produces: `createSessionState()`, `reduceSession(state, action) -> state`, and view functions for selectable subject regions/channels, protocol inspector, hypothesis board, paired outcomes, and receipt ledger. Reducer action types are `JOB_STARTED`, `JOB_PROGRESS`, `JOB_COMPLETED`, `JOB_CANCELLED`, `IMPORT_RECEIPT`, `REPLAY_RECEIPT`, `SET_LEDGER_QUERY`, and `CLEAR_RECEIPTS`.
- UI controls start/cancel experiments, inspect operations and predictions, search the ledger, replay the exact protocol from its saved snapshot and seed, and export/import JSON and CSV. Exploratory, confirmatory, null, and invalid statuses have distinct visible text.

- [ ] **Step 1: Write failing session tests** named `cancelDoesNotPublishPartialReceipt`, `failedImportLeavesCurrentSessionIntact`, `confirmatoryStatusRequiresAnalysisReceipt`, `ledgerKeepsRawRowsForExport`, `replayUsesReceiptSnapshotProtocolAndSeed`, `searchFiltersLedgerRows`, and `allVisibleControlsHaveAccessibleNames`. Check accessible names by parsing the static HTML and requiring an associated `<label>`, visible button text, or `aria-label` for every input, button, and select.
- [ ] **Step 2: Run `node --test tests/integration/ui-session.test.js`** and confirm it fails because the module does not exist.
- [ ] **Step 3: Implement the session reducer and accessible browser views.** Construct a module Web Worker from `worker-entry.js`; render grid cells with role/channel labels; keep auditor-only data out of UI state.
- [ ] **Step 4: Run `node --test tests/integration/ui-session.test.js`** and confirm session import/export and status assertions pass.
- [ ] **Step 5: Commit** as `feat: add local experiment interface`.

## Task 14: Loopback Server and Headless Runner

**Files:**
- Create: `tools/serve.js`
- Create: `tools/run-benchmark.js`
- Create: `tests/integration/tools.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run serve -- --port 4173` and `npm run benchmark -- --config configs/benchmark-smoke.json --out output/smoke`.
- Server binds only to `127.0.0.1`, resolves requests beneath `src/ui`, allows only GET/HEAD, sets module/JSON MIME types, and rejects path traversal. Runner writes a public JSON receipt, separate auditor JSON, and raw CSV.

- [ ] **Step 1: Write failing tool tests** named `serverBindsLoopbackOnly`, `rejectsTraversalAndUnsupportedMethods`, `servesHtmlModulesAndWorkerWithMimeTypes`, `runnerWritesSeparateAuditorFile`, and `runnerOutputReplaysFromSameConfigAndSeeds`. The replay test compares canonical outcomes and raw rows, excluding receipt timestamps.
- [ ] **Step 2: Run `node --test tests/integration/tools.test.js`** and confirm it fails because the tools do not exist.
- [ ] **Step 3: Implement the allowlisted static server and deterministic CLI.** Parse flags without evaluating code; refuse non-loopback bind values and output paths that escape the chosen run directory.
- [ ] **Step 4: Run `node --test tests/integration/tools.test.js`** and confirm server containment and runner replay tests pass.
- [ ] **Step 5: Add npm scripts** `serve`, `benchmark`, and `test` (`node --test`).
- [ ] **Step 6: Run `npm test`** and confirm all current test files pass.
- [ ] **Step 7: Commit** as `feat: add local server and batch runner`.

## Task 15: Versioned Examples and Research Documentation

**Files:**
- Create: `README.md`
- Create: `docs/research-note.md`
- Create: `docs/experiment-protocol.md`
- Create: `docs/safety-and-limits.md`
- Create: `docs/roadmap.md`
- Create: `tests/integration/docs.test.js`
- Modify: `configs/confirmatory-template.json`
- Modify: `configs/benchmark-smoke.json`
- Modify: `configs/ablations.json`

**Interfaces:**
- Produces: one smoke configuration that runs locally, a confirmatory template that requires a separate pilot-derived lock, eight named ablations (`freeze_grammar`, `freeze_hypothesis_updates`, `random_selection`, `remove_event_key_matching`, `disable_transplant_delay`, `disable_transfer_context`, `no_grammar_mutation_equal_compute`, `disable_null_audit`), and a standalone research note with references and falsification criteria.

- [ ] **Step 1: Write documentation contract checks** named `smokeCommandMatchesPackageScripts`, `confirmatoryTemplateCannotRunWithoutLock`, `allEightAblationsAreNamed`, `scientificBoundariesAppearInReadmeAndResearchNote`, and `researchNoteStatesNullAndNoveltyLimits`.
- [ ] **Step 2: Run `node --test tests/integration/docs.test.js`** and confirm it fails because the docs/config files do not exist.
- [ ] **Step 3: Write the docs and versioned configs.** Include setup, exact local commands, architecture, related work, the primary/falsification criteria, raw-receipt format, synthetic-model limits, and the four-stage V0–V3 roadmap. Do not present synthetic results as biological evidence.
- [ ] **Step 4: Run `node --test tests/integration/docs.test.js`** and confirm command and claim-boundary checks pass.
- [ ] **Step 5: Run the documented smoke command** and confirm it emits replayable public/auditor receipts plus raw CSV.
- [ ] **Step 6: Commit** as `docs: document Mnemorph research workflow`.

## Task 16: End-to-End Acceptance and Local Launch

**Files:**
- Create: `tests/integration/end-to-end.test.js`
- Modify: any implementation files required by the acceptance failures.

**Interfaces:**
- Produces: a verified run from a fixed config and seed list, a browser session that can start/cancel/replay/export, and a clean reproducibility receipt set.

- [ ] **Step 1: Write end-to-end acceptance tests** named `smokeRunReplaysExactly`, `adaptiveAndFrozenMethodsUseEqualBudgets`, `withheldPredictionsHaveAuditorOnlyScoring`, `receiptImportRoundTripsWithoutMutationOnFailure`, and `cancelledBrowserRunCannotBePromoted`.
- [ ] **Step 2: Run `node --test tests/integration/end-to-end.test.js`** and confirm the first missing acceptance behavior fails.
- [ ] **Step 3: Fix only the implementation gaps exposed by these acceptance tests.** Keep all project-wide bounds and hidden-label separation intact.
- [ ] **Step 4: Run `npm test`** and confirm the complete native test suite passes.
- [ ] **Step 5: Run the smoke benchmark twice** with the same config and seeds; compare canonical public receipts and raw outcome rows byte-for-byte, excluding timestamp fields.
- [ ] **Step 6: Launch `npm run serve -- --port 4173` and verify** the app loads from loopback, starts a smoke job, displays progress, cancels a second job, and exports a receipt.
- [ ] **Step 7: Run `git diff --check`** and confirm no whitespace errors; review `git status` to ensure only intended project files are present.
- [ ] **Step 8: Commit** as `test: verify complete Mnemorph workflow`.

## Execution Notes

- Execute tasks in order because each later module consumes the exact interfaces declared above.
- Keep `mermaid-diagram.png` as an existing user artifact; do not overwrite, rename, or include it in generated receipts.
- V3 plastic-development and cross-lineage transfer are documented future research, not MVP success claims.
- Browser verification is a local functional check; synthetic benchmark outcomes do not validate biological mechanisms.
