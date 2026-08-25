"use client";

import type { RefObject } from "react";

import { Button } from "@DashboardV2/ui/components/button";
import { ChevronLeft, ChevronRight } from "@DashboardV2/ui/components/icons";

import { useT } from "@/i18n/provider";
import type { ScrollEdges } from "@/lib/matrix-window";

/**
 * The "there is more this way" cue for the entry grids, and the control that
 * acts on it.
 *
 * The grids draw every period at full width, so on any project longer than the
 * card is wide there are columns off the right-hand side and nothing on screen
 * would otherwise say so. Folding a month (the chevrons on the band row) is the
 * way to shorten the grid; this is the way to reach what is still off it.
 *
 * `table-scroll-shadows` is what every other table uses for this, and it is not
 * enough here: it paints on the container's *background*, under a grid whose
 * leading columns are opaque `bg-card` and whose cells are full of figures, so
 * a 14px 0.12-alpha gradient never surfaces. The grids pass
 * `scrollShadows={false}` and render this instead.
 *
 * Rendered as a sibling of the table, never inside the scroll container — a
 * cue that scrolls away with the content it is pointing at is not a cue.
 */
export function MatrixScrollAffordance({
  scrollRef,
  edges,
  gutter,
  leadingWidth,
  controls,
}: {
  /** The same container ref the grid handed `useMatrixWindow`. */
  scrollRef: RefObject<HTMLDivElement | null>;
  edges: ScrollEdges;
  /**
   * The container's own scrollbars, from `useMatrixWindow`.
   *
   * This component is positioned against a wrapper the size of the container's
   * *border* box, which includes them. Inset by this and the cues sit on the
   * content the reader is actually looking at; without it the right-hand fade
   * and page button are painted over the vertical scrollbar and both fades
   * cover the horizontal one — which is not a cue, it is a broken scrollbar.
   */
  gutter: { right: number; bottom: number };
  /**
   * Width of the sticky leading columns, in pixels.
   *
   * The left fade starts here rather than at the container edge. Those columns
   * are `sticky left-0` with a `bg-card` of their own and hide nothing, so a
   * fade over them would be pointing at content that is already on screen.
   */
  leadingWidth: number;
  /** `id` of the table these buttons scroll, for `aria-controls`. */
  controls: string;
}) {
  const t = useT();

  /**
   * Just under a full viewport, so the column you were reading at the edge is
   * still on screen after the jump. The floor is for a very narrow container,
   * where 80% of nothing much would not move at all.
   *
   * Respect reduced motion even though this movement is interaction-triggered:
   * a near-viewport jump is large enough to be disorienting.
   */
  function page(direction: 1 | -1) {
    const element = scrollRef.current;
    if (!element) return;

    element.scrollBy({
      left: direction * Math.max(120, element.clientWidth * 0.8),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  return (
    <>
      {/* Both fades stay mounted and cross-fade, so reaching an end is a settle
          rather than a flicker. aria-hidden: the buttons beside them are what
          carries this to a screen reader. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute top-0 z-20 w-10 bg-gradient-to-r from-card to-transparent transition-opacity ${
          edges.canScrollLeft ? "opacity-100" : "opacity-0"
        }`}
        style={{ left: leadingWidth, bottom: gutter.bottom }}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute top-0 z-20 w-10 bg-gradient-to-l from-card to-transparent transition-opacity ${
          edges.canScrollRight ? "opacity-100" : "opacity-0"
        }`}
        style={{ right: gutter.right, bottom: gutter.bottom }}
      />

      {/* Conditionally rendered rather than disabled: a control that cannot do
          anything should leave the tab order, not sit in it greyed out.

          z-30 clears the sticky header and leading columns, which are z-10. */}
      {edges.canScrollLeft && (
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t.common.scrollLeft}
          aria-controls={controls}
          // Centred on the visible area rather than on the border box, which is
          // taller than it by the horizontal scrollbar.
          className="absolute top-1/2 z-30 -translate-y-1/2 rounded-full bg-card shadow-md"
          style={{ left: leadingWidth + 8, marginTop: -gutter.bottom / 2 }}
          onClick={() => page(-1)}
        >
          <ChevronLeft />
        </Button>
      )}
      {edges.canScrollRight && (
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t.common.scrollRight}
          aria-controls={controls}
          className="absolute top-1/2 z-30 -translate-y-1/2 rounded-full bg-card shadow-md"
          style={{ right: gutter.right + 8, marginTop: -gutter.bottom / 2 }}
          onClick={() => page(1)}
        >
          <ChevronRight />
        </Button>
      )}
    </>
  );
}
