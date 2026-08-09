import { scheduleRows, type BoqItemLike } from "./curves";

export type WorkStageReading = {
  boqItemId: string;
  pctComplete: number;
};

export type WorkStage = {
  id: string;
  name: string;
  progress: number;
  state: "complete" | "in_progress" | "not_started";
};

/** Rolls the latest reading for each leaf into its top-level work section. */
export function aggregateWorkStages(
  items: BoqItemLike[],
  latestReadings: WorkStageReading[],
): WorkStage[] {
  const readings = new Map(latestReadings.map((reading) => [reading.boqItemId, reading.pctComplete]));
  const stages = new Map<
    string,
    { name: string; weight: number; completed: number; hasReading: boolean }
  >();

  for (const row of scheduleRows(items)) {
    const stage = stages.get(row.sectionId) ?? {
      name: row.section,
      weight: 0,
      completed: 0,
      hasReading: false,
    };
    const reading = readings.get(row.leaf.id);
    stage.weight += row.leaf.weight;
    stage.completed += (row.leaf.weight * (reading ?? 0)) / 100;
    stage.hasReading ||= reading !== undefined;
    stages.set(row.sectionId, stage);
  }

  return [...stages].map(([id, stage]) => {
    const progress = stage.weight > 0 ? (stage.completed / stage.weight) * 100 : 0;
    return {
      id,
      name: stage.name,
      progress,
      state:
        !stage.hasReading || progress === 0
          ? "not_started"
          : progress >= 99.95
            ? "complete"
            : "in_progress",
    };
  });
}
