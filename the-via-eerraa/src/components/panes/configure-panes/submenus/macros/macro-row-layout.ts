export const MACRO_EVENT_MIN_WIDTH = 86;
export const MACRO_EVENT_COLUMN_GAP = 10;
export const MACRO_EVENT_INLINE_PADDING = 16;
export const MACRO_EVENT_ROW_GAP = 8;
export const MACRO_EVENT_BLOCK_PADDING = 14;
export const MACRO_EVENT_ESTIMATED_ROW_HEIGHT = 36;
export const MACRO_EVENT_FONT_SIZE = 16;

export const MACRO_PAIR_MIN_CONTENT_WIDTH =
  MACRO_EVENT_MIN_WIDTH * 2 + MACRO_EVENT_COLUMN_GAP;
export const MACRO_SINGLE_COLUMN_MAX_CLIENT_WIDTH =
  MACRO_PAIR_MIN_CONTENT_WIDTH + MACRO_EVENT_INLINE_PADDING * 2;

const MACRO_PAIR_STRIDE =
  (MACRO_EVENT_MIN_WIDTH + MACRO_EVENT_COLUMN_GAP) * 2;

export interface MacroScrollPadding {
  paddingStart: number;
  paddingEnd: number;
  scrollPaddingStart: number;
  scrollPaddingEnd: number;
  toolbarClearance: number;
}

export interface MacroRowLayoutGeometry {
  clientWidth: number;
  clientHeight: number;
  contentWidth: number;
  columns: number;
  singleColumn: boolean;
  rowCount: number;
  eventCount: number;
  rowGap: number;
  columnGap: number;
  inlinePadding: number;
  blockPadding: number;
  estimatedRowHeight: number;
  scrollPadding: MacroScrollPadding;
  containerGridTemplateColumns: string;
  viewportGridTemplateColumns: string;
}

export interface MacroRowBounds {
  start: number;
  end: number;
  size: number;
}

export interface MacroRowSpacerRange {
  key: string;
  startRow: number;
  endRow: number;
  heightPx: number;
}

export interface MacroRowSegment {
  startRow: number;
  endRow: number;
  startEventIndex: number;
  endEventIndexExclusive: number;
  leadingSpacer: MacroRowSpacerRange | null;
}

export interface MacroRowRenderPlan {
  segments: MacroRowSegment[];
  trailingSpacer: MacroRowSpacerRange | null;
  mountedRowIndices: number[];
  mountedEventCount: number;
}

/**
 * Whether a scroller clientWidth cannot fit a complete pair of 86px event cells
 * with 10px column gap and 16px inline padding on each side.
 */
export function isMacroSingleColumn(
  clientWidth: number,
  inlinePadding: number = MACRO_EVENT_INLINE_PADDING,
): boolean {
  return (
    clientWidth > 0 &&
    clientWidth < MACRO_PAIR_MIN_CONTENT_WIDTH + inlinePadding * 2
  );
}

/**
 * Usable inner content width of the macro sequence scroller after subtracting
 * left and right inline padding.
 */
export function getMacroContentWidth(
  clientWidth: number,
  inlinePadding: number = MACRO_EVENT_INLINE_PADDING,
): number {
  if (clientWidth <= 0) {
    return 0;
  }
  return Math.max(0, clientWidth - inlinePadding * 2);
}

/**
 * Complete column pairs (8/6/4/2 at typical widths), or 1 when a pair cannot fit
 * (including when clientWidth is unmeasured/<= 0).
 */
export function getMacroColumnCount(
  clientWidth: number,
  inlinePadding: number = MACRO_EVENT_INLINE_PADDING,
): number {
  const contentWidth = getMacroContentWidth(clientWidth, inlinePadding);
  if (contentWidth < MACRO_PAIR_MIN_CONTENT_WIDTH) {
    return 1;
  }
  const pairs = Math.max(
    1,
    Math.floor((contentWidth + MACRO_EVENT_COLUMN_GAP) / MACRO_PAIR_STRIDE),
  );
  return pairs * 2;
}

/**
 * Logical row count for the full event sequence (`ceil(eventCount / columns)`).
 */
export function getMacroRowCount(eventCount: number, columns: number): number {
  if (eventCount <= 0) {
    return 0;
  }
  const safeColumns = Math.max(1, columns);
  return Math.ceil(eventCount / safeColumns);
}

/**
 * Logical row index (`0 .. rowCount - 1`) containing a global `eventIndex`.
 */
export function getMacroEventRowIndex(
  eventIndex: number,
  columns: number,
): number {
  const safeColumns = Math.max(1, columns);
  return Math.max(0, Math.floor(eventIndex / safeColumns));
}

/**
 * Half-height of the lower-border straddling toolbar (`--macro-toolbar-half`).
 */
export function getMacroToolbarClearance(toolbarHeight: number): number {
  return Math.max(0, toolbarHeight) / 2;
}

