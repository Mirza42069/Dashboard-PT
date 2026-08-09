"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Checkbox selection for a progressively loaded table.
 *
 * Selection is derived against the rows currently loaded. Loading another page
 * keeps existing selections, a background refetch keeps them, and rows removed
 * by a bulk action fall out on their own. A caller-provided reset key clears the
 * held ids when server filters change without wiping selection on every refetch.
 *
 * "Select all" therefore means all loaded rows, never the whole result set.
 */
export function useRowSelection<T extends { id: string }>(rows: T[], resetKey?: string) {
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setHeld(new Set());
  }, [resetKey]);

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
