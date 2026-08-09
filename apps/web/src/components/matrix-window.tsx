"use client";

import type { UIEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { PeriodHeaderModel, PeriodLike } from "@/lib/period-header";
import {
  getFullMatrixWindow,
  getMatrixWindow,
  getVariableAnchor,
  getVariableItemOffset,
  type MatrixWindow,
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

  return header ? (
    <th aria-hidden="true" role="presentation" style={style} />
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
}: {
  header: PeriodHeaderModel<P>;
  leadingLabel: string;
  leadingColSpan?: number;
  trailingColSpan?: number;
  beforeSize: number;
  afterSize: number;
}) {
  if (header.months.length === 0) return null;

  return (
    <tr className="border-b">
      <th
        scope="col"
        colSpan={leadingColSpan}
        className="sticky left-0 z-10 bg-card px-4 py-1 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        <span className="sr-only">{leadingLabel}</span>
      </th>
      <MatrixColumnSpacer size={beforeSize} header />
      {header.months.map((month) => (
        <th
          key={month.monthKey}
          scope="colgroup"
          colSpan={month.span}
          className="border-l px-2 py-1 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground first:border-l-0"
        >
          {month.label}
        </th>
      ))}
      <MatrixColumnSpacer size={afterSize} header />
      {trailingColSpan > 0 && <th aria-hidden="true" colSpan={trailingColSpan} />}
    </tr>
  );
}
