import type { SupportRequestStatus } from "@DashboardV2/db/schema";

export const SUPPORT_ACTIONS = ["accept", "reply", "userReply", "close"] as const;
export type SupportAction = (typeof SUPPORT_ACTIONS)[number];

export const SUPPORT_NOTICE_KINDS = [
  "support_accepted",
  "support_replied",
  "support_closed",
] as const;

/**
 * Partial on purpose: these notices are addressed to the requester, and
 * `userReply` is the requester speaking. Support learns about it from the status
 * flipping back to `accepted` in the inbox, which they are already watching and
 * can already filter on.
 */
const NOTICE_KIND_BY_ACTION: Partial<
  Record<SupportAction, (typeof SUPPORT_NOTICE_KINDS)[number]>
> = {
  accept: "support_accepted",
  reply: "support_replied",
  close: "support_closed",
};

/**
 * `accepted` and `answered` record who spoke last, not how far along the request
 * is: `accepted` is waiting on support, `answered` is waiting on the requester.
 * Support replying hands the thread over and the requester replying hands it
 * back, as often as the conversation needs.
 *
 * Either side may speak twice in a row — a follow-up thought should not have to
 * wait for a reply that is not coming — which is why `reply` is legal from
 * `answered` and `userReply` from `accepted`. Both land on the status that names
 * the speaker, so a run of messages from one side leaves the turn where it was.
 *
 * A requester may also add to a request nobody has picked up yet; that keeps it
 * `new`, because saying more is not the same as somebody triaging it.
 *
 * `close` is legal from both live states: a thread waiting on support is exactly
 * the one somebody wants to close when the answer turns out to be "nothing to
 * do", and allowing it only from `answered` would strand it.
 */
const TRANSITIONS: Record<SupportRequestStatus, Partial<Record<SupportAction, SupportRequestStatus>>> = {
  new: { accept: "accepted", userReply: "new" },
  accepted: { reply: "answered", userReply: "accepted", close: "closed" },
  answered: { reply: "answered", userReply: "accepted", close: "closed" },
  closed: {},
};

/** Returns the next state, or null when the action is not legal in this state. */
export function nextSupportStatus(
  current: SupportRequestStatus,
  action: SupportAction,
): SupportRequestStatus | null {
  return TRANSITIONS[current][action] ?? null;
}

/** Null when the action has no notice to send — see NOTICE_KIND_BY_ACTION. */
export function supportNoticeKindForAction(
  action: SupportAction,
): (typeof SUPPORT_NOTICE_KINDS)[number] | null {
  return NOTICE_KIND_BY_ACTION[action] ?? null;
}
