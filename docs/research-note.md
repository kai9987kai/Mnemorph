# Mnemorph: adaptive memory archaeology

**Research and implementation note — 6 October 2026**  
**Status — synthetic software testbed; no biological or clinical validation**

See the [standalone system paper](paper.md) for the implemented architecture, software-verification evidence, and the replay-snapshot inference limitation.

## Question

When a simulated learner retains a behavior after selected tissue is removed and regrown, can an experiment compiler determine whether the behavior came from a spared local trace, a distributed trace, reconstruction during regeneration, or a changed behavioral readout? Can it choose sequential interventions that predict withheld outcomes better than a matched active selector whose intervention grammar is frozen?

Mnemorph couples two explicit objects: a deterministic synthetic subject and a bounded compiler for typed causal assays. Every method receives the same trained snapshot, seed block, candidate-evaluation limit, and assay budget. The runtime compiler knows candidate hypotheses and receives prior public observations, but it is not passed the auditor label or replay snapshot. It records outcome predictions before receiving observations. The auditor retains the authoritative family label and scores withheld protocols. Public replay snapshots expose subject wiring; a source-informed reader can infer some assignments, so the boundary is data-flow isolation rather than secrecy.

## Motivation and adjacent work

The motivation is an experimentally interesting separation between observed behavior and the place or process that supports it. Shomrat and Levin reported environmental familiarization in planarians and evidence of retrieval after head regeneration using a savings paradigm. That result motivates the question; it is not reproduced, explained, or validated by this software ([Shomrat & Levin, 2013](https://doi.org/10.1242/jeb.087809)). Experimental work on hippocampal engram ensembles also shows that manipulating selected cell populations can alter memory expression ([Liu et al., 2012](https://doi.org/10.1038/nature11028)).

Several computational lines cover important pieces of the design:

- Bayesian sequential experimental design has been applied to systems biology, including choosing interventions to estimate candidate models ([Pauwels, Lajaunie & Vert, 2014](https://doi.org/10.1186/s12918-014-0102-6)). Information-guided experiment selection is therefore a baseline concept here, not Mnemorph's novelty claim.
- CARL uses goal-conditioned reinforcement learning to make local interventions in Lenia and discover or steer self-organizing patterns ([Cvjetko et al., 2026](https://arxiv.org/abs/2608.26116)).
- Petri Dish NCA studies multiple neural cellular automata that continue learning during a shared simulation ([Zhang, Risi & Darlow, 2025](https://pub.sakana.ai/pdnca/)).
- EngramNCA models private cell-internal channels and the transfer of morphology in a neural cellular automaton ([Guichard et al., 2025](https://arxiv.org/abs/2504.11855)).

These works address adaptive intervention, within-lifetime learning, cellular information channels, and memory-related regeneration from different directions. Mnemorph's candidate contribution is a specific comparison: a revisable grammar for sequential, paired assays of retention and reconstruction, evaluated on withheld intervention outcomes and auditor-labeled synthetic mechanisms against a frozen-grammar active selector. The proposed contribution is the benchmark and falsification setup as much as the selector.

## Novelty boundary

As of the date above, this is a focused scan of closely related primary sources, not an exhaustive or systematic literature review. **To our knowledge**, this exact combination of a revisable typed assay grammar, matched regeneration interventions, hidden synthetic memory mechanisms, and held-out predictive scoring is not represented in the sources listed here. That is a provisional assessment, not a claim that the idea has never been made or that every component is new. A broader review could change it. Mnemorph makes no absolute “first” or “never before” claim.

## Benchmark and primary outcome

The five built-in synthetic mechanism families are local trace, distributed trace, regenerative reconstruction, readout adaptation, and context-gated mixtures. The task is a small cue-to-action discrimination. The subject must pass an undamaged-learning preflight before a seed block is eligible for memory evaluation. Typed assay programs are bounded to four operations from the fixed intervention vocabulary.

The primary outcome is multiclass Brier score for predictions on withheld intervention programs; lower is better. The primary paired difference is adaptive revisable grammar minus frozen-grammar information gain, per independent master-seed block. Confirmatory support requires the preregistered 95% paired interval to be below zero, a held-out rule-family and transfer-context effect, null-control claimed-discovery rate at or below 0.05, and the locked calibration guardrail. Seeds and rule families for pilot and confirmation must be disjoint. The stopping rule is fixed before confirmatory runs; the template does not authorize peeking or post-hoc threshold changes.

The hypothesis is unsupported if any required condition fails, if adaptive results depend on an auditor-label input, or if the gain vanishes under equal probe or compute budgets. Public snapshots expose state that can support mechanism inference; this is part of the observation regime, not a cryptographic concealment test. Attractive trajectories, in-sample fit, or a successful smoke run do not establish the hypothesis. A null or inconclusive result is a valid research outcome.

## What this implementation establishes

The current code provides deterministic synthetic subjects, matched snapshots and forks, typed intervention execution, bounded adaptive and frozen selectors, a separate auditor record, replayable receipts, and a local workbench. The smoke profile is intentionally small and does not estimate the primary effect with confirmatory power. Software tests and synthetic runs establish only that the specified simulator and data pipeline execute reproducibly; they do not show that any biological mechanism is correct or that the adaptive method is superior.

## References

1. Shomrat, T. & Levin, M. “An automated training paradigm reveals long-term memory in planaria and its persistence through head regeneration.” *Journal of Experimental Biology* 216 (2013). [doi:10.1242/jeb.087809](https://doi.org/10.1242/jeb.087809).
2. Liu, X. et al. “Optogenetic stimulation of a hippocampal engram activates fear memory recall.” *Nature* 484 (2012). [doi:10.1038/nature11028](https://doi.org/10.1038/nature11028).
3. Pauwels, E., Lajaunie, C. & Vert, J.-P. “A Bayesian active learning strategy for sequential experimental design in systems biology.” *BMC Systems Biology* 8, 102 (2014). [doi:10.1186/s12918-014-0102-6](https://doi.org/10.1186/s12918-014-0102-6).
4. Cvjetko, M. et al. “The Artificial Experimentalist: Discovery and Control of Self-Organizing Phenomena with Autotelic Reinforcement Learning.” (2026). [arXiv:2608.26116](https://arxiv.org/abs/2608.26116).
5. Zhang, I., Risi, S. & Darlow, L. “Petri Dish Neural Cellular Automata.” (2025). [Project and paper](https://pub.sakana.ai/pdnca/).
6. Guichard, E. et al. “EngramNCA: a Neural Cellular Automaton Model of Memory Transfer.” (2025). [arXiv:2504.11855](https://arxiv.org/abs/2504.11855).
