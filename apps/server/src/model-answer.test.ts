import { expect, test } from "bun:test";

import { parseModelAnswer } from "./model-answer";

test("a malformed model answer still settles the AI credit", async () => {
  let answered = false;

  expect(
    await parseModelAnswer(
      "{}",
      () => {
        answered = true;
      },
      () => null,
    ),
  ).toBeNull();
  expect(answered).toBe(true);
});
