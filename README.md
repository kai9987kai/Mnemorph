# Mnemorph

**Adaptive memory archaeology for synthetic systems.** Mnemorph asks whether a bounded experiment compiler can distinguish persistent traces, reconstruction during regeneration, and behavioral readout changes by choosing informative matched assays.

> Mnemorph is a local synthetic software model. It is not a biological model or experiment, and its output provides no biological, clinical, consciousness, or ecological evidence.

## Run locally

Requires Node.js 20 or newer. The project has no third-party runtime dependencies.

```powershell
npm test
npm run benchmark -- --config configs/benchmark-smoke.json --out output/smoke
npm run serve -- --port 4173
```

Open <http://127.0.0.1:4173/> for the browser workbench. The server binds only to loopback. The smoke command writes three files under `output/smoke/`:

- `public-receipt.json`: sealed, replayable run data and raw event rows; this is the file to import into the workbench.
- `auditor-evaluation.json`: authoritative synthetic mechanism labels and withheld scoring, kept outside the public receipt and UI session. Public replay snapshots still expose subject state, including wiring details that an informed reader may use to infer a label.
- `raw-events.csv`: event-level observations for independent inspection.

The versioned smoke profile uses eight measurement trials, four fixed master seeds, five synthetic mechanism families, and all six comparison methods. It is a wiring and reproducibility check sized to fit the 2 MiB receipt-import limit. It is not powered evidence for a research claim.

## What it compares

Each matched seed block trains a synthetic grid subject, forks the same saved state across methods, and tests typed interventions such as lesion, scramble, delay, regrowth, and context shift. The runtime compiler receives candidate hypotheses, visible observations, and frozen pre-outcome predictions, but not the auditor label or replay snapshot. The independent evaluator scores predictions for withheld interventions and retains the authoritative synthetic mechanism label. Public replay snapshots contain wiring details, so this is a data-flow boundary rather than a secrecy guarantee.

The benchmark methods are fixed one-factor, fixed factorial, random equal-budget, frozen-grammar information gain, adaptive revisable grammar, and an auditor-only oracle diagnostic. The central comparison is adaptive revisable grammar versus frozen-grammar information gain under the same assay and candidate-search budgets. Lower paired Brier score on withheld programs is better. Results that miss the preregistered interval, transfer, calibration, or null-control criteria count as unsupported.

## Documentation

- [Research paper](docs/paper.md): system design, verification results, related work, and limits on interpretation.
- [Research note](docs/research-note.md): research question, adjacent work, candidate contribution, and falsification criteria.
- [Experiment protocol](docs/experiment-protocol.md): local workflow, data products, replay, and confirmatory-plan boundaries.
- [Safety and limits](docs/safety-and-limits.md): synthetic-only scope and implementation limits.
- [Roadmap](docs/roadmap.md): V0–V3 milestones and failure gates.
- [Design specification](docs/superpowers/specs/2026-10-06-mnemorph-design.md): approved thesis and architecture.

## Current limits

The subject is a compact hand-coded grid simulator with a cue-to-action learning task and five predefined synthetic mechanism families. Their authoritative assignment labels are omitted from compiler inputs and public receipt fields, but a source-informed reader can infer some assignments from public snapshot wiring. This is not a neural cellular automaton, biophysical model, animal model, or validated theory of memory. The included benchmark and smoke run test software behavior against synthetic ground truth only. The confirmatory file is an unlocked template; no confirmatory result is available from this repository state.
