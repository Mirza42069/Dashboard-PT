"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(any-pointer: coarse)";

function subscribe(onChange: () => void) {
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => {
    list.removeEventListener("change", onChange);
  };
}

/**
 * Whether any available pointer is coarse, including a hybrid laptop's screen.
 *
 * For controls that cannot mean the same thing on both: an icon that explains
 * itself on hover and navigates on click has no hover half on a tablet, so the
 * tap has to do the explaining instead. A media query and not a user-agent
 * sniff, and subscribed rather than read once, because a convertible laptop
 * changes its answer while the page is open.
 *
 * The server and the first client paint both answer `false`. That is the safe
 * guess to be wrong about: the fine-pointer branch is a plain link, which still
 * works under a finger, whereas a tap on the coarse branch's popup trigger
 * would do nothing at all until hydration corrected it.
 */
export function useCoarsePointer() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