/**
 * Reconciles outer scroller block padding (14px top/bottom) and the trailing
 * `::after` toolbar clearance pseudo-element (which adds one 8px grid row-gap +
 * `--macro-toolbar-half` inside `MacroSequenceContainer`) exactly once.
 */
export function getMacroScrollPadding(
  toolbarHeight: number,
  hasTrailingAfterPseudo: boolean = true,
): MacroScrollPadding {
  const toolbarClearance = getMacroToolbarClearance(toolbarHeight);
  const paddingStart = MACRO_EVENT_BLOCK_PADDING;
  const trailingGapAndClearance = hasTrailingAfterPseudo
    ? MACRO_EVENT_ROW_GAP + toolbarClearance
    : toolbarClearance;
  const paddingEnd = MACRO_EVENT_BLOCK_PADDING + trailingGapAndClearance;
  return {
    paddingStart,
    paddingEnd,
    scrollPaddingStart: paddingStart,
    scrollPaddingEnd: paddingEnd,
    toolbarClearance,
  };
}

/**
 * CSS `grid-template-columns` value for `MacroSequenceContainer` (used by active
 * recording preview and outer container styling).
 */
export function getMacroContainerGridTemplateColumns(
  singleColumn: boolean,
): string {
  return singleColumn
    ? 'minmax(0, 1fr)'
    : `repeat(auto-fill, minmax(${MACRO_EVENT_MIN_WIDTH}px, 1fr) minmax(${MACRO_EVENT_MIN_WIDTH}px, 1fr))`;
}

/**
 * CSS `grid-template-columns` value for the flat inner viewport grid so JS logical
 * row grouping and CSS Grid column count are always identical.
 */
export function getMacroViewportGridTemplateColumns(columns: number): string {
  const safeColumns = Math.max(1, columns);
  return safeColumns <= 1
    ? 'minmax(0, 1fr)'
    : `repeat(${safeColumns}, minmax(0, 1fr))`;
}

/**
 * Bottom Y coordinate inside the scroller above its bottom block padding and
 * straddling toolbar clearance, reusable by active recording preview fitting.
 */
export function getMacroRecordingFitBottom(
  scrollerElement: HTMLElement,
  toolbarHeight: number,
): number {
  const rect = scrollerElement.getBoundingClientRect();
  const paddingBottom =
    parseFloat(getComputedStyle(scrollerElement).paddingBottom) ||
    MACRO_EVENT_BLOCK_PADDING;
  return (
    rect.bottom -
    paddingBottom -
    scrollerElement.clientTop -
    getMacroToolbarClearance(toolbarHeight)
  );
}

/**
 * Full shared geometry snapshot for a given scroller size, event count, and toolbar height.
 */
export function getMacroRowLayout(params: {
  clientWidth: number;
  clientHeight: number;
  eventCount: number;
  toolbarHeight?: number;
  hasTrailingAfterPseudo?: boolean;
}): MacroRowLayoutGeometry {
  const {
    clientWidth,
    clientHeight,
    eventCount,
    toolbarHeight = 0,
    hasTrailingAfterPseudo = true,
  } = params;
  const singleColumn = isMacroSingleColumn(clientWidth);
  const columns = getMacroColumnCount(clientWidth);
  const contentWidth = getMacroContentWidth(clientWidth);
  const rowCount = getMacroRowCount(eventCount, columns);
  const scrollPadding = getMacroScrollPadding(
    toolbarHeight,
    hasTrailingAfterPseudo,
  );
  return {
    clientWidth,
    clientHeight,
    contentWidth,
    columns,
    singleColumn,
    rowCount,
    eventCount: Math.max(0, eventCount),
    rowGap: MACRO_EVENT_ROW_GAP,
    columnGap: MACRO_EVENT_COLUMN_GAP,
    inlinePadding: MACRO_EVENT_INLINE_PADDING,
    blockPadding: MACRO_EVENT_BLOCK_PADDING,
    estimatedRowHeight: MACRO_EVENT_ESTIMATED_ROW_HEIGHT,
    scrollPadding,
    containerGridTemplateColumns:
      getMacroContainerGridTemplateColumns(singleColumn),
    viewportGridTemplateColumns: getMacroViewportGridTemplateColumns(columns),
  };
}

/**
 * Merges TanStack's visible+overscan row indices with pinned row indices
 * (focused row and pending keyboard navigation target row), returning a sorted,
 * deduplicated list clamped to `[0, rowCount - 1]`.
 */
