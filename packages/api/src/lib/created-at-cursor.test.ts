import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  createdAtCursorCondition,
  createdAtCursorSchema,
  exactCursorTimestamp,
} from "./created-at-cursor";

const dialect = new PgDialect();
const cursor = { createdAt: "2026-08-09T12:34:56.123456Z", id: "row-2" };

test("cursor timestamps require PostgreSQL's exact microsecond representation", () => {
  expect(createdAtCursorSchema.parse(cursor)).toEqual(cursor);
  expect(
    createdAtCursorSchema.safeParse({ ...cursor, createdAt: "2026-08-09T12:34:56.123Z" })
      .success,
  ).toBe(false);
});

test("cursor timestamps are formatted by PostgreSQL", () => {
  const query = dialect.sqlToQuery(exactCursorTimestamp(sql.identifier("created_at")));

  expect(query.sql).toBe(`to_char("created_at", 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  expect(query.params).toEqual([]);
});

test("cursor conditions compare the supplied timestamp and id directly", () => {
  const condition = createdAtCursorCondition(
    sql.identifier("created_at"),
    sql.identifier("id"),
    cursor,
  );
  const query = dialect.sqlToQuery(condition);

  expect(query.sql).toBe(`("created_at", "id") < ($1::timestamp, $2)`);
  expect(query.params).toEqual([cursor.createdAt, cursor.id]);
});

test("inclusive cursor conditions preserve focused-page continuations", () => {
  const condition = createdAtCursorCondition(
    sql.identifier("created_at"),
    sql.identifier("id"),
    cursor,
    true,
  );

  expect(dialect.sqlToQuery(condition).sql).toBe(`("created_at", "id") <= ($1::timestamp, $2)`);
});
