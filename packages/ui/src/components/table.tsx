"use client"

import * as React from "react"

import { cn } from "@DashboardV2/ui/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      // table-scroll-shadows (globals.css) fades in a shadow on whichever side
      // still has hidden columns — the affordance a bare overflow-x-auto never
      // gives on a narrow screen.
      className="relative w-full overflow-x-auto table-scroll-shadows"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        // No hover highlight. Rows carried one, and it was more trouble than
        // affordance: the scroll container paints table-scroll-shadows — two
        // card-coloured gradients masking the drop shadows over the leftmost and
        // rightmost 2.5rem — so a row tint sat on top of them and read as a
        // patch with a hard edge rather than a clean band. Nothing in these
        // tables needs a row-wide hover anyway; the cells that do something
        // (the link, the edit button, the checkbox) have their own hover state.
        //
        // The two remaining backgrounds are state, not decoration, and both are
        // deliberately opaque so they never blend with those gradients:
        // `selected` for a checked row, an open *menu* for a row holding one.
        //
        // Scoped to aria-haspopup=menu rather than any aria-expanded on purpose.
        // A bare `has-aria-expanded` also caught hover-opened popovers — the
        // delete-blocked marker in the companies table, say — so pointing at an
        // "i" marker tinted the whole row, which is exactly the row-wide hover
        // this component gave up above.
        //
        // oklab, not oklch: Chrome interpolates hue badly when mixing these
        // near-neutral light tokens, and `in oklch` came out a visible pink
        // (rgb(250,242,244) against a card of rgb(249,252,255)) instead of the
        // grey a card→muted mix should be. oklab has no hue channel to get
        // wrong and renders the intended neutral in both themes.
        "border-b transition-colors has-[[aria-haspopup=menu][aria-expanded=true]]:bg-[color-mix(in_oklab,var(--card),var(--muted)_50%)] data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        // Cells wrap by default, and `whitespace-nowrap` is opt-in per column.
        // This used to be the other way round, which quietly set a floor under
        // the whole layout: under `table-layout: auto` a table can never lay out
        // narrower than its min-content width, and if no cell may wrap then that
        // width is the sum of every column's longest value — a constant, however
        // narrow the screen. `w-full` loses to it, so the container's
        // overflow-x-auto engaged and the table scrolled sideways the moment the
        // sidebar expanded. Wrapping drops min-content to roughly the longest
        // single word, so the table gives way instead.
        //
        // Opt back in on any column whose value must stay on one line — dates,
        // money, counts — and prefer `break-words` over nowrap for long
        // unbreakable strings like email addresses, which wrapping alone cannot
        // help. Badge and Button already carry their own nowrap, so chips and
        // action buttons need nothing here.
        //
        // TableHead deliberately keeps its nowrap: header labels are short, and
        // a two-line header inside a fixed h-10 row overflows it.
        "p-2 align-middle [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
