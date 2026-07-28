"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Checkbox selection for a paginated table.
 *
 * Selection is pruned against the rows currently on screen rather than cleared
 * on change. That single choice gives the right behaviour in all three cases
 * that matter: paging or filtering drops the selection (none of the new ids
 * match), a background refetch after invalidateQueries keeps it, and rows
 * removed by a bulk action fall out on their own. Clearing in an effect keyed on
 * `rows` would instead wipe the selection on every refetch, because React Query
 * hands back a new array identity each time.
 *
 * "Select all" therefore means the current page, never the whole result set.
 */
export function useRowSelection<T extends { id: string }>(rows: T[]) {
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());

  const visibleIds = useMemo(() => rows.map((row) => row.id), [rows]);

  const selectedIds = useMemo(
    () => visibleIds.filter((id) => held.has(id)),
    [visibleIds, held],
  );

  const selectedCount = selectedIds.length;
  const allSelected = visibleIds.length > 0 && selectedCount === visibleIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const isSelected = useCallback((id: string) => held.has(id), [held]);

  const toggle = useCallback((id: string) => {
    setHeld((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setHeld(new Set()), []);

  const toggleAll = useCallback(() => {
    setHeld((current) => {
      const everyVisibleSelected =
        visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of visibleIds) {
        if (everyVisibleSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [visibleIds]);

  return { selectedIds, selectedCount, isSelected, toggle, toggleAll, clear, allSelected, someSelected };
}
