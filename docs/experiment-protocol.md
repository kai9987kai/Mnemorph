# Experiment protocol

## Local setup

Use Node.js 20 or newer. No package installation is required for the current dependency-free project.

```powershell
npm test
npm run benchmark -- --config configs/benchmark-smoke.json --out output/smoke
npm run serve -- --port 4173
```

Open <http://127.0.0.1:4173/> in a browser. The local server permits only GET/HEAD requests, binds to `127.0.0.1`, and exposes the UI, its JavaScript module dependencies, the smoke configuration, and a source manifest.

## Smoke run

`configs/benchmark-smoke.json` fixes four master seeds, five synthetic mechanism families, six method IDs, and eight measurement trials. Eight trials keep the raw event receipt below the 2 MiB import cap while retaining the full comparison matrix. This profile checks orchestration, method matching, raw-row capture, source hashing, and receipt writing. Do not treat it as powered or confirmatory evidence.

The command writes:

| File | Contents | Intended use |
|---|---|---|
| `public-receipt.json` | Public configuration, source/runtime metadata, snapshots, predictions, protocols, results, failures, and encoded raw rows with a SHA-256 digest. | Import, replay, share, or verify the run. |
| `auditor-evaluation.json` | Separate synthetic mechanism truth and auditor scoring. | Offline evaluation only; do not feed it back to the compiler. |
| `raw-events.csv` | Decoded event-level behavioral observations. | Independent inspection and analysis. |

The browser imports the public receipt, not the auditor record. The receipt stores raw observations rather than replacing them with aggregate-only output. Re-running the same configuration and seeds produces the same public data and raw rows; receipt timestamps and consequently the receipt digest can differ.

## Browser workflow

1. Start the loopback server and load the local workbench.
2. Start the smoke experiment. Seed-block progress appears while the worker runs.
3. Inspect method, seed block, tissue snapshot, ordered operations, and frozen predictions.
4. Select a method and seed block to replay the saved assay.
5. Export the public JSON receipt or raw CSV. Import validates the receipt before adding it to the session.
6. Start a second run and cancel it to verify cancellation behavior. Cancelled or failed work must not create a successful receipt.

Receipt files are written under the project `output/` directory. The CLI rejects output directories outside the project. Keep auditor output separate when moving or sharing public receipts.

## Methods and fairness controls

The current comparison contains fixed one-factor, fixed factorial, random equal-budget, frozen-grammar information-gain, adaptive revisable-grammar, and oracle-only diagnostic methods. Methods fork the same pre-intervention snapshot. Shared exogenous draws use deterministic event keys without an arm identifier. Each method receives equal seed blocks and assay/search limits; record both candidate evaluations and compute time when comparing results.

The runtime compiler receives candidate hypothesis definitions and prior public observations, but it is not passed the auditor label or replay snapshot. It records predictions before outcomes; authoritative mechanism labels and withheld-program scores remain in the separate auditor path. Public replay snapshots expose subject wiring details, which a source-informed reader may use to infer a label. This boundary prevents direct label input to the compiler; it does not promise secrecy against inference from public state. Withheld outcomes are for evaluation and do not update the compiler's history.

## Confirmatory boundary

`configs/confirmatory-template.json` is an **unlocked preregistration template**, not a benchmark run configuration. The current runner rejects it because it lacks the benchmark's `runConfig`, `masterSeeds`, and family fields. Run an exploratory pilot, then create a separate locked plan with disjoint pilot/confirmatory seeds and rule families, pilot-derived fixed sample size, frozen withheld-assay hash, held-out families and contexts, fixed budgets, stopping rule, null bound, and calibration threshold. Set `locked: true` only after those values are established. This repository does not turn the smoke profile into confirmatory evidence.

## Named ablations

`configs/ablations.json` names eight planned comparisons: `freeze_grammar`, `freeze_hypothesis_updates`, `random_selection`, `remove_event_key_matching`, `disable_transplant_delay`, `disable_transfer_context`, `no_grammar_mutation_equal_compute`, and `disable_null_audit`. They describe planned switches; the current benchmark runner does not execute those ablation switches. Disabling the null audit is exploratory only and cannot support a confirmatory claim.
