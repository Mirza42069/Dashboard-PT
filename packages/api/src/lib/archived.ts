import { TRPCError } from "@trpc/server";

import type { ArchivedEntity, MessageDictionary } from "./messages/index";

/**
 * The archived gate, in one place because five different resolvers apply it.
 *
 * Its own module rather than a function in lib/scope.ts: that file imports the
 * database client at module load, so anything living there cannot be unit
 * tested without a connection — and this is the rule the whole read-only
 * behaviour rests on, so it is the one part that most deserves a test.
 *
 * Takes the timestamp each caller has already fetched, so enforcing this costs
 * no extra query anywhere.
 *
 * CONFLICT rather than FORBIDDEN: the caller is allowed to do this, the project
 * is simply not in a state to accept it, and the fix is an action they can
 * take. FORBIDDEN would read as "you lack permission", which is not true and
 * sends them to an admin instead of to the restore button.
 *
 * `entity` selects a whole sentence rather than naming a noun to splice into
 * one. "This ${entity} is archived" only works because English happens to let a
 * noun drop into that slot untouched; the Indonesian sentence moves both the
 * demonstrative and the word order, so there is nothing to splice into.
 */
export function assertNotArchived(
  t: MessageDictionary,
  archivedAt: Date | null,
  entity: ArchivedEntity = "project",
) {
  if (archivedAt === null) return;
  throw new TRPCError({ code: "CONFLICT", message: t.archived[entity] });
}
