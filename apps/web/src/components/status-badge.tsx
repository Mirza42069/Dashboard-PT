"use client";

import { Badge } from "@DashboardV2/ui/components/badge";
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  Hammer,
  OctagonX,
  PauseCircle,
} from "lucide-react";

import type { Dictionary } from "@/i18n";
import { useT } from "@/i18n/provider";

/**
 * Status is never communicated by colour alone: every badge carries an icon and
 * a written label (localized). That is what makes these readable to colourblind
 * users, in print, and under forced-colours mode.
 *
 * These deliberately do NOT use --chart-1..5. That ramp is a single blue hue at
 * five lightnesses — it encodes magnitude, so painting statuses with it would
 * imply an ordering that doesn't exist.
 */
type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost";

type Descriptor = { variant: BadgeVariant; icon: typeof CircleDot };

const STYLES: Record<string, Record<string, Descriptor>> = {
  project: {
    planning: { variant: "outline", icon: CircleDashed },
    active: { variant: "default", icon: Hammer },
    on_hold: { variant: "secondary", icon: PauseCircle },
    completed: { variant: "ghost", icon: CircleCheck },
    cancelled: { variant: "destructive", icon: OctagonX },
  },
  ticket: {
    open: { variant: "outline", icon: CircleDot },
    in_progress: { variant: "default", icon: CircleDot },
    resolved: { variant: "secondary", icon: CircleCheck },
    closed: { variant: "ghost", icon: CircleSlash },
  },
};

type Kind = keyof Dictionary["status"];

/** Localized label for a status value — usable anywhere the dict is in scope. */
export function statusLabel(dict: Dictionary, kind: Kind, value: string): string {
  const labels = dict.status[kind] as Record<string, string>;
  return labels[value] ?? value;
}

export function StatusBadge({ kind, value }: { kind: Kind; value: string | null | undefined }) {
  const t = useT();
  const descriptor = value ? STYLES[kind]?.[value] : undefined;

  if (!value || !descriptor) {
    return <Badge variant="outline">{value ?? "—"}</Badge>;
  }

  const Icon = descriptor.icon;
  return (
    <Badge variant={descriptor.variant}>
      <Icon />
      {statusLabel(t, kind, value)}
    </Badge>
  );
}

/** Convenience hook where only the label text is needed. */
export function useStatusLabel() {
  const t = useT();
  return (kind: Kind, value: string) => statusLabel(t, kind, value);
}
