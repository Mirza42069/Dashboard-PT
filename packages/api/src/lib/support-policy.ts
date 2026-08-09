import type { SupportRequestStatus } from "@DashboardV2/db/schema";

export const SUPPORT_ACTIONS = ["accept", "reply", "close"] as const;
export type SupportAction = (typeof SUPPORT_ACTIONS)[number];

export const SUPPORT_NOTICE_KINDS = [
  "support_accepted",
  "support_replied",
  "support_closed",
] as const;

const NOTICE_KIND_BY_ACTION: Record<SupportAction, (typeof SUPPORT_NOTICE_KINDS)[number]> = {
  accept: "support_accepted",
  reply: "support_replied",
  close: "support_closed",
};

const TRANSITIONS: Record<SupportRequestStatus, Partial<Record<SupportAction, SupportRequestStatus>>> = {
  new: { accept: "accepted" },
  accepted: { reply: "answered" },
  answered: { close: "closed" },
  closed: {},
};

/** Returns the next state, or null when the action is not legal in this state. */
export function nextSupportStatus(
  current: SupportRequestStatus,
  action: SupportAction,
): SupportRequestStatus | null {
  return TRANSITIONS[current][action] ?? null;
}

export function supportNoticeKindForAction(
  action: SupportAction,
): (typeof SUPPORT_NOTICE_KINDS)[number] {
  return NOTICE_KIND_BY_ACTION[action];
}
