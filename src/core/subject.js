import { validateRunConfig } from "./config.js";
import { randomForEvent } from "./random.js";

const MECHANISM_IDS = Object.freeze([
  "local-trace",
  "distributed-trace",
  "regenerative-reconstruction",
  "readout-adaptation",
  "context-gated",
]);
const TRACE_SLOTS = 4;

function makeCell(index, x, y, height) {
  let region = "body";
  if (y === 0) region = "head";
  else if (y === height - 1) region = "tail";
  else if (y === height - 2) region = "wound-border";
  return {
    index,
    x,
    y,
    region,
    alive: true,
    channels: {
      voltage: 0,
      trace: Array(TRACE_SLOTS).fill(0),
      plasticity: Array(TRACE_SLOTS).fill(0),
    },
  };
}

function makeGrid(width, height) {
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push(makeCell(y * width + x, x, y, height));
    }
  }
  return { width, height, cells };
}

function regionIndices(grid, region) {
  return grid.cells.filter((cell) => cell.region === region).map((cell) => cell.index);
}

function spreadIndices(indices, count) {
  if (indices.length === 0) return [];
  if (indices.length <= count) return [...indices];
  const chosen = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor((i + 0.5) * indices.length / count);
    chosen.push(indices[index]);
  }
  return [...new Set(chosen)];
}

function wiringForFamily(familyId, grid) {
  const head = regionIndices(grid, "head");
  const body = regionIndices(grid, "body");
  const woundBorder = regionIndices(grid, "wound-border");
  switch (familyId) {
    case "local-trace":
      return { cellRouteIds: [head[Math.floor(head.length / 2)]], cellRouteWeight: 1, readoutWeight: 0 };
    case "distributed-trace":
      return { cellRouteIds: spreadIndices(body, 8), cellRouteWeight: 1, readoutWeight: 0 };
    case "regenerative-reconstruction":
      return { cellRouteIds: [woundBorder[Math.floor(woundBorder.length / 2)]], cellRouteWeight: 1, readoutWeight: 0 };
    case "readout-adaptation":
      return { cellRouteIds: [], cellRouteWeight: 0, readoutWeight: 1 };
    case "context-gated":
      return {
        cellRouteIds: [...spreadIndices(head, 2), ...spreadIndices(body, 2)],
        cellRouteWeight: 0.5,
        readoutWeight: 0.5,
      };
    default:
      throw new TypeError(`unsupported mechanism family: ${familyId}`);
  }
}

function combineWiring(recipe, grid) {
  const routeIds = new Set();
  let cellRouteWeight = 0;
  let readoutWeight = 0;
  for (const part of recipe) {
    const wiring = wiringForFamily(part.family, grid);
    for (const index of wiring.cellRouteIds) routeIds.add(index);
    cellRouteWeight += wiring.cellRouteWeight * part.weight;
    readoutWeight += wiring.readoutWeight * part.weight;
  }
  return {
    cellRouteIds: [...routeIds].sort((a, b) => a - b),
    cellRouteWeight,
    readoutWeight,
  };
}

function makeOpenRecipe(seed) {
  const firstIndex = Math.floor(randomForEvent(seed, ["open-substrate", "family-a"]) * MECHANISM_IDS.length);
  let secondIndex = Math.floor(randomForEvent(seed, ["open-substrate", "family-b"]) * MECHANISM_IDS.length);
  if (secondIndex === firstIndex) secondIndex = (secondIndex + 1) % MECHANISM_IDS.length;
  return [
    { family: MECHANISM_IDS[firstIndex], weight: 0.5 },
    { family: MECHANISM_IDS[secondIndex], weight: 0.5 },
  ];
}

function normalizeConfig(config) {
  const result = validateRunConfig(config);
  if (!result.ok) throw new TypeError(`invalid subject config: ${result.errors.map((error) => error.path).join(", ")}`);
  return result.value;
}

function cloneSubject(subject) {
  return structuredClone(subject);
}

function scoreActions(subject, cue) {
  const slot = cue * 2;
  let cellCount = 0;
  let cellZero = 0;
  let cellOne = 0;
  for (const index of subject.wiring.cellRouteIds) {
    const cell = subject.grid.cells[index];
    if (!cell?.alive) continue;
    cellCount += 1;
    cellZero += cell.channels.trace[slot];
    cellOne += cell.channels.trace[slot + 1];
  }
  const cellScale = cellCount > 0 ? subject.wiring.cellRouteWeight / cellCount : 0;
  return [
    cellZero * cellScale + subject.readout.scores[slot] * subject.wiring.readoutWeight,
    cellOne * cellScale + subject.readout.scores[slot + 1] * subject.wiring.readoutWeight,
  ];
}

function contextCueMap(subject, context) {
  if (context && typeof context === "object" && Array.isArray(context.cueToAction)) {
    return context.cueToAction;
  }
  if (context === "reversed" || context === "remapped" || context === "shifted") {
    return [1 - subject.task.cueToAction[0], 1 - subject.task.cueToAction[1]];
  }
  return subject.task.cueToAction;
}

