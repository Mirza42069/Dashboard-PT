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
import { Inbox, Plus, SearchX } from "@DashboardV2/ui/components/icons";

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
 * So the two cases are distinguished and each gets an exit. `filtered` is the
 * discriminator, and it matters that the caller computes it from the actual
 * filter state rather than guessing from a zero row count.
 */
export function TableEmptyState({
  filtered,
  title,
  description,
  onClearFilters,
  onCreate,
  createLabel,
}: {
  filtered: boolean;
  title: string;
  description: string;
  onClearFilters: () => void;
  /** Omitted for non-admins, who have no create permission to offer. */
  onCreate?: () => void;
  createLabel: string;
}) {
  const t = useT();

  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">{filtered ? <SearchX /> : <Inbox />}</EmptyMedia>
        {/* h2, not h3: the Card wrapping these tables has no CardHeader, so the
            page's h1 is the only heading above this and h3 would skip a level. */}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {filtered ? (
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            {t.common.clearFilters}
          </Button>
        ) : (
          onCreate && (
            <Button size="sm" onClick={onCreate}>
              <Plus />
              {createLabel}
            </Button>
          )
        )}
      </EmptyContent>
    </Empty>
  );
}
