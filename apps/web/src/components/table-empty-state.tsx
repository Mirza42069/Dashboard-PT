"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@DashboardV2/ui/components/empty";
import { Inbox, SearchX } from "@DashboardV2/ui/components/icons";
import type { ReactNode } from "react";

import { useT } from "@/i18n/provider";

/**
 * The "nothing here" row for a paginated table.
 *
 * Every list in the product used to render a single line of grey text — "No
 * projects yet" — centred in a table cell. It says what is true and then stops,
 * which leaves the two people who see it with nothing to do: someone on a fresh
 * account does not learn what a project is for or how to make one, and someone
 * who has filtered everything away is not told that filters are why, nor given
 * a way back.
 *
 * The two cases stay distinct: filtered results get a clear-filters exit,
 * while the unfiltered state relies on the list toolbar's create action.
 * `filtered` must come from the actual filter state, not the zero row count.
 *
 * The unfiltered glyph is overridable because a page whose own identity icon is
 * the default one would otherwise show the same glyph twice on screen — the
 * archive is the case that forced it, since its nav entry and this empty state
 * both used to be an Inbox.
 */
export function TableEmptyState({
  filtered,
  title,
  description,
  onClearFilters,
  icon,
}: {
  filtered: boolean;
  title: string;
  description: string;
  onClearFilters: () => void;
  /** Replaces the default Inbox in the unfiltered state only. */
  icon?: ReactNode;
}) {
  const t = useT();

  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">{filtered ? <SearchX /> : (icon ?? <Inbox />)}</EmptyMedia>
        {/* h2, not h3: the Card wrapping these tables has no CardHeader, so the
            page's h1 is the only heading above this and h3 would skip a level. */}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {filtered && (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            {t.common.clearFilters}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
