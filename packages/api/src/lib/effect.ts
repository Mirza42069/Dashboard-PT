import { TRPCError } from "@trpc/server";
import { Data, Effect } from "effect";

import { databaseErrorIncludes } from "./database-error";

/**
 * The Effect seam procedures run behind.
 *
 * A handler is an `Effect.gen` whose promises — drizzle queries, scope guards,
 * batches — are lifted with `attempt`. The error channel stays the one the
 * codebase already speaks: TRPCError, with its codes, dictionaries and
 * deliberate-English policy unchanged. `runProcedure` is the single place that
 * channel collapses back into the thrown one tRPC shapes into an HTTP response.
 */

/** An infrastructure failure (database, network) with no client-facing meaning. */
export class DbError extends Data.TaggedError("DbError")<{ readonly cause: unknown }> {}

/**
 * Lifts a promise into Effect.
 *
 * TRPCError thrown by a lifted guard passes through typed, so async helpers
 * keep their single throwing implementation shared with the Hono routes;
 * anything else is infrastructure and becomes a DbError.
 */
export const attempt = <A>(run: () => Promise<A>): Effect.Effect<A, TRPCError | DbError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => (cause instanceof TRPCError ? cause : new DbError({ cause })),
  });

/** The sync counterpart — for validation blocks that fail by throwing. */
export const attemptSync = <A>(run: () => A): Effect.Effect<A, TRPCError | DbError> =>
  Effect.try({
    try: run,
    catch: (cause) => (cause instanceof TRPCError ? cause : new DbError({ cause })),
  });

/** A typed client-visible failure: `return yield* fail("NOT_FOUND", ctx.t.x.notFound)`. */
export const fail = (code: TRPCError["code"], message: string): Effect.Effect<never, TRPCError> =>
  Effect.fail(new TRPCError({ code, message }));

/**
 * Maps a guarded write's optimistic-concurrency failure (the `1 / 0` guard
 * trips as "division by zero") to the given conflict message; any other
 * infrastructure failure stays a sanitized 500.
 */
export const catchConflict = <A>(
  effect: Effect.Effect<A, TRPCError | DbError>,
  message: string,
): Effect.Effect<A, TRPCError> =>
  Effect.catchTag(effect, "DbError", (error) =>
    Effect.fail(
      databaseErrorIncludes(error.cause, "division by zero")
        ? new TRPCError({ code: "CONFLICT", message })
        : new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: error.cause }),
    ),
  );

/**
 * Runs a handler's effect as the promise tRPC expects.
 *
 * DbError becomes an INTERNAL_SERVER_ERROR with no message — tRPC supplies the
 * generic copy, which is what an uncaught error already produced; a TRPCError
 * fails as itself with its code and dictionary message intact.
 */
export const runProcedure = <A>(effect: Effect.Effect<A, TRPCError | DbError>): Promise<A> =>
  Effect.runPromise(
    Effect.catchTag(effect, "DbError", (error) =>
      Effect.fail(new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: error.cause })),
    ),
  );