export function createBenchmarkCase({ seed, config, mechanismId, ruleId }) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new TypeError("seed must be an unsigned 32-bit integer");
  }
  if (typeof ruleId !== "string" || ruleId.trim().length === 0) {
    throw new TypeError("ruleId must be a nonempty string");
  }
  const runConfig = normalizeConfig(config);
  const grid = makeGrid(runConfig.gridWidth, runConfig.gridHeight);
  let recipe;
  if (mechanismId === "open-substrate") {
    recipe = makeOpenRecipe(seed);
  } else {
    if (!MECHANISM_IDS.includes(mechanismId)) throw new TypeError("unknown mechanismId");
    recipe = [{ family: mechanismId, weight: 1 }];
  }

  const subject = {
    schemaVersion: 1,
    subjectId: `subject-${seed}-${ruleId}`,
    seed,
    step: 0,
    randomness: { algorithm: "event-keyed-v1", eventCounter: 0 },
    grid,
    development: { ruleId, frozen: true, age: 0, generation: 0 },
    task: {
      cueToAction: [...runConfig.cueToAction],
      rewardNoise: runConfig.rewardNoise,
      preflightAccuracy: runConfig.preflightAccuracy,
      retainedAccuracy: runConfig.retainedAccuracy,
      partialAccuracy: runConfig.partialAccuracy,
      measurementTrials: runConfig.measurementTrials,
    },
    wiring: combineWiring(recipe, grid),
    readout: { scores: Array(TRACE_SLOTS).fill(0) },
  };

  const auditorRecord = {
    subjectId: subject.subjectId,
    mechanismId,
    ruleId,
    recipe: recipe.map((entry) => ({ family: entry.family, weight: entry.weight })),
  };
  return { subject, auditorRecord };
}

export function trainSubject(subject, { episodes }) {
  if (!Number.isInteger(episodes) || episodes < 0 || episodes > 1000) {
    throw new RangeError("episodes must be an integer in [0, 1000]");
  }
  const trained = cloneSubject(subject);
  const trainingRows = [];
  for (let localEpisode = 0; localEpisode < episodes; localEpisode += 1) {
    const episode = trained.randomness.eventCounter;
    const cue = (episode + (trained.seed & 1)) % 2;
    const targetAction = trained.task.cueToAction[cue];
    const rewardWasNoisy = randomForEvent(trained.seed, [
      "training-v1",
      trained.subjectId,
      episode,
      "reward-noise",
    ]) < trained.task.rewardNoise;
    const rewardedAction = rewardWasNoisy ? 1 - targetAction : targetAction;
    const slot = cue * 2;

    for (const index of trained.wiring.cellRouteIds) {
      const cell = trained.grid.cells[index];
      if (!cell?.alive) continue;
      cell.channels.trace[slot + rewardedAction] += 1;
      cell.channels.trace[slot + (1 - rewardedAction)] -= 1;
      cell.channels.plasticity[slot + rewardedAction] = 1;
    }
    if (trained.wiring.readoutWeight > 0) {
      trained.readout.scores[slot + rewardedAction] += 1;
      trained.readout.scores[slot + (1 - rewardedAction)] -= 1;
    }
    trained.step += 1;
    trained.randomness.eventCounter += 1;
    trainingRows.push({
      episode,
      cue,
      targetAction,
      rewardedAction,
      rewardWasNoisy,
      correct: rewardedAction === targetAction,
    });
  }

  const preflight = measureBehavior(trained, {
    context: "familiar",
    trials: trained.task.measurementTrials,
    eventKey: ["preflight-v1", trained.seed, trained.subjectId],
  });
  const preflightPassed = episodes > 0 && preflight.accuracy >= trained.task.preflightAccuracy;
  return {
    subject: trained,
    trainingRows,
    summary: {
      episodes,
      preflightAccuracy: preflight.accuracy,
      preflightPassed,
      memoryEligible: preflightPassed,
      noisyRewardCount: trainingRows.filter((row) => row.rewardWasNoisy).length,
    },
  };
}

export function measureBehavior(subject, { context = "familiar", trials, eventKey }) {
  if (!Number.isInteger(trials) || trials < 1 || trials > 1000) {
    throw new RangeError("trials must be an integer in [1, 1000]");
  }
  if (!Array.isArray(eventKey)) throw new TypeError("eventKey must be a stable tuple");
  const cueMap = contextCueMap(subject, context);
  if (!Array.isArray(cueMap) || cueMap.length !== 2
    || !cueMap.every((action) => Number.isInteger(action) && action >= 0 && action <= 1)) {
    throw new TypeError("context must provide a binary cue-to-action mapping");
  }

  const rows = [];
  for (let trial = 0; trial < trials; trial += 1) {
    const draw = randomForEvent(subject.seed, [...eventKey, trial, "evaluation-cue"]);
    const cue = draw < 0.5 ? 0 : 1;
    const targetAction = cueMap[cue];
    const [scoreZero, scoreOne] = scoreActions(subject, cue);
    const chosenAction = scoreOne > scoreZero ? 1 : 0;
    rows.push({
      trial,
      cue,
      targetAction,
      chosenAction,
      correct: chosenAction === targetAction,
      context: typeof context === "string" ? context : "custom",
    });
  }
  const correctCount = rows.reduce((count, row) => count + Number(row.correct), 0);
  const accuracy = correctCount / rows.length;
  let category = "lost";
  if (accuracy >= subject.task.retainedAccuracy) category = "retained";
  else if (accuracy >= subject.task.partialAccuracy) category = "partial";
  return { rows, accuracy, category };
}
