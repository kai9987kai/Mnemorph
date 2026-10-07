# Mnemorph: A Synthetic Testbed for Adaptive Memory-Archaeology Assays

**Systems-design and software-verification paper**

**Version 0.1 · 7 October 2026**

## Abstract

Persistent behavior after tissue loss and regrowth can be consistent with several causal accounts: a spared local trace, a distributed trace, reconstruction during regrowth, or a change in the behavioral readout. Mnemorph is a deterministic software testbed for asking whether a bounded experiment compiler can distinguish such accounts by selecting sequential interventions and predicting outcomes on withheld assays. The implementation couples a hand-coded grid subject to a typed intervention language, matched method branches, event-keyed randomization, a revisable assay grammar, auditor-scored predictions, replayable receipts, and a local browser workbench. Its primary proposed comparison is an adaptive selector with a revisable grammar against an information-gain selector with a frozen grammar under equal assay and candidate-evaluation budgets.

This paper reports the design and software verification of Mnemorph, not evidence that one selector performs better or that the model describes biological memory. The bundled smoke profile uses four master seeds, five synthetic mechanism families, eight measurement trials, and six method identifiers. The 114-test suite passes; repeated smoke runs produce matching stable public data, auditor records, and raw CSV; and browser export/import and cancellation behavior were exercised. An implementation review also established a material information boundary: the compiler is not passed the auditor label or replay snapshot, but public replay snapshots expose wiring that can let a source-informed reader infer some assignments. Mnemorph therefore provides a direct data-flow separation, not confidentiality against inference. All findings are conditional on this synthetic model.

**Keywords:** adaptive experiment design, synthetic systems, causal interventions, replayable experiments, model misspecification, software verification

## 1. Introduction

Behavior that returns after a system changes structure does not by itself identify where or how the behavior was supported. The same output may follow from persistence in spared components, distributed storage, reconstruction during regrowth, or a changed input-to-output mapping. This ambiguity motivates experiments that distinguish causal accounts rather than relying on a single behavioral endpoint.

Biological studies motivate the question but do not validate Mnemorph. Shomrat and Levin reported an automated planarian training paradigm and evidence of memory retrieval after head regeneration using a savings assay [1]. Liu and colleagues showed that optogenetic reactivation of a tagged hippocampal cell population could induce freezing behavior in mice [2]. These studies concern different organisms, tasks, and methods; they are examples of the scientific motivation, not results reproduced by this software.

Mnemorph makes the experiment-selection problem executable in a small, inspectable simulator. It asks:

> Under matched starting states and bounded intervention budgets, does revising a typed assay grammar improve prediction of withheld outcomes over active selection with a frozen grammar?

The contribution is a reproducible benchmark scaffold for this question. It makes the subject rules, intervention vocabulary, candidate limits, pairing, prediction timing, raw events, and software provenance explicit. The current version establishes that this pipeline runs and can be replayed. It has not established that the adaptive method is superior, that the synthetic mechanisms are biologically plausible, or that any biological memory mechanism has been discovered.

## 2. Related work and positioning

Adaptive experiment selection is established. Pauwels, Lajaunie, and Vert describe Bayesian active learning for sequential experimental design in systems biology, including simulation-based evaluation against alternative strategies [3]. Mnemorph therefore treats information-guided selection as a comparator, not as a novelty claim.

Work on artificial experimentalists has explored different systems and objectives. CARL uses goal-conditioned reinforcement learning to intervene in Lenia with local perturbations and reports discovery and control of self-organizing patterns [4]. Petri Dish Neural Cellular Automata studies multiple cellular automata that continue learning during a shared simulation [5]. EngramNCA explores private cell-internal channels and memory-like transfer in a neural cellular automaton [6]. Each differs from Mnemorph in substrate and task. Mnemorph uses a hand-coded behavioral-learning simulator and focuses on matched causal assays, revisable intervention grammar, and held-out outcome prediction.

The present paper does not claim that this combination is unprecedented. The related-work scan is focused rather than systematic. Mnemorph should be read as a testable systems design whose comparative value remains an open empirical question within its own simulator.

## 3. Research question and falsifiable criteria

The primary hypothesis is that an adaptive compiler with a revisable intervention grammar can achieve a lower multiclass Brier score on withheld assays than a matched information-gain selector whose grammar is frozen. Lower Brier score indicates better probabilistic prediction for the three behavioral categories used by the simulator.

The intended confirmatory comparison has three gates:

1. The paired 95% interval for the adaptive-minus-frozen Brier difference is below zero under the preregistered analysis.
2. The effect persists on held-out developmental rule families and transfer contexts.
3. Null-effect subjects remain within a preregistered claimed-discovery rate and calibration bound.

Failure at any gate leaves the hypothesis unsupported. A null or inconclusive result is an acceptable outcome. A successful smoke run, attractive trajectory, or in-sample fit cannot satisfy these gates.

