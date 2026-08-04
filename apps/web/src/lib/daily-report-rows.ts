export type DailyManpowerRow = {
  trade: string;
  headcount: string;
  hours: string;
  note: string;
};

export type DailyEquipmentRow = {
  name: string;
  quantity: string;
  hoursUsed: string;
  idle: boolean;
  note: string;
};

export type DailyDeliveryRow = {
  material: string;
  quantity: string;
  unit: string;
  supplier: string;
  reference: string;
  note: string;
};

export type DailyRowErrors = {
  manpower: number[];
  equipment: number[];
  deliveries: number[];
};

function hasEnteredValue(row: object) {
  return Object.values(row as Record<string, string | boolean>).some((value) =>
    typeof value === "boolean" ? value : value.trim() !== "",
  );
}

export function invalidDailyPrimaryRows(
  manpower: DailyManpowerRow[],
  equipment: DailyEquipmentRow[],
  deliveries: DailyDeliveryRow[],
): DailyRowErrors {
  return {
    manpower: manpower.flatMap((row, index) =>
      row.trade.trim() === "" && hasEnteredValue(row) ? [index] : [],
    ),
    equipment: equipment.flatMap((row, index) =>
      row.name.trim() === "" && hasEnteredValue(row) ? [index] : [],
    ),
    deliveries: deliveries.flatMap((row, index) =>
      row.material.trim() === "" && hasEnteredValue(row) ? [index] : [],
    ),
  };
}
