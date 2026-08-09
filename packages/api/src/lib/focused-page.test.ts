import { expect, test } from "bun:test";

import { pageWithFocus } from "./focused-page";

test("a focused row never exceeds the requested page limit", () => {
  const page = pageWithFocus([{ id: "newest" }, { id: "older" }], { id: "focus" }, 1);

  expect(page.items).toEqual([{ id: "focus" }]);
  expect(page.next).toEqual({ row: { id: "newest" }, inclusive: true });
});

test("the inclusive continuation preserves the first regular row", () => {
  const first = pageWithFocus([{ id: "newest" }, { id: "older" }], { id: "focus" }, 1);
  const continuation = pageWithFocus(
    [{ id: first.next!.row.id }, { id: "older" }],
    undefined,
    1,
  );

  expect(continuation.items).toEqual([{ id: "newest" }]);
  expect(continuation.next).toEqual({ row: { id: "newest" }, inclusive: false });
});

test("larger focused pages reserve one slot and continue after the last consumed row", () => {
  const page = pageWithFocus(
    [{ id: "one" }, { id: "two" }, { id: "three" }],
    { id: "focus" },
    3,
  );

  expect(page.items.map((row) => row.id)).toEqual(["focus", "one", "two"]);
  expect(page.next).toEqual({ row: { id: "two" }, inclusive: false });
});
