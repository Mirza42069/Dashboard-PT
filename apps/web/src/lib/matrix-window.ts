export type MatrixWindowRange = {
  start: number;
  end: number;
  beforeSize: number;
  afterSize: number;
};

export type MatrixWindow = {
  rows: MatrixWindowRange;
  columns: MatrixWindowRange;
};

type WindowRangeOptions = {
  count: number;
  itemSize: number;
  startOffset: number;
  endOffset: number;
  overscan: number;
  limit: number;
};

type VariableWindowRangeOptions = Omit<WindowRangeOptions, "itemSize"> & {
  estimatedItemSize: number;
  itemSizes: ReadonlyMap<number, number>;
};

type VariableItemOptions = {
  count: number;
  estimatedItemSize: number;
  itemSizes: ReadonlyMap<number, number>;
};

function getVariableOffsets({
  count,
  estimatedItemSize,
  itemSizes,
}: VariableItemOptions): number[] {
  const safeCount = Math.max(0, Math.floor(count));
  const measuredSizes = [...itemSizes.values()]
    .filter((size) => Number.isFinite(size) && size > 0)
    .sort((left, right) => left - right);
  const middle = Math.floor(measuredSizes.length / 2);
  const measuredMedian =
    measuredSizes.length === 0
      ? null
      : measuredSizes.length % 2 === 0
        ? ((measuredSizes[middle - 1] ?? 0) + (measuredSizes[middle] ?? 0)) / 2
        : (measuredSizes[middle] ?? null);
  const fallbackSize = Math.max(1, measuredMedian ?? estimatedItemSize);
  const offsets = new Array<number>(safeCount + 1).fill(0);

  for (let index = 0; index < safeCount; index += 1) {
    const measured = itemSizes.get(index);
    const size =
      measured !== undefined && Number.isFinite(measured) && measured > 0
        ? measured
        : fallbackSize;
    offsets[index + 1] = (offsets[index] ?? 0) + size;
  }

  return offsets;
}

export function getVariableAnchor(
  options: VariableItemOptions & { offset: number },
): { index: number; startOffset: number } {
  const safeCount = Math.max(0, Math.floor(options.count));
  if (safeCount === 0) return { index: 0, startOffset: 0 };

  const offsets = getVariableOffsets(options);
  const safeOffset = Math.max(0, options.offset);
  let index = 0;
  while (index < safeCount - 1 && (offsets[index + 1] ?? 0) <= safeOffset) {
    index += 1;
  }

  return { index, startOffset: offsets[index] ?? 0 };
}

export function getVariableItemOffset(
  options: VariableItemOptions & { index: number },
): number {
  const safeCount = Math.max(0, Math.floor(options.count));
  const safeIndex = Math.min(safeCount, Math.max(0, Math.floor(options.index)));
  return getVariableOffsets(options)[safeIndex] ?? 0;
}

/** Returns an end-exclusive, size-bounded slice and its two virtual spacers. */
export function getWindowRange({
  count,
  itemSize,
  startOffset,
  endOffset,
  overscan,
  limit,
}: WindowRangeOptions): MatrixWindowRange {
  const safeCount = Math.max(0, Math.floor(count));
  const safeSize = Math.max(1, itemSize);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const safeLimit = Math.max(1, Math.floor(limit));

  if (safeCount === 0) {
    return { start: 0, end: 0, beforeSize: 0, afterSize: 0 };
  }

  const firstVisible = Math.min(
    safeCount - 1,
    Math.max(0, Math.floor(Math.max(0, startOffset) / safeSize)),
  );
  const lastVisible = Math.min(
    safeCount,
    Math.max(firstVisible + 1, Math.ceil(Math.max(startOffset, endOffset, 0) / safeSize)),
  );
  let start = Math.max(0, firstVisible - safeOverscan);
  let end = Math.min(safeCount, lastVisible + safeOverscan);

  if (end - start > safeLimit) {
    end = Math.min(safeCount, start + safeLimit);
  }

  if (end - start < Math.min(safeLimit, safeCount) && end === safeCount) {
    start = Math.max(0, end - Math.min(safeLimit, safeCount));
  }

  return {
    start,
    end,
    beforeSize: start * safeSize,
    afterSize: (safeCount - end) * safeSize,
  };
}

