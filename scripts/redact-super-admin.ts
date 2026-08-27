/**
 * Takes the super admin's identity out of everything a company can see.
 *
 * The role exists to supervise every company's data from outside all of them.
 * Nothing an admin or a user reads should name the person holding it, and three
 * places did:
 *
 *   1. `user.name` — rendered anywhere the account is listed or joined.
 *   2. `project.managerId` — puts the name *and* the email on a project page,
 *      which every admin and assigned user of that company reads.
 *   3. `activity_log.actorName` — copied in at write time on purpose, so the
 *      feed can still name a deleted user. That same denormalisation means
 *      renaming the account does not rewrite the history behind it.
 *
 * The code side is already closed: `project.managerOptions` no longer lists
 * super admins and `assertUserAssignable` rejects them, so no new assignment
 * can happen. This is the existing rows.
 *
 * Idempotent — safe to re-run, and safe to run when there is nothing to do.
 * Run against each environment separately:
 *
 *   bun --env-file=apps/server/.env scripts/redact-super-admin.ts
 *   bun --env-file=apps/server/.env scripts/redact-super-admin.ts --dry-run
 */
import { db } from "@DashboardV2/db";
import { activityLog, project, user } from "@DashboardV2/db/schema";
import { normalizeUsername } from "@DashboardV2/auth/username";
import { and, eq, inArray, ne } from "drizzle-orm";

/** Matches recordActivity's own fallback for an action with no session. */
const SYSTEM_NAME = "System";

const dryRun = process.argv.includes("--dry-run");

const accounts = await db.select({
  id: user.id,
  name: user.name,
  email: user.email,
  username: user.username,
  displayUsername: user.displayUsername,
  role: user.role,
}).from(user);
const superAdmins = accounts
  .filter((account) => account.role === "super_admin")
  .sort((left, right) => left.id.localeCompare(right.id));

if (superAdmins.length === 0) {
  console.log("No super admin accounts. Nothing to do.");
  process.exit(0);
}

console.log(
  `${superAdmins.length} super admin account(s): ${superAdmins
    .map((row) => `${row.name} <${row.email}>`)
    .join(", ")}`,
);
if (dryRun) console.log("\n-- dry run, nothing will be written --");

const ids = superAdmins.map((row) => row.id);

// 1. The account name itself. The email is left alone: it is the login, and it
//    is no longer exposed anywhere a company can read now that (2) and the
//    manager picker are fixed.
const systemAliasPattern = /^System(?: (?:[2-9]|\d{2,}))?$/;
const reservedNames = new Set(
  accounts
    .filter((account) => account.role !== "super_admin")
    .map((account) => account.username),
);
for (const account of superAdmins) {
  if (systemAliasPattern.test(account.name)) reservedNames.add(normalizeUsername(account.name));
}

let aliasNumber = 1;
function nextSystemAlias() {
  while (true) {
    const name = aliasNumber === 1 ? SYSTEM_NAME : `${SYSTEM_NAME} ${aliasNumber}`;
    aliasNumber += 1;
    if (!reservedNames.has(normalizeUsername(name))) return name;
  }
}

const aliases = new Map<string, string>();
for (const account of superAdmins) {
  const name = systemAliasPattern.test(account.name) ? account.name : nextSystemAlias();
  aliases.set(account.id, name);
  reservedNames.add(normalizeUsername(name));
}
const needsRename = superAdmins.filter((account) => {
  const name = aliases.get(account.id)!;
  return account.name !== name || account.username !== normalizeUsername(name) || account.displayUsername !== name;
});
console.log(`\n1. account identities to redact: ${needsRename.length}`);
if (!dryRun && needsRename.length > 0) {
  for (const account of needsRename) {
    const name = aliases.get(account.id)!;
    await db
      .update(user)
      .set({ name, username: normalizeUsername(name), displayUsername: name })
      .where(eq(user.id, account.id));
  }
}

// 2. Project manager assignments. Cleared rather than reassigned — there is no
//    way to guess who should own these, and "Unassigned" is at least true.
const managed = await db
  .select({ id: project.id, code: project.code, name: project.name })
  .from(project)
  .where(inArray(project.managerId, ids));
console.log(`2. projects managed by a super admin: ${managed.length}`);
for (const row of managed) console.log(`     ${row.code} - ${row.name}`);
if (!dryRun && managed.length > 0) {
  await db
    .update(project)
    .set({ managerId: null })
    .where(inArray(project.managerId, ids));
}

// 3. Historical activity rows. Going forward recordActivity copies the session
//    redacted alias, while the feed always uses the generic System label.
const staleActivity = await db
  .select({ id: activityLog.id })
  .from(activityLog)
  .where(and(inArray(activityLog.actorId, ids), ne(activityLog.actorName, SYSTEM_NAME)));
console.log(`3. activity rows still naming a super admin: ${staleActivity.length}`);
if (!dryRun && staleActivity.length > 0) {
  await db
    .update(activityLog)
    .set({ actorName: SYSTEM_NAME })
    .where(and(inArray(activityLog.actorId, ids), ne(activityLog.actorName, SYSTEM_NAME)));
}

if (dryRun) {
  console.log("\nDry run complete — nothing written.");
  process.exit(0);
}

// Read back rather than trusting the writes.
const redactedAccounts = await db
  .select({ id: user.id, name: user.name, username: user.username, displayUsername: user.displayUsername })
  .from(user)
  .where(inArray(user.id, ids));
const stillManaged = await db
  .select({ id: project.id })
  .from(project)
  .where(inArray(project.managerId, ids));
const stillNamed = await db
  .select({ id: activityLog.id })
  .from(activityLog)
  .where(and(inArray(activityLog.actorId, ids), ne(activityLog.actorName, SYSTEM_NAME)));

const remainingIdentity = redactedAccounts.find((account) => {
  const name = aliases.get(account.id);
  return !name || account.name !== name || account.username !== normalizeUsername(name) || account.displayUsername !== name;
});
const clean = !remainingIdentity && stillManaged.length === 0 && stillNamed.length === 0;
console.log(
  clean
    ? "\nDone. No company-visible record names a super admin."
    : `\nINCOMPLETE: name=${remainingIdentity?.name ?? "ok"} projects=${stillManaged.length} activity=${stillNamed.length}`,
);
process.exit(clean ? 0 : 1);
