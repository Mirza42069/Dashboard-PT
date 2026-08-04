import { describe, expect, test } from "bun:test";

import { invalidDailyPrimaryRows } from "./daily-report-rows";

describe("daily report structured rows", () => {
  test("ignores completely empty rows", () => {
    expect(
      invalidDailyPrimaryRows(
        [{ trade: "", headcount: "", hours: "", note: "" }],
        [{ name: "", quantity: "", hoursUsed: "", idle: false, note: "" }],
        [{ material: "", quantity: "", unit: "", supplier: "", reference: "", note: "" }],
      ),
    ).toEqual({ manpower: [], equipment: [], deliveries: [] });
  });

  test("flags partially completed rows without their primary label", () => {
    expect(
      invalidDailyPrimaryRows(
        [{ trade: "", headcount: "4", hours: "", note: "" }],
        [{ name: "", quantity: "1", hoursUsed: "", idle: false, note: "" }],
        [{ material: "", quantity: "", unit: "kg", supplier: "", reference: "", note: "" }],
      ),
    ).toEqual({ manpower: [0], equipment: [0], deliveries: [0] });
  });

  test("accepts rows once the primary label is present", () => {
    expect(
      invalidDailyPrimaryRows(
        [{ trade: "Carpenter", headcount: "", hours: "", note: "" }],
        [{ name: "Crane", quantity: "", hoursUsed: "", idle: false, note: "" }],
        [{ material: "Concrete", quantity: "", unit: "", supplier: "", reference: "", note: "" }],
      ),
    ).toEqual({ manpower: [], equipment: [], deliveries: [] });
  });
});