The repository contains an unlocked confirmatory template, not an executable preregistration. It lacks the locked sample size, held-out hashes, and stopping details needed for a confirmatory result, and the current runner rejects it as a run configuration. No confirmatory run is reported here.

## 4. System design

### 4.1 Synthetic subject

Each subject is a finite two-dimensional grid with head, body, wound-border, and tail regions. It performs a binary cue-to-action learning task using local cell state, plastic channels, and a behavioral readout. Development is frozen within a subject lifetime; after a typed regrowth operation, damaged sites are reconstructed from the configured local rule and surviving neighborhood state. Subjects and training are deterministic for a given seed and event sequence.

The bundled benchmark contains five programmer-defined mechanism families:

| Family | Constructed account |
|---|---|
| Local trace | Task-relevant state is concentrated in a spared local region. |
| Distributed trace | Task-relevant state is spread across multiple regions. |
| Regenerative reconstruction | Regrowth can reconstruct task-relevant state from surviving tissue. |
| Readout adaptation | The behavioral mapping changes while the learned state is represented elsewhere. |
| Context-gated mixture | Behavior depends on a weighted mixture of state and context. |

These are explicit simulator mechanisms, not inferred categories of biological memory. A training preflight checks that an undamaged subject learned the task before its post-intervention behavior is treated as memory-like retention.

### 4.2 Typed interventions

An assay is a validated sequence drawn from a fixed vocabulary: lesion, silence, scramble, transplant, delay, regrow, context shift, and sham. Each program is bounded to four operations. Operations declare their targets, timing, and parameters; invalid or inapplicable operations are recorded rather than silently ignored. The compiler can compose and revise these typed programs but cannot generate or execute arbitrary source code.

### 4.3 Matched protocol

For each seed-family case, Mnemorph trains a subject, checks the preflight, and saves an initial snapshot. Methods branch from the same state and receive equal assay and candidate-evaluation limits. Deterministic event keys omit the method-arm identity for shared exogenous events, allowing paired arms and methods to reuse the same named draws even when their states later diverge.

The assay records behavior before intervention, after regrowth, and under transfer context. The compiler records predictions before observing the associated outcome. A separate withheld assay set is scored after prediction; its outcomes do not update compiler history. The replication and pairing structure is fixed in the run configuration and receipt.

### 4.4 Selectors and baselines

The benchmark names six methods: fixed one-factor, fixed factorial, random equal-budget, frozen-grammar information gain, adaptive revisable grammar, and an auditor-only oracle diagnostic. The main comparison is adaptive revisable grammar versus frozen-grammar information gain. The fixed and random methods provide reference baselines; the oracle is diagnostic and is not a deployable selector.

The compiler maintains a candidate hypothesis bank and a bounded grammar of typed operations and protocol templates. Candidate selection is deterministic and based on expected information gain with costs and penalties for invalid or destructive candidates. The adaptive method may revise its grammar only at batch boundaries, using earlier public observations. The smoke configuration caps candidate evaluations at eight per batch and protocol length at four operations. The implementation uses no language model or external inference service.

### 4.5 Information boundary and replay

The runtime selection call receives the hypothesis bank, prior method history, run configuration, budget, seed, and block index. It is not passed the subject snapshot or the authoritative auditor label. The auditor record stores explicit mechanism labels and withheld scores separately from public result rows.

Replayable public receipts also contain serialized subject snapshots. Those snapshots include wiring details that may reveal recognizable family signatures to a reader who knows the model source. Consequently, the boundary is a property of compiler data flow: the selector does not receive the truth label or snapshot as input. It is not a guarantee that an external reader cannot infer assignments from visible state. Public labels and scores remain separate fields, while the model's observable state can still be informative.

## 5. Outcomes and analysis plan

The primary score is multiclass Brier score on withheld assay predictions. The planned primary contrast is the paired difference between adaptive revisable grammar and frozen-grammar information gain. Confirmatory analysis is intended to use a preregistered sample size, held-out rule families and contexts, a fixed stopping rule, a null-control bound, and a calibration guardrail. The repository includes deterministic paired bootstrap intervals, paired randomization tests, and Holm adjustment utilities; their presence does not constitute a completed confirmatory analysis.

Eight named ablations are documented: freeze grammar, freeze hypothesis updates, random selection, remove event-key matching, disable transplant/delay, disable transfer context, equal-compute without grammar mutation, and disable null audit. They are design switches only; the current benchmark runner does not execute these ablations. A future comparative report should include candidate evaluations and wall-clock or compute cost. Current receipt rows record candidate-evaluation budgets but do not provide a full compute-time comparison.

## 6. Implementation and reproducibility

