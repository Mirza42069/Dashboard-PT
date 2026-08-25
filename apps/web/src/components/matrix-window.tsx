"use client";

import type { UIEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { HEADER_RULE, MonthBandCell } from "@/components/month-band-row";
import type { PeriodHeaderModel, PeriodLike } from "@/lib/period-header";
import {
  getFullMatrixWindow,
  getMatrixWindow,
  getVariableAnchor,
  getVariableItemOffset,
  scrollEdges,
  type MatrixWindow,
  type ScrollEdges,
} from "@/lib/matrix-window";

export const MATRIX_ROW_LIMIT = 24;
export const MATRIX_COLUMN_LIMIT = 24;

type UseMatrixWindowOptions = {
  rowCount: number;
  columnCount: number;
  estimatedRowHeight: number;
  columnWidth: number;
  estimatedHeaderHeight: number;
  leadingWidth: number;
  stickyLeadingWidth: number;
  windowed: boolean;
  /**
   * Whether columns are virtualised as well as rows. On by default.
   *
   * A grid that fits itself to its container must turn this off, and turning it
   * off is not optional there: column windowing reads `scrollLeft`, which on a
   * grid that cannot scroll sideways is permanently 0, so the window would pin
   * itself to the first `MATRIX_COLUMN_LIMIT` columns and silently drop every
   * column past them. Rows keep virtualising either way — a BoQ runs to
   * hundreds of lines and the container still scrolls vertically.
   */
  windowColumns?: boolean;
  /**
   * Whether rows are virtualised as well as columns. On by default.
   *
   * The mirror of `windowColumns`, and turning it off carries the same
   * obligation: row windowing reads `scrollTop`, which on a grid whose
   * container does not scroll vertically is permanently 0, so `rowLimit` would
   * pin the window to the first `MATRIX_ROW_LIMIT` rows and silently drop every
   * line past them. A grid that has given up its own vertical scrollbar and
   * grows to full height inside the page must set this false.
   *
   * Columns keep virtualising either way — the container still scrolls
   * sideways, so `scrollLeft` is still real.
   */
  windowRows?: boolean;
};

const DEFAULT_VIEWPORT_HEIGHT = 576;
const DEFAULT_VIEWPORT_WIDTH = 1280;

function sameWindow(left: MatrixWindow, right: MatrixWindow) {
  return (
    left.rows.start === right.rows.start &&
    left.rows.end === right.rows.end &&
    left.rows.beforeSize === right.rows.beforeSize &&
    left.rows.afterSize === right.rows.afterSize &&
    left.columns.start === right.columns.start &&
    left.columns.end === right.columns.end &&
    left.columns.beforeSize === right.columns.beforeSize &&
    left.columns.afterSize === right.columns.afterSize
  );
}

function calculateWindow(
  options: UseMatrixWindowOptions,
  rowSizes: ReadonlyMap<number, number>,
  measuredHeaderHeight: number,
  element?: HTMLDivElement | null,
  scrollTopAdjustment = 0,
) {
  if (!options.windowed) {
    return getFullMatrixWindow(options.rowCount, options.columnCount);
  }

  if (options.windowColumns === false) {
    const full = getFullMatrixWindow(options.rowCount, options.columnCount);
    return {
      rows: calculateRowWindow(options, rowSizes, measuredHeaderHeight, element, scrollTopAdjustment),
      columns: full.columns,
    };
  }

  if (options.windowRows === false) {
    const full = getFullMatrixWindow(options.rowCount, options.columnCount);
    return {
      rows: full.rows,
      columns: calculateFullWindow(
        options,
        rowSizes,
        measuredHeaderHeight,
        element,
        scrollTopAdjustment,
      ).columns,
    };
  }

  return calculateFullWindow(options, rowSizes, measuredHeaderHeight, element, scrollTopAdjustment);
}

function calculateRowWindow(
  options: UseMatrixWindowOptions,
  rowSizes: ReadonlyMap<number, number>,
  measuredHeaderHeight: number,
  element?: HTMLDivElement | null,
  scrollTopAdjustment = 0,
) {
  return calculateFullWindow(options, rowSizes, measuredHeaderHeight, element, scrollTopAdjustment)
    .rows;
}

function calculateFullWindow(
  options: UseMatrixWindowOptions,
  rowSizes: ReadonlyMap<number, number>,
  measuredHeaderHeight: number,
  element?: HTMLDivElement | null,
  scrollTopAdjustment = 0,
) {
  return getMatrixWindow({
    ...options,
    rowHeight: options.estimatedRowHeight,
    headerHeight: measuredHeaderHeight,
    rowSizes,
    scrollTop: (element?.scrollTop ?? 0) + scrollTopAdjustment,
    scrollLeft: element?.scrollLeft ?? 0,
    viewportHeight: element?.clientHeight ?? DEFAULT_VIEWPORT_HEIGHT,
    viewportWidth: element?.clientWidth ?? DEFAULT_VIEWPORT_WIDTH,
    rowOverscan: 4,
    columnOverscan: 2,
    rowLimit: MATRIX_ROW_LIMIT,
    columnLimit: MATRIX_COLUMN_LIMIT,
  });
}

export function useMatrixWindow(options: UseMatrixWindowOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowSizesRef = useRef<Map<number, number>>(new Map());
  const headerHeightRef = useRef(options.estimatedHeaderHeight);
  const pendingScrollAdjustmentRef = useRef(0);

  /**
   * The container's inner width, for callers that size themselves to it.
   *
   * Measured here rather than from a second ResizeObserver of the caller's
   * own: this hook already observes exactly the element they would have to
   * watch, and two observers on one node is two chances to disagree.
   *
   * Zero until the first measurement. Callers must treat that as "not measured
   * yet" and not as "no room" — a fitter that believed it would fold every
   * month for one frame and then unfold them.
   */
  const [containerWidth, setContainerWidth] = useState(0);

  /**
   * Whether the container still hides columns off either side.
   *
   * Measured here rather than by a scroll listener of the affordance's own, for
   * the same reason `containerWidth` is: `update` already runs on every scroll
   * and on every resize this hook observes, and a second listener on one node
   * is a second chance to disagree with the first.
   *
   * Both false until the first measurement, which is also the honest answer for
   * a grid that has not been laid out yet.
   */
  const [edges, setEdges] = useState<ScrollEdges>({
    canScrollLeft: false,
    canScrollRight: false,
  });

  /**
   * How much of the container's box its own scrollbars occupy.
   *
   * The scroll affordance is a sibling of the table, positioned against a
   * wrapper the size of the container's *border* box — scrollbars included — so
   * without this its right-hand fade and page button are drawn on top of the
   * vertical scrollbar, and both fades cover the horizontal one.
   *
   * Measured here for the same reason `containerWidth` and `edges` are: this
   * hook already observes the element, and a second observer on one node is a
   * second chance to disagree with the first. Zero on a container that scrolls
   * neither way, and on an overlay-scrollbar platform, which are both the
   * honest answer.
   */
  const [gutter, setGutter] = useState<{ right: number; bottom: number }>({
    right: 0,
    bottom: 0,
  });

  const [state, setState] = useState<{
    window: MatrixWindow;
    rowCount: number;
    columnCount: number;
    windowed: boolean;
  }>(() => ({
    window: calculateWindow(options, rowSizesRef.current, headerHeightRef.current),
    rowCount: options.rowCount,
    columnCount: options.columnCount,
    windowed: options.windowed,
  }));

  function update(element: HTMLDivElement | null, force = false) {
    if (element) {
      // A 1px deadband. Sub-pixel layout noise here would feed straight back
      // into the caller's column widths, which change the table's width, which
      // the observer sees — the loop this whole measurement has to avoid.
      const width = Math.floor(element.clientWidth);
      setContainerWidth((current) => (Math.abs(current - width) > 1 ? width : current));

      // Not `next`: the window calculation below already owns that name in the
      // enclosing scope, and shadowing it here reads as the same value.
      const nextEdges = scrollEdges(element);
      setEdges((current) =>
        current.canScrollLeft === nextEdges.canScrollLeft &&
        current.canScrollRight === nextEdges.canScrollRight
          ? current
          : nextEdges,
      );

      // The container carries no border, so the difference between the two box
      // widths is the scrollbar (or the gutter `scrollbar-gutter: stable`
      // reserves for one). Same 1px deadband as the width above.
      const right = Math.max(0, element.offsetWidth - element.clientWidth);
      const bottom = Math.max(0, element.offsetHeight - element.clientHeight);
      setGutter((current) =>
        Math.abs(current.right - right) > 1 || Math.abs(current.bottom - bottom) > 1
          ? { right, bottom }
          : current,
      );
    }

    const next = calculateWindow(
      options,
      rowSizesRef.current,
      headerHeightRef.current,
      element,
      pendingScrollAdjustmentRef.current,
    );
    setState((current) =>
      !force &&
      current.rowCount === options.rowCount &&
      current.columnCount === options.columnCount &&
      current.windowed === options.windowed &&
      sameWindow(current.window, next)
        ? current
        : {
            window: next,
            rowCount: options.rowCount,
            columnCount: options.columnCount,
            windowed: options.windowed,
          },
    );
  }

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      // Preserve the first visible row while measurements change both known
      // sizes and the median used for every unseen row above it.
      const effectiveScrollTop = element.scrollTop + pendingScrollAdjustmentRef.current;
      const previousHeaderHeight = headerHeightRef.current;
      const anchor = getVariableAnchor({
        count: options.rowCount,
        estimatedItemSize: options.estimatedRowHeight,
        itemSizes: rowSizesRef.current,
        offset: Math.max(0, effectiveScrollTop - previousHeaderHeight),
      });
      let measurementsChanged = false;

      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const rowIndex = target.dataset.matrixRowIndex;
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height;

        if (rowIndex !== undefined) {
          const index = Number(rowIndex);
          if (
            Number.isInteger(index) &&
            Math.abs((rowSizesRef.current.get(index) ?? 0) - height) > 0.5
          ) {
            rowSizesRef.current.set(index, height);
            measurementsChanged = true;
          }
        } else if (
          target.tagName === "THEAD" &&
          Math.abs(headerHeightRef.current - height) > 0.5
        ) {
          headerHeightRef.current = height;
          measurementsChanged = true;
        }
      }

      let adjustment = 0;
      if (measurementsChanged && options.windowed) {
        adjustment =
          getVariableItemOffset({
            count: options.rowCount,
            estimatedItemSize: options.estimatedRowHeight,
            itemSizes: rowSizesRef.current,
            index: anchor.index,
          }) - anchor.startOffset;
        if (effectiveScrollTop > previousHeaderHeight) {
          adjustment += headerHeightRef.current - previousHeaderHeight;
        }
        pendingScrollAdjustmentRef.current += adjustment;
      }

      update(element, Math.abs(adjustment) > 0.5);
    });

    observer.observe(element);
    const header = element.querySelector("thead");
    if (header) observer.observe(header);
    for (const row of element.querySelectorAll<HTMLElement>("[data-matrix-row-index]")) {
      observer.observe(row);
    }
    update(element);
    return () => observer.disconnect();
  }, [
    options.rowCount,
    options.columnCount,
    options.estimatedRowHeight,
    options.columnWidth,
    options.estimatedHeaderHeight,
    options.leadingWidth,
    options.stickyLeadingWidth,
    options.windowed,
    state.window.rows.start,
    state.window.rows.end,
  ]);

  useLayoutEffect(() => {
    if (!options.windowed) {
      pendingScrollAdjustmentRef.current = 0;
      return;
    }

    const element = scrollRef.current;
    const adjustment = pendingScrollAdjustmentRef.current;
    if (!element || Math.abs(adjustment) <= 0.5) return;

    pendingScrollAdjustmentRef.current = 0;
    element.scrollTop += adjustment;
    update(element);
  }, [state, options.windowed]);

  const window =
    state.rowCount === options.rowCount &&
    state.columnCount === options.columnCount &&
    state.windowed === options.windowed
      ? state.window
      : calculateWindow(
          options,
          rowSizesRef.current,
          headerHeightRef.current,
          scrollRef.current,
          pendingScrollAdjustmentRef.current,
        );

  return {
    scrollRef,
    rowWindow: window.rows,
    columnWindow: window.columns,
    containerWidth,
    edges,
    gutter,
    onScroll: (event: UIEvent<HTMLDivElement>) => update(event.currentTarget),
  };
}