export function mergeMacroRowIndices(
  visibleRows: readonly number[],
  pinnedRows: readonly number[],
  rowCount: number,
): number[] {
  if (rowCount <= 0) {
    return [];
  }
  const set = new Set<number>();
  for (let i = 0; i < visibleRows.length; i++) {
    const r = visibleRows[i];
    if (Number.isInteger(r) && r >= 0 && r < rowCount) {
      set.add(r);
    }
  }
  for (let i = 0; i < pinnedRows.length; i++) {
    const r = pinnedRows[i];
    if (Number.isInteger(r) && r >= 0 && r < rowCount) {
      set.add(r);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Groups sorted row indices into contiguous row segments and computes the
 * exact full-span spacer heights for omitted row ranges before, between, and
 * after segments without introducing phantom CSS Grid row gaps.
 *
 * Because each rendered spacer is itself a CSS Grid item in a grid with
 * `row-gap: 8px`, CSS Grid automatically inserts one 8px gap between the spacer
 * and each adjacent rendered row segment. Therefore, an omitted range of rows
 * `[omittedStart .. omittedEnd]` has spacer height equal to
 * `bounds(omittedEnd).end - bounds(omittedStart).start`, which includes the
 * omitted rows' heights and their internal `(omittedEnd - omittedStart)` row
 * gaps, while the boundary gap(s) adjacent to rendered rows are supplied
 * once by CSS Grid itself.
 */
export function computeMacroRowRenderPlan(params: {
  sortedRowIndices: readonly number[];
  rowCount: number;
  columns: number;
  eventCount: number;
  getRowBounds: (rowIndex: number) => MacroRowBounds | undefined;
  paddingStart?: number;
  estimateRowHeight?: number;
}): MacroRowRenderPlan {
  const {
    sortedRowIndices,
    rowCount,
    columns,
    eventCount,
    getRowBounds,
    paddingStart = MACRO_EVENT_BLOCK_PADDING,
    estimateRowHeight = MACRO_EVENT_ESTIMATED_ROW_HEIGHT,
  } = params;

  if (rowCount <= 0 || eventCount <= 0) {
    return {
      segments: [],
      trailingSpacer: null,
      mountedRowIndices: [],
      mountedEventCount: 0,
    };
  }

  const safeColumns = Math.max(1, columns);
  const stride = estimateRowHeight + MACRO_EVENT_ROW_GAP;
  const resolveBounds = (rowIndex: number): MacroRowBounds => {
    const measured = getRowBounds(rowIndex);
    if (measured !== undefined) {
      return measured;
    }
    const start = paddingStart + rowIndex * stride;
    return {
      start,
      size: estimateRowHeight,
      end: start + estimateRowHeight,
    };
  };

  const buildSpacer = (
    key: string,
    omittedStartRow: number,
    omittedEndRow: number,
  ): MacroRowSpacerRange | null => {
    if (omittedEndRow < omittedStartRow) {
      return null;
    }
    const firstBounds = resolveBounds(omittedStartRow);
    const lastBounds = resolveBounds(omittedEndRow);
    const heightPx = Math.max(0, lastBounds.end - firstBounds.start);
    return {
      key,
      startRow: omittedStartRow,
      endRow: omittedEndRow,
      heightPx,
    };
  };

  const rawSegments: Array<{startRow: number; endRow: number}> = [];
  for (let i = 0; i < sortedRowIndices.length; i++) {
    const row = sortedRowIndices[i];
    if (row < 0 || row >= rowCount) {
      continue;
    }
    const prev = rawSegments[rawSegments.length - 1];
    if (!prev || row > prev.endRow + 1) {
      rawSegments.push({startRow: row, endRow: row});
    } else if (row === prev.endRow + 1) {
      prev.endRow = row;
    }
  }

  if (rawSegments.length === 0) {
    return {
      segments: [],
      trailingSpacer: buildSpacer('macro-spacer-trail', 0, rowCount - 1),
      mountedRowIndices: [],
      mountedEventCount: 0,
    };
  }

  const segments: MacroRowSegment[] = [];
  let mountedEventCount = 0;

  for (let i = 0; i < rawSegments.length; i++) {
    const {startRow, endRow} = rawSegments[i];
    const startEventIndex = Math.min(eventCount, startRow * safeColumns);
    const endEventIndexExclusive = Math.min(
      eventCount,
      (endRow + 1) * safeColumns,
    );
    mountedEventCount += Math.max(0, endEventIndexExclusive - startEventIndex);

    const leadingSpacer =
      i === 0
        ? startRow > 0
          ? buildSpacer('macro-spacer-lead', 0, startRow - 1)
          : null
        : buildSpacer(
            `macro-spacer-mid-${i}`,
            rawSegments[i - 1].endRow + 1,
            startRow - 1,
          );

    segments.push({
      startRow,
      endRow,
      startEventIndex,
      endEventIndexExclusive,
      leadingSpacer,
    });
  }

  const lastSegment = rawSegments[rawSegments.length - 1];
  const trailingSpacer =
    lastSegment.endRow < rowCount - 1
      ? buildSpacer(
          'macro-spacer-trail',
          lastSegment.endRow + 1,
          rowCount - 1,
        )
      : null;

  return {
    segments,
    trailingSpacer,
    mountedRowIndices: sortedRowIndices.slice(),
    mountedEventCount,
  };
}