Mnemorph is implemented as dependency-free JavaScript modules for Node.js and a browser. A cancellable Web Worker runs browser experiments, a loopback-only server serves allowlisted files, and a headless runner produces versioned outputs. Run receipts carry configuration, source provenance, snapshots, predictions, protocols, outcomes, raw event rows, failures, and a SHA-256 digest. Auditor evaluation is written separately. Receipt import checks schema, digest, and size before changing session state.

The bundled smoke configuration fixes four unique master seeds, five mechanism families, six method identifiers, eight measurement trials, 256 training episodes, a 12×8 grid, and two withheld programs. Its five non-oracle methods produce 100 public method rows across 20 seed-family cases. The smoke profile is sized to exercise the pipeline while keeping the compact receipt below the 2 MiB import cap; its sample is not powered for the research hypothesis.

## 7. Software verification findings

At the time of writing, 114 automated tests pass. The verification suite covers deterministic randomness and replay, matched snapshots and budgets, intervention bounds, prediction timing, auditor separation, receipt integrity, cancellation, and browser/UI integration.

Two smoke runs using the same configuration and seeds produced identical stable public receipt payloads after excluding timestamp and digest fields. Their auditor JSON and raw CSV files were byte-identical, and both receipts validated. The public receipt measured 1,706,197 bytes and the CSV 511,630 bytes in the tested environment. A live browser smoke run exported a 1,706,300-byte receipt; the receipt passed validation and imported into the UI. A 256-block run was cancelled after progress began and produced no partial receipt. These are software and artifact checks, not method-performance results.

Acceptance testing also exposed two useful engineering constraints. First, pretty-printed JSON could expand a valid internal receipt beyond the import-size bound; browser export now uses the size-checked serializer. Second, checking only for a literal family-label field is insufficient to claim the assignment is hidden: replay state exposes wiring patterns. The documentation and UI now state the narrower data-flow boundary explicitly.

## 8. Limitations and threats to interpretation

Mnemorph is a hand-coded deterministic simulator, not a neural cellular automaton, biophysical model, animal model, or validated theory of memory. Its mechanisms and transitions were authored to create controlled distinctions. A method that predicts them well would establish performance only on this configured generator and assay vocabulary.

The smoke profile contains four master seeds and is explicitly exploratory. It cannot support the planned confirmatory comparison. No ablation results or compute-time comparison are reported. The confirmatory template is unlocked and not accepted by the runner. The focused literature scan does not establish priority or exhaustive novelty.

The public snapshot caveat is material: code-aware readers may infer some synthetic mechanism assignments from wiring. The auditor file remains the authoritative label/scoring record, and those fields do not enter the selector. This system does not provide an adversarial secrecy guarantee for mechanism identity.

No biological, clinical, consciousness, ecological, or real-world decision claim follows from this simulator or the software tests. Any empirical translation would require a separate model, domain expertise, ethical review, and evidence collected in an appropriate real system.

## 9. Conclusion

Mnemorph packages a bounded, replayable experiment-selection problem around synthetic behavior after intervention and regrowth. Its main scientific claim remains a falsifiable hypothesis: grammar revision may improve held-out predictions over an equally budgeted frozen active selector. The completed work establishes a reproducible software path for testing that hypothesis, documents an important public-state inference limit, and fixes an export-size defect found through end-to-end use. It provides no evidence yet that the adaptive method wins, and no evidence about biological memory.

## References

1. Shomrat, T. & Levin, M. “An automated training paradigm reveals long-term memory in planarians and its persistence through head regeneration.” *Journal of Experimental Biology* 216, 3799–3810 (2013). [PubMed record](https://pubmed.ncbi.nlm.nih.gov/23821717/); [DOI](https://doi.org/10.1242/jeb.087809).
2. Liu, X. et al. “Optogenetic stimulation of a hippocampal engram activates fear memory recall.” *Nature* 484, 381–385 (2012). [Article](https://www.nature.com/articles/nature11028); [DOI](https://doi.org/10.1038/nature11028).
3. Pauwels, E., Lajaunie, C. & Vert, J.-P. “A Bayesian active learning strategy for sequential experimental design in systems biology.” *BMC Systems Biology* 8, 102 (2014). [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC4181721/); [DOI](https://doi.org/10.1186/s12918-014-0102-6).
4. Cvjetko, M. et al. “The Artificial Experimentalist: Discovery and Control of Self-Organizing Phenomena with Autotelic Reinforcement Learning.” *ALIFE 2026: Proceedings of the 2026 Artificial Life Conference* (2026). [Project and paper](https://developmentalsystems.org/carl/); [DOI](https://doi.org/10.1162/ISAL.a.971).
5. Zhang, I., Risi, S. & Darlow, L. “Petri Dish Neural Cellular Automata.” Sakana AI (2025). [Paper and project](https://pub.sakana.ai/pdnca/).
6. Guichard, E. et al. “EngramNCA: a Neural Cellular Automaton Model of Memory Transfer.” (2025). [arXiv:2504.11855](https://arxiv.org/abs/2504.11855).
