"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Checkbox } from "@DashboardV2/ui/components/checkbox";
import { TableCell, TableHead } from "@DashboardV2/ui/components/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@DashboardV2/ui/components/tooltip";
import { cn } from "@DashboardV2/ui/lib/utils";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import type { RowSelection } from "@/lib/use-row-selection";

/**
 * The checkbox column and its toolbar, in one place.
 *
 * Every table that offers selection was otherwise going to restate the same
 * three things — a header checkbox that knows about the indeterminate state, a
 * row checkbox with a name in its label, and the `data-state` attribute that
 * actually tints the selected row. The third is the one people forget, which is
 * why it is a function here rather than a convention.
 *
 * The actions stay with the table. What a selection of tickets can do has
 * nothing in common with what a selection of BoQ lines can do; only the
 * furniture around them is shared.
 */

/** The header cell: select-all, with the indeterminate state wired up. */
export function SelectAllHead({
  selection,
  label,
  className,
}: {
  selection: RowSelection;
  /** Overrides the generic "select all loaded rows". */
  label?: string;
  className?: string;
}) {
  const t = useT();

  return (
    <TableHead className={cn("w-10 pl-4", className)}>
      <Checkbox
        aria-label={label ?? t.common.selectAll}
        checked={selection.allSelected}
        indeterminate={selection.someSelected}
        onCheckedChange={selection.toggleAll}
      />
    </TableHead>
  );
}

/** One row's checkbox. `name` is what the label names, so it is worth passing. */
export function SelectRowCell({
  selection,
  id,
  name,
  className,
}: {
  selection: RowSelection;
  id: string;
  name: string;
  className?: string;
}) {
  const t = useT();

  return (
    <TableCell className={cn("pl-4", className)}>
      <Checkbox
        aria-label={interpolate(t.common.selectRow, { name })}
        checked={selection.isSelected(id)}
        disabled={!selection.canSelect(id)}
        onCheckedChange={() => selection.toggle(id)}
      />
    </TableCell>
  );
}

/**
 * Spread onto the row's `TableRow`.
 *
 * `data-[state=selected]:bg-muted` already lives in the Table primitive; this
 * is what turns it on. Easy to leave out, and the omission is invisible until
 * someone scrolls a long selection and cannot tell what they ticked.
 */
export function selectionRowProps(selection: RowSelection, id: string) {
  return { "data-state": selection.isSelected(id) ? "selected" : undefined } as const;
}

/**
 * One icon button in a bulk toolbar.
 *
 * A tooltip *and* an aria-label, because the icon alone names nothing: the
 * label is what a screen reader reads and what the tooltip shows, so the two
 * cannot drift apart.
 */
export function ToolbarAction({
  icon,
  label,
  variant = "outline",
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
