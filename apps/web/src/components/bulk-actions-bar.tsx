"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { X } from "@DashboardV2/ui/components/icons";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";

/**
 * Toolbar for whatever is currently ticked in a table.
 *
 * Renders nothing at zero, so callers can mount it unconditionally and let the
 * bar appear as soon as something is selected. The entity-specific actions come
 * in as children — the count, the clear button and the layout are the only
 * parts worth sharing across tables.
 */
export function BulkActionsBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children?: React.ReactNode;
}) {
  const t = useT();

  if (count === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={t.common.bulkActions}
      // Sticky: a selection stays live while you scroll a full page of rows, so
      // a bar that scrolls away leaves the user holding a selection with no
      // visible way to act on it. Opaque background, or rows show through it.
      className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm"
    >
      <span className="font-medium">{interpolate(t.common.selected, { count })}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X />
          {t.common.clearSelection}
        </Button>
      </div>
    </div>
  );
}
