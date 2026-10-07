# Safety and limits

## Scope

Mnemorph runs a hand-coded, synthetic grid simulator in a local browser or Node.js process. It has no animal, human, tissue, device, or laboratory interface. It does not measure consciousness or sentience and cannot support biological, clinical, ecological, or other real-world decisions.

## Bounded execution

- The compiler can select only from a fixed typed intervention vocabulary; a program has at most four operations and cannot emit or execute arbitrary source code.
- Jobs validate configuration before work begins and enforce limits on grid dimensions and area, training episodes, ticks, trials, seed blocks, branches, and candidate evaluations.
- The browser server binds only to `127.0.0.1`, serves allowlisted project modules, accepts only GET/HEAD, and rejects traversal and symlink escapes.
- Destructive interventions affect matched clone branches. They do not modify an external system or an original persistent subject.
- Receipt import checks the schema, SHA-256 digest, and 2 MiB size limit before changing the current session.

## Information boundaries

The runtime compiler can compare named candidate hypotheses and prior public observations. It is not passed the authoritative mechanism label, withheld outcome scores, or initial replay snapshot. The auditor record owns the authoritative labels and scores, while public replay snapshots retain the subject's state and wiring so runs can be replayed. Those wiring details can reveal recognizable mechanism signatures to a source-informed reader; the boundary is direct data flow into the compiler, not confidentiality against inference. Predictions are stored before corresponding outcomes are exposed. Keep `auditor-evaluation.json` separate from public receipts and never add its labels or scores to compiler inputs.

## Claims and interpretation

The built-in families are programmer-defined benchmark mechanisms, not inferred biological categories. Any result is conditional on the chosen grid, learning rule, task, intervention vocabulary, thresholds, seeds, and synthetic mechanism suite. An unlocked plan, pilot, smoke run, or exploratory receipt cannot establish confirmatory success. A confirmatory interpretation requires a separate preregistered lock and every prespecified success and calibration criterion.

Null, failed, invalid, underpowered, and inconclusive runs must remain visible. A null result does not establish that memory is absent; it only describes behavior under the tested synthetic configuration. No claim should be extended from these simulations to organisms, patients, or natural systems.
