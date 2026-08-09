import { expect, test } from "bun:test";

import { aggregateWorkStages } from "./work-stages";

const items = [
  { id: "structure", parentId: null, code: "1", description: "Structure", weight: 0, sortOrder: 1 },
  { id: "columns", parentId: "structure", code: "1.1", description: "Columns", weight: 60, sortOrder: 1 },
  { id: "beams", parentId: "structure", code: "1.2", description: "Beams", weight: 40, sortOrder: 2 },
  { id: "mobilisation", parentId: null, code: "2", description: "Mobilisation", weight: 10, sortOrder: 2 },
];

test("aggregates leaf progress by top-level section weight", () => {
  const stages = aggregateWorkStages(items, [
    { boqItemId: "columns", pctComplete: 50 },
    { boqItemId: "beams", pctComplete: 100 },
  ]);

  expect(stages[0]).toEqual({
    id: "structure",
    name: "Structure",
    progress: 70,
    state: "in_progress",
  });
});

test("treats a childless section as a work stage", () => {
  const stages = aggregateWorkStages(items, [
    { boqItemId: "mobilisation", pctComplete: 100 },
  ]);

  expect(stages[1]).toEqual({
    id: "mobilisation",
    name: "Mobilisation",
    progress: 100,
    state: "complete",
  });
});

test("keeps unreported and explicitly zero stages not started", () => {
  expect(aggregateWorkStages(items, [])[0]!.state).toBe("not_started");
  expect(
    aggregateWorkStages(items, [{ boqItemId: "columns", pctComplete: 0 }])[0]!.state,
  ).toBe("not_started");
});

test("uses the completion tolerance used by the overview", () => {
  const stage = aggregateWorkStages(
    [{ id: "stage", parentId: null, code: "1", description: "Stage", weight: 100, sortOrder: 1 }],
    [{ boqItemId: "stage", pctComplete: 99.95 }],
  )[0];

  expect(stage?.state).toBe("complete");
});
