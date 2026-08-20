import { isBehindDeviation } from "@DashboardV2/api/lib/deviation";
import {
  CalendarRange,
  CircleAlert,
  CircleDashed,
  Clock,
  Eye,
  Scale,
  TriangleAlert,
  type IconProps,
} from "@DashboardV2/ui/components/icons";

/**
 * How urgent something is, in three steps.
 *
 * This module decides *which* level a row is at, and nothing about how that
 * level is drawn — each component keeps its own table for that (`FILL` in
 * tick-bar, `TONE`/`CHIP` in filter-cards, `EDGE`/`SIGNAL_TONE` in
 * attention-list), because a fill, a chip tint and a 2px edge want different
 * values of the same idea. What must not be decided twice is the level itself,
 * so it lives here alone, like permissions.ts and deviation.ts: one place
 * decides, and it can be tested without rendering anything.
 *
 * Three steps and not five. The question a portfolio screen answers is "where
 * do I look first", and a scale finer than late / waiting / settled stops
 * answering it — two shades of amber are two things to compare rather than one
 * thing to notice.
 */
export const SEVERITY_LEVELS = ["late", "waiting", "settled"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

/** Every problem a project row can carry, in the order they are shown. */
export const SIGNAL_IDS = [
  "behind",
  "reportsDue",
  "stale",
  "unreported",
  "awaitingReview",
  "baselineMissing",
  "openActions",
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];

export type Signal = {
  id: SignalId;
  level: SeverityLevel;
  Icon: (props: IconProps) => React.ReactNode;
  /** Shown beside the icon when the signal counts something. */
  count?: number;
};

/**
 * The shape a row must provide. Structural rather than the imported
 * ProjectException, so this module stays free of server types and the tests can
 * build a row by hand.
 */
export type SeverityInput = {
  deviation: number | null;
  previousDeviation: number | null;
  reportsDue: number;
  reportsAwaitingReview: number;
  openTickets: number;
  reasons: {
    behind: boolean;
    baselineMissing: boolean;
    unreported: boolean;
    stale: boolean;
    reportsDue: boolean;
    awaitingReview: boolean;
    openActions: boolean;
  };
};

const SIGNAL_LEVEL: Record<SignalId, SeverityLevel> = {
  behind: "late",
  reportsDue: "waiting",
  stale: "waiting",
  unreported: "waiting",
  awaitingReview: "waiting",
  baselineMissing: "waiting",
  // Open actions are ordinary work, not a problem with the project — they earn
  // a row on the list but never colour it.
  openActions: "settled",
};

const SIGNAL_ICON: Record<SignalId, (props: IconProps) => React.ReactNode> = {
  behind: TriangleAlert,
  reportsDue: CalendarRange,
  stale: Clock,
  unreported: CircleDashed,
  awaitingReview: Eye,
  baselineMissing: Scale,
  openActions: CircleAlert,
};

/** What each signal counts, where counting it means anything. */
function signalCount(id: SignalId, row: SeverityInput): number | undefined {
  if (id === "reportsDue") return row.reportsDue;
  if (id === "awaitingReview") return row.reportsAwaitingReview;
  if (id === "openActions") return row.openTickets;
  return undefined;
}

/** The signals a row carries, worst first. */
export function signalsFor(row: SeverityInput): Signal[] {
  return SIGNAL_IDS.filter((id) => row.reasons[id]).map(
    (id) => ({
      id,
      level: SIGNAL_LEVEL[id],
      Icon: SIGNAL_ICON[id],
      count: signalCount(id, row),
    }),
  );
}

/**
 * The worst level among a row's signals — what its edge is painted.
 *
 * A row with nothing but open actions is `settled`: it is on the list because
 * there is work outstanding, not because anything is wrong, and colouring it
 * would spend the one channel that matters on the least urgent thing there.
 */
export function levelFor(row: SeverityInput): SeverityLevel {
  const signals = signalsFor(row);
  if (signals.some((signal) => signal.level === "late")) return "late";
  if (signals.some((signal) => signal.level === "waiting")) return "waiting";
  return "settled";
}

/**
 * Whether the count of behind projects moved since the previous reported period.
 *
 * The only genuine trend on this page. Every other figure would need a
 * historical portfolio snapshot, which nothing stores — but each row already
 * carries its own previous-period deviation, so counting both sides of the same
 * list is a real comparison rather than an invented one.
 *
 * Rows whose previous deviation is unknown are excluded from *both* counts, so
 * a project reporting for the first time cannot read as an improvement.
 */
export function behindDelta(rows: SeverityInput[]): number | null {
  const comparable = rows.filter(
    (row) => row.deviation !== null && row.previousDeviation !== null,
  );
  if (comparable.length === 0) return null;
  const now = comparable.filter((row) => isBehindDeviation(row.deviation)).length;
  const before = comparable.filter((row) => isBehindDeviation(row.previousDeviation)).length;
  return now - before;
}
