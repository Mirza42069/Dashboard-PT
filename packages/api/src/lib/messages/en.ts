/**
 * Server-side user-facing copy.
 *
 * A second dictionary, deliberately separate from `apps/web/src/i18n`. That one
 * is not a dependency of `apps/server` and cannot become one without moving it
 * into a shared package — the constraint already documented at the top of
 * `apps/server/src/project-export.ts`. These two dictionaries share almost no
 * strings, so giving the server its own home is cheaper than the move, and it
 * keeps UI copy out of the API's dependency graph.
 *
 * This file is the master: its shape is the contract `id.ts` is checked against.
 * Nothing in `lib/messages` may import anything outside it — no `db`, no
 * `@trpc/server` — so it stays testable without a database and importable from
 * both the tRPC routers and the Hono routes.
 *
 * Rule for what belongs here: a message earns a translation if a non-engineer
 * could plausibly see it and there is something they could do about it. A
 * message that can only be reached by a bug, a forged request or a bad deploy
 * stays English at its throw site — its only audience reads logs.
 */
export const en = {
  auth: {
    required: "Authentication required",
    insufficientRole: "Insufficient role",
    trialEnded: "This trial has ended",
    passwordChangeRequired: "Set a new password before continuing.",
    noCompanyAssigned: "No company assigned to this account. Ask an admin to set one.",
    noCompaniesYet: "No companies exist yet. Create one under Admin → Companies.",
    companyAccountRequired: "A company account is required",
    superAdminNotPinned: "Super admins are not pinned to a company",
    unsupportedRole: "Unsupported account role",
    noPermission: "You do not have permission to make that change.",
  },
  archived: {
    project: "This project is archived. Restore it to make changes.",
    note: "This note is archived. Restore it to make changes.",
  },
  project: {
    notFound: "Project not found",
    noneFound: "No projects found",
    codeInUse: "Project code {code} is already in use",
    endBeforeStart: "End date is before the start date",
    cannotAssignManager: "You cannot assign this project manager",
    cadenceFromTiming: "Set a custom reporting cadence from the schedule's baseline timing.",
    changedRefresh: "This project changed. Refresh and try again.",
    deleteHasTickets: {
      one: "This project has {count} action, which will be deleted with it. Confirm to continue.",
      other: "This project has {count} actions, which will be deleted with it. Confirm to continue.",
    },
    bulkDeleteHasTickets: {
      one: "These projects have {count} action, which will be deleted with them. Confirm to continue.",
      other: "These projects have {count} actions, which will be deleted with them. Confirm to continue.",
    },
  },
  company: {
    notFound: "Company not found",
    codeInUse: "Company code {code} is already in use",
    cannotDeleteLast: "Cannot delete the only remaining company",
    pickOne: "Pick a company for this account",
  },
  user: {
    notFound: "User not found",
    someNotFound: "One or more users were not found",
    emailExists: "An account with that email exists",
    nameExists: "An account with that name exists",
    nameInvalid: "Enter a name using up to 120 basic Latin characters without @",
    onlySuperAdminCreatesAdmins: "Only a Super Admin can create admin or super admin accounts",
    ownCompanyOnly: "You can only create users in your own company",
    couldNotAssignCompany: "Could not assign the company — the account was not created. Try again.",
    accountEmailNotConfigured: "Account email delivery is currently disabled.",
    currentPasswordRequired: "Current password is required",
    passwordTooShort: "Password must be at least 12 characters",
    passwordMustDiffer: "Choose a password different from your current one",
    systemPasswordResetNotAllowed:
      "System account passwords cannot be reset from another account. Use the operator recovery procedure.",
    systemNoTrial: "A System account cannot be put on a trial",
    notLastSuperAdmin: "The last remaining super admin cannot be {action}.",
    notOwnAccount: "Your own account cannot be {action}.",
  },
  boq: {
    versionNotFound: "BoQ version not found",
    itemNotFound: "BoQ item not found",
    lineNotFound: "BoQ line not found",
    unknownLine: "Unknown BoQ line",
    parentSectionNotFound: "Parent section not found",
    couldNotCreate: "Could not create the BoQ",
    baselinedLocked: "This BoQ is baselined. Quantities can no longer be edited.",
    baselinedWhileEditing: "This BoQ was baselined while it was being edited. Refresh and try again.",
    notEditableDraft: "This baseline is not an editable draft.",
    noSchedulableLines: "The BoQ has no schedulable lines.",
    codeUsedAtLevel: "Code {code} is already used at this level",
    weightsMustTotal:
      "Weights must total 100% before baselining — they currently total {total}%. Add priced items, or check any manually weighted lines.",
    scheduleRowsIncomplete: {
      one: "{count} schedule row must total 100% before activation.",
      other: "{count} schedule rows must total 100% before activation.",
    },
    changedWhileActivating:
      "The baseline changed while it was being activated. Review it and try again.",
  },
  schedule: {
    activeLocked: "This schedule is active and locked.",
    activatedWhileEditing:
      "This schedule was activated while it was being edited. Refresh and try again.",
    onlyPricedLines: "Only priced BoQ lines can be scheduled — sections roll up from theirs.",
    unknownPeriod: "Unknown reporting period",
    baselineNotThisProject: "Baseline does not belong to this project.",
    endBeforeStart: "End date is before the start date.",
    reportingBeforeProject: "Reporting cannot start before the project.",
    timingFixed: "Baseline timing is fixed after the first baseline is activated.",
    customCadenceRange: "A custom cadence needs a cycle of {min} to {max} days.",
    needsProjectDates: "Set the project's start and target completion dates first.",
    generatePeriodsFirst: "Generate the reporting periods first.",
    noPeriodsInDates: "No periods fall inside those dates.",
    progressBlocksRebuild:
      "Progress has already been recorded, so the reporting periods can no longer be rebuilt.",
    historyBlocksRebuild:
      "Historical records already use these periods, so they can no longer be rebuilt.",
    actionsBlockRebuild: "Actions already use these periods, so they can no longer be rebuilt.",
    activeScheduleBlocksRebuild:
      "The active schedule uses these periods, so they can no longer be rebuilt.",
    becameInUse: "The reporting periods became in use and can no longer be rebuilt.",
    windowNeedsBothEnds: "A planning window needs both a start and a finish period.",
    finishBeforeStart: "The finish period cannot come before the start period.",
    periodsRunFrom: "Periods run from {first} to {last}.",
    chooseLineToCopy: "Choose at least one line to copy the plan onto.",
    tooManyCellsSpread: {
      one: "That would write {count} planned cell at once. Apply the plan to fewer lines.",
      other: "That would write {count} planned cells at once. Apply the plan to fewer lines.",
    },
    tooManyCellsCopy: {
      one: "That would write {count} planned cell at once. Copy onto fewer lines.",
      other: "That would write {count} planned cells at once. Copy onto fewer lines.",
    },
  },
  progress: {
    periodNotFound: "Reporting period not found",
    needsBaseline: "Baseline the BoQ before recording progress against it.",
    needsSchedule: "Activate the schedule before recording progress against it.",
    onlyPricedLines: "Progress can only be recorded against priced lines of the active baseline.",
    reportNotEditable: "This report is {status} and can no longer be edited.",
    periodNotEditable: "This period is no longer editable. Refresh and try again.",
    periodChangedRefresh: "This period changed while you were viewing it. Refresh and try again.",
    invalidTransition: "A {from} report cannot become {to}.",
    missingLines: {
      one: "{count} line has neither a reading nor a “no progress” mark.",
      other: "{count} lines have neither a reading nor a “no progress” mark.",
    },
  },
  ticket: {
    notFound: "Action not found",
    noneFound: "No actions found",
    someNotFound: "One or more actions were not found",
    lineNotThisProject: "The BoQ item is not part of this project.",
    periodNotThisProject: "The reporting period is not part of this project.",
    closeWithResolution:
      "Close the action with a resolution instead of changing its status directly.",
    alreadyClosed: "This action is already closed.",
    changedRefresh: "This action changed while you were viewing it. Refresh and try again.",
    someChangedRefresh:
      "One or more actions changed while you were viewing them. Refresh and try again.",
  },
  note: {
    notFound: "Note not found",
    photoNotFound: "Photo not found",
    couldNotCreate: "Could not create the note",
  },
  support: {
    notFound: "Support request not found",
    changedRefresh: "The support request changed; refresh and try again",
    systemCannotSubmit: "System accounts cannot submit support requests",
    closeBeforeDelete: "Close this support request before deleting it",
    conversationClosed: "This conversation is closed",
    invalidTransition: "A {status} support request cannot be {action}.",
  },
  upload: {
    photoTooLarge: "Photo exceeds the 4 MB upload limit",
    workbookTooLarge: "The workbook exceeds the 4 MB upload limit",
    empty: "Empty upload",
    noWorkbook: "No workbook was attached.",
    notConfigured: "Temporary workbook uploads are not configured.",
    invalidRequest: "The upload request is invalid.",
    rateLimited: "Too many workbook {operation}. Try again in a few minutes.",
    aiAllowanceUsedUp: "This trial's AI import allowance is used up.",
    chooseWorksheet: "Choose a worksheet to analyze.",
    planUnreadable: "The confirmed import plan could not be read.",
    mappingUnreadable: "The column mapping could not be read.",
    notXlsx: "That file could not be read as an .xlsx workbook.",
    importFailed: "The workbook could not be imported.",
    unsupportedImageType: "Unsupported image type: {type}",
    unknownImageType: "unknown",
    projectCodeInUse: "That project code is already in use.",
  },
  /**
   * Words substituted into the frames above.
   *
   * They live here rather than inline because a status name plugged into a
   * sentence has to agree with the rest of it, and because `apps/web` already
   * shows the user these same words in its tables — a toast that calls a period
   * something the table beside it does not is worse than either name alone. The
   * Indonesian side of `periodStatus` and `supportStatus` is copied verbatim
   * from `apps/web/src/i18n/id.ts`; keep it that way.
   */
  enums: {
    periodStatus: {
      open: "open",
      draft: "draft",
      submitted: "submitted",
      reviewed: "reviewed",
      approved: "approved",
      locked: "locked",
      returned: "returned",
    },
    supportStatus: {
      new: "new",
      accepted: "accepted",
      answered: "answered",
      closed: "closed",
    },
    /**
     * Passive, because every frame using it reads "… cannot be {action}".
     * Indonesian has no way to plug an infinitive into that sentence, so the
     * frames were written passive on both sides rather than translated clause
     * by clause.
     */
    supportAction: {
      accept: "accepted",
      reply: "replied to",
      userReply: "replied to",
      close: "closed",
    },
    /** Passive, for the same reason. */
    adminAction: {
      demote: "demoted",
      disable: "disabled",
      delete: "deleted",
      trial: "put on a trial",
      resetPassword: "have their password reset",
    },
    workbookOperation: {
      uploads: "uploads",
      analyses: "analyses",
      updates: "updates",
      reviews: "reviews",
      imports: "imports",
    },
  },
} as const;

/**
 * Widens the literal types away, so `id.ts` has to repeat this file's *shape*
 * but not its English. Same mechanism as `Dictionary` in
 * `apps/web/src/i18n/en.ts`, and the reason a missing translation is a compile
 * error rather than a string that quietly ships in the wrong language.
 */
type Widen<T> = T extends string ? string : { readonly [K in keyof T]: Widen<T[K]> };

export type MessageDictionary = Widen<typeof en>;

/** The entities `assertNotArchived` can refuse on. */
export type ArchivedEntity = keyof MessageDictionary["archived"];
export type AdminAction = keyof MessageDictionary["enums"]["adminAction"];
export type SupportAction = keyof MessageDictionary["enums"]["supportAction"];
export type WorkbookOperation = keyof MessageDictionary["enums"]["workbookOperation"];
