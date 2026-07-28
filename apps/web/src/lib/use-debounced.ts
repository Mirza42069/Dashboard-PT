"use client";

import { useEffect, useState } from "react";

/**
 * Trailing-edge debounce, for a value that feeds a React Query key.
 *
 * A search box is controlled state and the value is part of the query key, so
 * without this every keystroke is a separate request — and on a list endpoint
 * that fans out into several SQL statements, one per keystroke is expensive.
 * Keep the input itself bound to the raw state so typing stays responsive; pass
 * only the debounced value to the query.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
