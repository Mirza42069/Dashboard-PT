import { expect, test } from "bun:test";

import { databaseErrorIncludes } from "./database-error";

test("database error matching follows nested driver causes", () => {
  const wrapped = new Error("Query failed", {
    cause: new Error("PostgreSQL: division by zero"),
  });

  expect(databaseErrorIncludes(wrapped, "division by zero")).toBe(true);
  expect(databaseErrorIncludes(wrapped, "unique violation")).toBe(false);
});