/** Uses measured item sizes where available and a measured median for unseen items. */
export function getVariableWindowRange({
  count,
  estimatedItemSize,
  itemSizes,
  startOffset,
  endOffset,
  overscan,
  limit,
}: VariableWindowRangeOptions): MatrixWindowRange {
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0) {
    return { start: 0, end: 0, beforeSize: 0, afterSize: 0 };
  }

  const offsets = getVariableOffsets({ count, estimatedItemSize, itemSizes });

  const safeStartOffset = Math.max(0, startOffset);
  const safeEndOffset = Math.max(safeStartOffset, endOffset);
  let firstVisible = 0;
  while (firstVisible < safeCount - 1 && (offsets[firstVisible + 1] ?? 0) <= safeStartOffset) {
    firstVisible += 1;
  }

  let lastVisible = firstVisible + 1;
  while (lastVisible < safeCount && (offsets[lastVisible] ?? 0) < safeEndOffset) {
    lastVisible += 1;
  }

  const safeOverscan = Math.max(0, Math.floor(overscan));
  const safeLimit = Math.max(1, Math.floor(limit));
  let start = Math.max(0, firstVisible - safeOverscan);
  let end = Math.min(safeCount, lastVisible + safeOverscan);

  if (end - start > safeLimit) {
    end = Math.min(safeCount, start + safeLimit);
  }
  if (end - start < Math.min(safeLimit, safeCount) && end === safeCount) {
    start = Math.max(0, end - Math.min(safeLimit, safeCount));
  }

  return {
    start,
    end,
    beforeSize: offsets[start] ?? 0,
    afterSize: (offsets[safeCount] ?? 0) - (offsets[end] ?? 0),
  };
}

export function getFullMatrixWindow(rowCount: number, columnCount: number): MatrixWindow {
  const fullRange = (count: number): MatrixWindowRange => ({
    start: 0,
    end: Math.max(0, Math.floor(count)),
    beforeSize: 0,
    afterSize: 0,
  });

  return { rows: fullRange(rowCount), columns: fullRange(columnCount) };
}

export type MatrixWindowOptions = {
  rowCount: number;
  columnCount: number;
  rowHeight: number;
  columnWidth: number;
  headerHeight: number;
  leadingWidth: number;
  stickyLeadingWidth: number;
  scrollTop: number;
  scrollLeft: number;
  viewportHeight: number;
  viewportWidth: number;
  rowOverscan: number;
  columnOverscan: number;
  rowLimit: number;
  columnLimit: number;
  rowSizes?: ReadonlyMap<number, number>;
};

/** Converts a matrix scroll viewport into independent row and period windows. */
export function getMatrixWindow(options: MatrixWindowOptions): MatrixWindow {
  const rowStart = Math.max(0, options.scrollTop - options.headerHeight);
  const rowEnd = Math.max(rowStart, options.scrollTop + options.viewportHeight - options.headerHeight);
  const columnStart = Math.max(
    0,
    options.scrollLeft + options.stickyLeadingWidth - options.leadingWidth,
  );
  const columnEnd = Math.max(
    columnStart,
    options.scrollLeft + options.viewportWidth - options.leadingWidth,
  );

  return {
    rows: getVariableWindowRange({
      count: options.rowCount,
      estimatedItemSize: options.rowHeight,
      itemSizes: options.rowSizes ?? new Map(),
      startOffset: rowStart,
      endOffset: rowEnd,
      overscan: options.rowOverscan,
      limit: options.rowLimit,
    }),
    columns: getWindowRange({
      count: options.columnCount,
      itemSize: options.columnWidth,
      startOffset: columnStart,
      endOffset: columnEnd,
      overscan: options.columnOverscan,
      limit: options.columnLimit,
    }),
  };
}

/** Whether a scroll container still has content hidden off either side. */
export type ScrollEdges = { canScrollLeft: boolean; canScrollRight: boolean };

/**
 * The two flags a horizontal scroll affordance is drawn from.
 *
 * Split out of the hook the way `matrix-fit` and `matrix-keyboard` are: this is
 * the part worth testing, and the measuring lives in the hook that calls it.
 *
 * The 1px deadband is the same one `useMatrixWindow` applies to the container
 * width, and for the same reason — sub-pixel layout noise here would flicker a
 * fade and a button in and out at the end of a scroll.
 */
export function scrollEdges({
  scrollLeft,
  scrollWidth,
  clientWidth,
}: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): ScrollEdges {
  return {
    canScrollLeft: scrollLeft > 1,
    canScrollRight: scrollWidth - clientWidth - scrollLeft > 1,
  };
}
