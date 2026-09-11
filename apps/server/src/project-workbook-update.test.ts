import { expect, test } from "bun:test";

// Importing the update module constructs the DB client; these tests never query it.
const defaults = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  BETTER_AUTH_SECRET: "workbook-update-test-secret-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  CORS_ORIGIN: "http://localhost:3001",
};
const missing = Object.keys(defaults).filter((key) => process.env[key] === undefined);
for (const key of missing) process.env[key] = defaults[key as keyof typeof defaults];
const { reconcileWorkbookItemReadings } = await import("./project-workbook-update");
for (const key of missing) delete process.env[key];

const periods = [1, 2, 3].map((periodIndex) => ({ id: `p${periodIndex}`, periodIndex }));
const reading = (period: number, percent: number, item = "item-a") => ({
  boqItemId: item,
  periodId: `p${period}`,
  pctComplete: percent,
  cumulativePercent: percent,
  cumulativeQuantity: null as number | null,
});

test("identical reimports leave stored item readings untouched at database precision", () => {
  expect(reconcileWorkbookItemReadings(
    [reading(1, 10)], [reading(1, 10.000001)], periods,
  )).toEqual([]);
});

test("same-period differing readings are rejected instead of overwritten", () => {
  expect(() => reconcileWorkbookItemReadings(
    [reading(1, 10)], [reading(1, 11)], periods,
  )).toThrow("conflicts with an existing reading");
});

test("conflicting readings within the import are also rejected", () => {
  expect(() => reconcileWorkbookItemReadings(
    [], [reading(1, 10), reading(1, 20)], periods,
  )).toThrow("conflicts with an existing reading");
  expect(reconcileWorkbookItemReadings(
    [], [reading(1, 10), reading(1, 10)], periods,
  )).toEqual([reading(1, 10)]);
});

test("both earlier and later stored readings constrain each imported item", () => {
  expect(() => reconcileWorkbookItemReadings(
    [reading(1, 40)], [reading(2, 30)], periods,
  )).toThrow("would decrease");
  expect(() => reconcileWorkbookItemReadings(
    [reading(3, 40)], [reading(2, 50)], periods,
  )).toThrow("would decrease");
});

test("chronology is checked per item even when the project total could increase", () => {
  expect(() => reconcileWorkbookItemReadings(
    [reading(1, 40), reading(1, 0, "item-b")],
    [reading(2, 30), reading(2, 100, "item-b")], periods,
  )).toThrow("would decrease");
});

test("valid intermediate readings are accepted regardless of input order", () => {
  expect(reconcileWorkbookItemReadings(
    [reading(3, 60), reading(1, 20)], [reading(2, 40)], periods,
  )).toEqual([reading(2, 40)]);
});

test("quantity readings cannot conflict or decrease behind rounded equal percentages", () => {
  const quantityReading = (period: number, quantity: number) => ({
    ...reading(period, 10), cumulativePercent: null, cumulativeQuantity: quantity,
  });
  expect(() => reconcileWorkbookItemReadings(
    [quantityReading(1, 10)], [quantityReading(1, 11)], periods,
  )).toThrow("conflicts with an existing reading");
  expect(() => reconcileWorkbookItemReadings(
    [quantityReading(3, 10)], [quantityReading(2, 11)], periods,
  )).toThrow("would decrease");
});

test("cleared cells and no-progress markers are not silently replaced", () => {
  expect(() => reconcileWorkbookItemReadings(
    [{ ...reading(1, 0), cumulativePercent: null }], [reading(1, 0)], periods,
  )).toThrow("conflicts with an existing reading");
});

test("an unrelated item's existing decrease does not block a valid import", () => {
  expect(reconcileWorkbookItemReadings(
    [reading(1, 50, "item-b"), reading(2, 40, "item-b")], [reading(1, 10)], periods,
  )).toEqual([reading(1, 10)]);
});

test("readings must reference the project calendar", () => {
  expect(() => reconcileWorkbookItemReadings([], [reading(4, 10)], periods))
    .toThrow("invalid reading or reporting period");
});

test("reimporting multiple weeks fills historical cells once without replacing the current week", () => {
  const calendar = [15, 16].map((periodIndex) => ({ id: `p${periodIndex}`, periodIndex }));
  const current = Array.from({ length: 22 }, (_, index) => reading(16, index * 4, `item-${index}`));
  const previous = Array.from({ length: 22 }, (_, index) => reading(15, index * 3, `item-${index}`));
  const incoming = [...previous, ...current];
  const additions = reconcileWorkbookItemReadings(current, incoming, calendar);
  expect(additions).toEqual(previous);
  expect(reconcileWorkbookItemReadings([...current, ...additions], incoming, calendar)).toEqual([]);
  expect(() => reconcileWorkbookItemReadings(
    [...current, reading(15, 1, "item-0")], incoming, calendar,
  )).toThrow("conflicts with an existing reading");
});
