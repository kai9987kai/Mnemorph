# Mnemorph: Adaptive Memory Archaeology Laboratory

**Status:** Design specification, 6 October 2026
**Scope:** Local, synthetic research platform for testing adaptive causal assays on memory-bearing systems that learn, lose parts of their substrate, and regenerate.

## 1. Research thesis

Mnemorph asks:

> When a synthetic organism retains learned behavior after tissue loss and regrowth, can an experiment system discover whether the behavior came from a persistent memory trace, reconstruction during regeneration, or adaptation of the behavioral readout—and can it identify informative intervention sequences with fewer experiments than fixed protocols?

The project studies a coupled subject and assay compiler. The subject learns and changes during a simulated lifetime. The compiler observes behavior and permitted visible measurements, proposes interventions, updates competing explanations from the results, and revises its bounded assay grammar.

This is a synthetic software model. It does not model a particular species, establish biological memory mechanisms, measure consciousness, or support clinical or ecological conclusions.

## 2. Portfolio synthesis and lineage

The design draws on the following strands of the supplied portfolio. Links identify inspiration and provenance; they do not assert that Mnemorph validates the source projects' models or claims.

| Strand | Repositories and contribution to the design |
|---|---|
| Memory, damage, and regeneration | [Prometheus-α](https://github.com/kai9987kai/prometheus-alpha) studies task memory through head loss, regrowth, turnover, and transfer; [Morpheus](https://github.com/kai9987kai/morpheus) combines developmental tissue, self-models, interventions, and audited self-improvement; [GhostInTheMachine](https://github.com/kai9987kai/GhostInTheMachine) motivates explicit authorship controls and claim-status discipline; [MOLT](https://github.com/kai9987kai/MOLT) and [Memory Carrier Observatory](https://github.com/kai9987kai/MEMORY-CARRIER-OBSERVATORY) contribute matched intervention, transfer-context, and factorial-assay patterns. |
| Development and embodied computation | [GenesisEngine](https://github.com/kai9987kai/GenesisEngine) contributes deterministic development, snapshots, and paired experiments; [3D Animal Simulator](https://github.com/kai9987kai/3d-animal-simulator-Hybrid-Agent) contributes observable embodied ecology and disturbance interventions; [FLY-DIAMOND-NEXUS](https://github.com/kai9987kai/FLY-DIAMOND-NEXUS) contributes inspectable specialist subsystems and seeded agent comparisons; [QuantumBot](https://github.com/kai9987kai/QuantumBot) reinforces parameter-matched classical baselines and honest null outcomes. |
| Search, evidence, and experiment plumbing | [NexusSearch](https://github.com/kai9987kai/NexusSearch) contributes explainable local retrieval; [Causeway](https://github.com/kai9987kai/Causeway) contributes evidence-linked assumptions and portable run receipts; [NexusFlow](https://github.com/kai9987kai/nexusflow) contributes an explicit experiment workflow representation. |
| Model composition | [Supermix](https://github.com/kai9987kai/Supermix), [Supermix Archimedes](https://github.com/kai9987kai/supermix-archimedes), [Supermix Expanse](https://github.com/kai9987kai/Supermix-expanse), and [Supermix Expanse v2](https://github.com/kai9987kai/Supermix-Expanse-v2) contribute modularity and heterogeneous subsystem composition. The two Expanse repositories appear to describe overlapping model lineages in their public README and top-level structure; Mnemorph treats them as variants, not as independent evidence. |
| Software inspection and tool workflows | [REA](https://github.com/morluto/rea) contributes structured inspection of unfamiliar systems; [universal-modder](https://github.com/rehan-remade/universal-modder) contributes bounded tool use and retained field notes; [Odysseus](https://github.com/odysseus-dev/odysseus) contributes local-first operational patterns. |
| Embedded and representational constraints | [Flipper Zero Periodic NTAG Emulator](https://github.com/djpiper28/Flipper-Zero-Periodic-NTAG-Emulator) contributes a time-varying identity example; [Quibble builds](https://github.com/7coil/quibble-builds) contribute an extensible boot-path example; [SVideo](https://github.com/7coil/svideo) contributes temporal redundancy and compact representation ideas. |

The shared research direction is information and behavior surviving changes to a system's structure. Mnemorph concentrates this into an experimentally testable question about memory retention versus reconstruction, with reproducible interventions and receipts.

## 3. Novelty challenge and claim boundary

The design does not claim that cellular automata, active experimentation, artificial memory, regeneration, or state transfer are individually new.

Closest work checked for this design:

- [CARL](https://arxiv.org/abs/2608.26116) learns goal-conditioned local interventions to discover and steer patterns in Lenia.
- [Petri Dish Neural Cellular Automata (PD-NCA)](https://pub.sakana.ai/pdnca/) studies populations of continually learning NCA.
- [EngramNCA](https://arxiv.org/abs/2504.11855) studies private cellular memory channels and transfer of morphology.
- [Neural Cellular Automata Learn General Features in their Hidden Channels](https://arxiv.org/abs/2609.21870), submitted 18 September 2026, studies transfer of teacher hidden states to student NCA.
- [Harness the Memory](https://arxiv.org/abs/2608.15008) studies memory-substrate trade-offs for language-model agents.

The candidate contribution is narrower: a bounded, revisable compiler for sequential causal assays of memory behavior in a learning, regenerating subject. It is scored on predictions about withheld intervention programs and hidden mechanism families. Preliminary novelty confidence is “partially novel combination / potentially novel mechanism.” A broader literature review may lower that estimate. No “never made before” statement is part of the product or paper.

## 4. System architecture

Data flow:

Task and master seed → subject development and training → immutable snapshot → matched clone forks → intervention program execution → regeneration and transfer-context tests → observed outcomes → hypothesis update → next assay selection → receipt ledger.

Major subsystems:

1. **Subject factory:** generates a synthetic tissue grid and records its developmental rule and initial state.
2. **Local learner:** exposes cue and reward events, performs bounded local learning, and reports behavior.
3. **Snapshot and fork manager:** saves complete subject and random-generator state, validates snapshots, and creates intervention arms from the same pre-intervention state.
4. **Intervention runner:** interprets a typed assay program and applies operations to isolated clones.
5. **Regeneration and transfer evaluator:** advances the subject's developmental rule after damage and measures behavior in familiar and changed contexts.
6. **Hypothesis bank:** tracks predictive models for candidate memory mechanisms and stores pre-experiment outcome predictions.
7. **Assay compiler:** scores candidate programs, mutates a bounded grammar between batches, and records why it selected each protocol.
8. **Independent auditor:** sees hidden simulator state for evaluation only; the assay compiler cannot access its labels or signals.
9. **Ledger and interface:** displays the protocol, paired arms, outcomes, predictions, runtime, and receipts.

## 5. Subject state and learning

A complete subject snapshot is:

S = (G, X, W, D, E, R)

- **G:** developmental and local update rule; fixed for an individual lifetime.
- **X:** per-cell visible role and hidden state channels, including a voltage-like state.
- **W:** local coupling and plastic state.
- **D:** behavioral readout parameters.
- **E:** current task, cue mapping, reward schedule, and environmental state.
- **R:** explicit deterministic random-generator state and event counters.

The starter organism is a two-dimensional finite grid with explicit head, body, and wound-border regions. Its shared local rule advances cells. Cue information reaches the sensory region; an action is selected by the readout; a reward-modulated local update changes only declared plastic state. Development is frozen within a lifetime. Regrowth fills damaged sites from the declared developmental rule and surviving neighborhood state.

The hidden-mechanism benchmark varies where task-relevant state is written and how behavior is recovered:

1. local trace retained in a spared region;
2. redundant trace distributed across regions;
3. learned state reconstructed by the developmental rule after damage;
4. readout adaptation with behavior changed by cue remapping;
5. context-gated mixtures of these mechanisms.

These are masked benchmark families with known ground truth for scoring. An open-substrate mode uses the same local learning machinery without exposing the family label to the compiler; the auditor may inspect state afterward.

The first task is a small cue-to-action discrimination in a deterministic grid environment. Task difficulty and cue mappings are configurable and recorded. A training preflight must demonstrate that an undamaged subject learns above the preregistered chance threshold before its memory is evaluated.

## 6. Intervention language and compiler

The typed intervention vocabulary is fixed in the MVP:

- **Lesion:** remove a selected fraction of a named tissue region.
- **Silence:** block a declared channel or local coupling during a bounded interval.
- **Scramble:** permute values within a region while preserving the value distribution.
- **Transplant:** exchange a selected state patch between matched donor and receiver clones.
- **Delay:** wait a declared number of development steps before applying a later operation.
- **Regrow:** resume local development after damage.
- **Context shift:** reverse or remap the cue-to-action relation at evaluation.
- **Sham:** execute the same timing and handling without altering the selected state.

Each assay program has at most four interventions. It is a typed sequence with declared target region, channel, intensity, timing, and cost. Invalid or inapplicable operations are recorded and do not silently become no-ops.

The compiler's candidate generation uses beam search over typed programs plus grammar mutations that add, remove, reorder, or combine existing operations. It cannot write or execute source code. For candidate assay q, selection is based on predicted information gain over the hypothesis bank, divided by subject and compute cost, with penalties for invalid protocols and destructive loss of all evaluable arms:

score(q) = expected reduction in hypothesis entropy / assay cost - invalidity penalty - evaluation-loss penalty

The exact weights and tie-breaking rule are fixed in the experiment configuration before confirmatory runs. The compiler may update its predictive model and add a successful protocol template only between batches. Every mutation is versioned; the starting compiler remains available for paired evaluation.

The independent auditor evaluates whether the compiler's selected programs distinguish the actual masked mechanism and predict withheld outcomes. Auditor outcomes are never fed into the compiler.

## 7. Experiment protocol and fair comparison

For each master seed:

1. Create a subject, train it on a locked schedule, and save the full state.
2. Verify the undamaged behavior criterion.
3. Fork all methods from that same saved state.
4. Apply matched protocols using named event keys for all shared random draws.
5. Measure behavior before damage, after regrowth, and after transfer-context changes.
6. Record compiler predictions before outcomes are revealed.
7. Evaluate predictions against a pre-generated, withheld assay set and auditor-only mechanism labels.

The unit of replication is an independent master-seed block. Methods receive the same assay budget, maximum candidate-program evaluations per batch, subject snapshots, and observable history. Runs that share a seed or subject lineage are not counted as independent replicates. Report wall-clock time and simulation ticks as well as candidate evaluations so compute differences remain visible.

Baselines:

- fixed one-factor probe panel;
- fixed factorial panel where the intervention space is small enough;
- random protocols under the same budget;
- expected-information-gain selection with a frozen intervention grammar;
- Mnemorph's adaptive, revisable grammar;
- auditor-only oracle as an upper-bound diagnostic.

The main comparison is the revisable grammar against the frozen-grammar active selector. This isolates the claimed contribution from the established idea of information-guided experiment selection.

## 8. Metrics, statistics, and falsification

**Primary outcome:** Brier score of predicted outcomes on withheld intervention programs. Lower is better.

Secondary outcomes:

- posterior calibration and ranking of the hidden mechanism family;
- held-out prediction score versus cumulative assay cost;
- retained cue-to-action performance before damage, after regrowth, and under context shift;
- number of probes required to cross a preregistered prediction-quality threshold;
- invalid-program rate, wall-clock time, memory use, and subject loss;
- transfer of successful assay templates to held-out developmental rule families.

Exploratory pilots and confirmatory tests use separate subject families and master seeds. A power simulation on pilot data fixes the confirmatory seed count and stopping rule before confirmatory runs begin. The primary estimate is the paired per-seed difference in withheld Brier score between revisable-grammar and frozen-grammar selection. Report per-seed outcomes, paired bootstrap intervals, paired randomization tests, and multiplicity-adjusted secondary analyses.

Evidence for the central hypothesis requires all of the following:

1. The revisable-grammar compiler has lower held-out Brier score than the frozen-grammar active selector under equal probe budgets, with the preregistered paired interval excluding zero in the predicted direction.
2. The effect persists on held-out developmental rules and transfer contexts.
3. Null-effect subjects do not trigger a rate of claimed discoveries beyond the preregistered calibration bound.

The hypothesis is unsupported if the compiler fails any of these requirements, if its apparent advantage depends on access to hidden labels, or if the gain vanishes after accounting for extra compute or probes. No single attractive trajectory or post-hoc protocol counts as confirmatory evidence.

## 9. Ablations

Run each ablation against the full compiler using matched master seeds:

- freeze the assay grammar;
- freeze hypothesis updates;
- replace information-gain ranking with random selection;
- remove event-keyed matched randomness;
- disable transplant and delayed operations;
- disable transfer-context tests;
- disable compiler mutation while retaining the same compute budget;
- disable the independent null audit.

These separate the value of adaptive model updates, grammar revision, specific operators, fair pairing, and calibration.

## 10. Telemetry, receipts, and interface

Each machine-readable receipt contains:

- experiment ID and timestamp;
- software version, source hash, runtime, and platform;
- task, hypothesis, protocol, compiler version, and mutation history;
- master seed, randomization method, subject snapshot hash, and full configuration;
- arms, ordered operations, observations, predictions, metrics, failures, and outcomes;
- auditor-only ground truth in a separate evaluation record;
- conclusion status: exploratory, confirmatory, null, or invalid.

Receipts use canonical JSON plus SHA-256 content digests. Raw event-level rows are retained for each subject and arm; JSON and CSV exports must not replace raw outcomes with summary-only tables. Import validates schema, version, digest, and size bounds before changing workspace state.

The local browser interface provides:

- a subject and tissue-state view with selectable regions and channels;
- an assay-program inspector showing operation order, target, timing, and cost;
- a hypothesis board with pre-run predictions and post-run updates;
- paired outcome charts for intact, regenerated, and transfer-context tests;
- a receipt ledger with search, exact protocol replay, and JSON/CSV export;
- clear labels separating exploratory findings from confirmatory evidence.

## 11. Compute, reliability, and safety

The MVP uses plain JavaScript modules and a Web Worker for simulation, plus a headless Node runner for reproducible batches. A small loopback-only static server supports browser module loading. No cloud service, large model, remote inference, or package download is required at runtime.

Grid size, tick count, subject count, protocol length, and branch count are bounded by a run configuration. The UI yields or cancels work without corrupting a receipt. Snapshots include all state needed for exact continuation. Import is transactional: invalid snapshots leave the current workspace intact.

All subjects are simulated. The assay compiler operates only on the local typed vocabulary; it has no shell, network, arbitrary-code, or external-device access. Every destructive operation affects a cloned branch that can be discarded. The project makes no biological, clinical, sentience, consciousness, or real-world decision claim.

## 12. Research roadmap

| Stage | Objective | New capability | Success test | Failure modes and next question |
|---|---|---|---|---|
| V0: Proof of concept | Establish a deterministic causal assay testbed. | Hidden mechanism suite, fixed operations, matched clones, replayable receipts. | Recover known mechanism differences on held-out seeds and meet the subject learning preflight. | If outcomes cannot distinguish the controlled mechanisms, revise the task before claiming active discovery. |
| V1: Experimental system | Test adaptive model updates. | Hypothesis posterior and information-gain selection over a frozen grammar. | Better held-out prediction per equal assay budget than fixed and random panels. | If the selector overfits a mechanism family, expand family holdouts and audit calibration. |
| V2: Research platform | Test the central contribution. | Revisable compositional assay grammar, ablations, interface, preregistration, exportable raw receipts. | Better held-out prediction than frozen-grammar active selection, with calibrated nulls. | If grammar mutation adds no value, publish that null and retain the simpler selector. |
| V3: Frontier experiment | Increase subject openness and lineage variation. | Plastic developmental rules, varied tissue layouts, cross-lineage assays and transfer. | Replicated protocols predict behavior in unseen lineages and contexts. | If results remain lineage-specific, map the boundary conditions and test a narrower claim. |

## 13. Project structure and deliverables

The implementation will be organized around focused boundaries:

- **src/core/**: deterministic subject, task, intervention, compiler, and scoring engines;
- **src/worker/**: cancellable experiment execution;
- **src/ui/**: browser controls, tissue view, hypothesis board, and ledger;
- **experiments/**: versioned benchmark and ablation configurations;
- **tools/**: local server and headless runner;
- **tests/**: deterministic replay, protocol validation, compiler scoring, receipt validation, and end-to-end benchmark checks;
- **docs/**: user README, research paper, model boundaries, experiment protocol, and roadmap.

The release includes a runnable local interface, headless experiment runner, schemas, example experiments, test suite, README setup guide, and a standalone research/design paper. Performance claims, scientific claims, and novelty claims will be tied to versioned receipts and reported within the limits stated above.
