"use client";

import * as React from "react";

import { Button } from "@DashboardV2/ui/components/button";
import { Calendar, type CalendarLabels } from "@DashboardV2/ui/components/calendar";
import { CalendarRange } from "@DashboardV2/ui/components/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@DashboardV2/ui/components/popover";
import { clampToRange, todayISO, type ISODate } from "@DashboardV2/ui/lib/calendar-date";
import { cn } from "@DashboardV2/ui/lib/utils";

/**
 * A `date` column's control: a button showing the chosen day, and a Calendar in
 * a popover.
 *
 * It deliberately looks like an `Input` rather than a `Button` — same height,
 * same border, same focus ring, and the same `aria-invalid` treatment — because
 * it sits in a grid beside real inputs and a button-shaped field breaks the row.
 *
 * `id`, `aria-invalid` and `aria-describedby` are forwarded to the trigger, so
 * spreading `fieldError(...).control` over it wires up validation exactly as it
 * does for an Input, and `<Label htmlFor>` keeps working.
 *
 * Empty is a real state: a project may have no target completion yet, so
 * "Clear" is always available and `onValueChange` reports `null` for it.
 */

export type DatePickerLabels = CalendarLabels & {
  today: string;
  clear: string;
  placeholder: string;
};

const DEFAULT_LABELS: DatePickerLabels = {
  previousMonth: "Previous month",
  nextMonth: "Next month",
  today: "Today",
  clear: "Clear",
  placeholder: "Pick a date",
};

export function DatePicker({
  value,
  onValueChange,
  min,
  max,
  locale = "en-US",
  formatValue,
  labels,
  disabled = false,
  className,
  id,
  name,
  onBlur,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  value: ISODate | null;
  onValueChange: (value: ISODate | null) => void;
  min?: ISODate | null;
  max?: ISODate | null;
  locale?: string;
  /** How the chosen day reads on the trigger. Callers pass `useFormat().formatDate`. */
  formatValue?: (value: ISODate) => string;
  labels?: Partial<DatePickerLabels>;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  onBlur?: () => void;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const text = { ...DEFAULT_LABELS, ...labels };

  function commit(next: ISODate | null) {
    onValueChange(next);
    setOpen(false);
    // The form library learns the field was touched from a blur it would
    // otherwise never see — the popup, not the trigger, took the interaction.
    onBlur?.();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            // Matched to input.tsx: 16px on phones so iOS Safari does not zoom
            // the page on focus, the product's 12px density from md up.
            className={cn(
              "h-9 w-full justify-between px-2.5 text-base font-normal md:h-8 md:text-xs",
              "aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
              !value && "text-muted-foreground",
              className,
            )}
          />
        }
        id={id}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      >
        <span className="truncate">
          {value ? (formatValue?.(value) ?? value) : text.placeholder}
        </span>
        <CalendarRange className="shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      {/* Hidden input so the value is part of the form's own submission and
          shows up in browser autofill/restore like any other field. */}
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <PopoverContent side="bottom" align="start" className="w-fit max-w-none p-2">
        <Calendar
          value={value}
          onValueChange={commit}
          min={min}
          max={max}
          locale={locale}
          labels={text}
          autoFocus
        />
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            // Clamped, so "Today" never hands back a day the field would reject.
            onClick={() => commit(clampToRange(todayISO(), min, max))}
          >
            {text.today}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!value}
            onClick={() => commit(null)}
          >
            {text.clear}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
