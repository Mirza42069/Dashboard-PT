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
export function useRowSelection<T>(
  rows: readonly T[],
  {
    getId,
    resetKey,
    maxSelected = Number.POSITIVE_INFINITY,
  }: {
    /**
     * How to identify a row.
     *
     * A callback rather than a `T extends { id: string }` bound, because half
     * the tables that need selection do not have the id at the top level: the
     * schedule and progress grids are rows of `{ section, leaf }` keyed on
     * `leaf.id`, and the period summary is keyed on `period.id`. Requiring a
     * pre-mapped array instead would mean rebuilding it on every render.
     */
    getId: (row: T) => string;
    resetKey?: string;
    maxSelected?: number;
  },
) {
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setHeld(new Set());
  }, [resetKey]);

  const visibleIds = useMemo(() => rows.map(getId), [rows, getId]);

  const selectedIds = useMemo(
    () => visibleIds.filter((id) => held.has(id)),
    [visibleIds, held],
  );

  const selectedCount = selectedIds.length;
  const allSelected =
    visibleIds.length > 0 && visibleIds.length <= maxSelected && selectedCount === visibleIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const isSelected = useCallback((id: string) => held.has(id), [held]);

  const toggle = useCallback((id: string) => {
    setHeld((current) => {
      const next = new Set(current);
      if (!next.delete(id) && next.size < maxSelected) next.add(id);
      return next;
    });
  }, [maxSelected]);

  const clear = useCallback(() => setHeld(new Set()), []);

  useEffect(() => {
    const visible = new Set(visibleIds);
    setHeld((current) => {
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleIds]);

  const toggleAll = useCallback(() => {
    setHeld((current) => {
      const selectedVisible = visibleIds.filter((id) => current.has(id)).length;
      const everySelectableSelected =
        visibleIds.length > 0 && selectedVisible === Math.min(visibleIds.length, maxSelected);
      const next = new Set(current);
      for (const id of visibleIds) {
        if (everySelectableSelected) next.delete(id);
        else if (next.size < maxSelected) next.add(id);
      }
      return next;
    });
  }, [visibleIds, maxSelected]);

  const canSelect = useCallback(
    (id: string) => held.has(id) || held.size < maxSelected,
    [held, maxSelected],
  );

  /**
   * The selected rows themselves, in visible order.
   *
   * Every caller was deriving this by filtering the row array again. It is what
   * a bulk action actually needs — the labels for the confirmation, the
   * statuses that decide whether an action is allowed at all.
   */
  const selectedRows = useMemo(
    () => rows.filter((row) => held.has(getId(row))),
    [rows, held, getId],
  );

  return {
    selectedIds,
    selectedRows,
    selectedCount,
    isSelected,
    canSelect,
    toggle,
    toggleAll,
    clear,
    allSelected,
    someSelected,
  };
}

/**
 * The parts of the hook's return value the shared checkbox components need.
 *
 * Narrower than the whole thing on purpose: it keeps `SelectAllHead` and
 * `SelectRowCell` usable from a table whose rows are of any shape, without
 * dragging the row type through them.
 */
export type RowSelection = {
  selectedCount: number;
  isSelected: (id: string) => boolean;
  canSelect: (id: string) => boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
  clear: () => void;
  allSelected: boolean;
  someSelected: boolean;
};