export function MatrixColumnSpacer({
  size,
  header = false,
}: {
  size: number;
  header?: boolean;
}) {
  if (size <= 0) return null;
  const style = { width: size, minWidth: size, padding: 0 };

  // A header spacer is opaque and carries the header's rule, because the header
  // is sticky: a transparent cell there is a window the body scrolls through,
  // and these spacers stand in for whole runs of columns.
  return header ? (
    <th
      aria-hidden="true"
      role="presentation"
      className={`bg-card ${HEADER_RULE}`}
      style={style}
    />
  ) : (
    <td aria-hidden="true" role="presentation" style={style} />
  );
}

export function MatrixRowSpacer({ height, colSpan }: { height: number; colSpan: number }) {
  if (height <= 0) return null;

  return (
    <tr aria-hidden="true" role="presentation" style={{ height }}>
      <td role="presentation" colSpan={colSpan} className="p-0" />
    </tr>
  );
}

export function WindowedMonthBandRow<P extends PeriodLike>({
  header,
  leadingLabel,
  leadingColSpan = 1,
  trailingColSpan = 0,
  beforeSize,
  afterSize,
  onToggleMonth,
  gridId,
}: {
  header: PeriodHeaderModel<P>;
  leadingLabel: string;
  leadingColSpan?: number;
  trailingColSpan?: number;
  beforeSize: number;
  afterSize: number;
  onToggleMonth?: (monthKey: string) => void;
  gridId?: string;
}) {
  if (header.months.length === 0) return null;

  return (
    // No `border-b`, and z-30 on the sticky corner rather than z-10 — see
    // HEADER_RULE, and the note on the sticky header in progress-tab.tsx.
    <tr>
      <th
        scope="col"
        colSpan={leadingColSpan}
        className={`sticky left-0 z-30 bg-card px-4 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground ${HEADER_RULE}`}
      >
        <span className="sr-only">{leadingLabel}</span>
      </th>
      <MatrixColumnSpacer size={beforeSize} header />
      {/* The same cell the unwindowed band draws — see MonthBandCell. Only the
          spacers either side of it are this component's business. */}
      {header.months.map((month) => (
        <MonthBandCell
          key={month.monthKey}
          month={month}
          onToggleMonth={onToggleMonth}
          gridId={gridId}
        />
      ))}
      <MatrixColumnSpacer size={afterSize} header />
      {trailingColSpan > 0 && (
        <th aria-hidden="true" colSpan={trailingColSpan} className={`bg-card ${HEADER_RULE}`} />
      )}
    </tr>
  );
}
