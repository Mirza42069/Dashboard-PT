"use client";

import { useT } from "@/i18n/provider";

/**
 * First focusable element on every authenticated page, hidden until focused.
 *
 * The chrome ahead of the content is a sidebar of up to six links plus the
 * topbar — every keyboard user crossed all of it on every navigation before
 * reaching anything they came for.
 *
 * Not `sr-only`: this one has to become visible when focused, or sighted
 * keyboard users get a focus ring on nothing. It sits above the header's z-index
 * so it is not clipped by the sticky chrome.
 */
export default function SkipLink() {
  const t = useT();

  return (
    <a
      href="#main"
      className="sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-[100] focus-visible:not-sr-only focus-visible:rounded-md focus-visible:bg-popover focus-visible:px-3 focus-visible:py-2 focus-visible:text-xs focus-visible:font-medium focus-visible:text-popover-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t.nav.skipToContent}
    </a>
  );
}
