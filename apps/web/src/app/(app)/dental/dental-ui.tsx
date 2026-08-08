"use client";

import { Badge } from "@DashboardV2/ui/components/badge";
import { cn } from "@DashboardV2/ui/lib/utils";

import { useT } from "@/i18n/provider";

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const PLAN_STATUSES = [
  "draft",
  "presented",
  "accepted",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const ITEM_STATUSES = [
  "planned",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "card", "bank_transfer", "insurance", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function dayRange(day: string) {
  return {
    from: new Date(`${day}T00:00:00.000Z`).toISOString(),
    to: new Date(`${day}T24:00:00.000Z`).toISOString(),
  };
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const t = useT();
  const labels: Record<AppointmentStatus, string> = {
    scheduled: t.dental.statusScheduled,
    confirmed: t.dental.statusConfirmed,
    checked_in: t.dental.statusCheckedIn,
    in_progress: t.dental.statusInProgress,
    completed: t.dental.statusCompleted,
    cancelled: t.dental.statusCancelled,
    no_show: t.dental.statusNoShow,
  };
  return (
    <Badge
      variant={status === "cancelled" || status === "no_show" ? "destructive" : "secondary"}
      className={cn(status === "completed" && "border-success/30 bg-success/10 text-success")}
    >
      {labels[status]}
    </Badge>
  );
}

export function planStatusLabel(status: PlanStatus, t: ReturnType<typeof useT>) {
  return {
    draft: t.dental.planDraft,
    presented: t.dental.planPresented,
    accepted: t.dental.planAccepted,
    in_progress: t.dental.statusInProgress,
    completed: t.dental.statusCompleted,
    cancelled: t.dental.planCancelled,
  }[status];
}

export function itemStatusLabel(status: ItemStatus, t: ReturnType<typeof useT>) {
  return {
    planned: t.dental.itemPlanned,
    scheduled: t.dental.itemScheduled,
    in_progress: t.dental.itemInProgress,
    completed: t.dental.itemCompleted,
    cancelled: t.dental.itemCancelled,
  }[status];
}
