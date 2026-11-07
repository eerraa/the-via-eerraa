import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from '@tanstack/react-virtual';
import styled from 'styled-components';
import {
  computeMacroRowRenderPlan,
  getMacroEventRowIndex,
  getMacroRowLayout,
  MACRO_EVENT_COLUMN_GAP,
  MACRO_EVENT_ESTIMATED_ROW_HEIGHT,
  MACRO_EVENT_ROW_GAP,
  mergeMacroRowIndices,
  type MacroRowBounds,
  type MacroRowLayoutGeometry,
} from './macro-row-layout';

export type MacroEventViewId = string | number;
export type MacroEventControlKind = 'delay-input' | 'delete';
export type MacroEventKind = 'delay' | 'key';

export interface MacroEventCellProps {
  key: MacroEventViewId;
  ref: (node: HTMLElement | null) => void;
  'data-macro-event': number;
  'data-macro-view-id': string;
  'data-macro-row': number;
}

export interface MacroFocusTarget {
  eventIndex: number;
  viewId?: MacroEventViewId;
  controlKind: MacroEventControlKind;
  selectionStart?: number | null;
  selectionEnd?: number | null;
}

export interface MacroScrollAnchorSnapshot {
  /** Global event index anchored to the viewport top (or active focus row). */
  eventIndex: number;
  /** Opaque stable UI ID of the anchored event for provenance remapping. */
  viewId?: MacroEventViewId;
  /** Pixel offset from the anchored event row's top to the viewport scrollTop. */
  offsetInRowPx: number;
  /** Raw scroller scrollTop at capture time. */
  scrollTop: number;
}

export interface MacroViewportSnapshot {
  contextKey: string | number;
  modelRevision?: string | number;
  anchor: MacroScrollAnchorSnapshot | null;
  focus: MacroFocusTarget | null;
  pendingNavigation: MacroFocusTarget | null;
}

export interface MacroEventViewportHandle {
  /** Capture current scroll anchor, active focus target, and pending keyboard navigation target. */
  captureSnapshot: () => MacroViewportSnapshot;
  /** Capture only the current event+pixel-offset scroll anchor. */
  captureScrollAnchor: () => MacroScrollAnchorSnapshot | null;
  /**
   * Restore a (possibly provenance-remapped) snapshot of scroll anchor, focus,
   * and/or pending keyboard navigation target.
   */
  restoreSnapshot: (
    snapshot: Partial<
      Pick<MacroViewportSnapshot, 'anchor' | 'focus' | 'pendingNavigation'>
    > & {
      contextKey?: string | number;
      invalidateUnseenMeasurements?: boolean;
    },
  ) => void;
  /** Restore only a (possibly provenance-remapped) event+pixel-offset scroll anchor. */
  restoreScrollAnchor: (
    anchor: MacroScrollAnchorSnapshot | null,
    options?: {
      contextKey?: string | number;
      invalidateUnseenMeasurements?: boolean;
    },
  ) => void;
  /** Programmatically focus a logical event control, mounting and scrolling its row first if offscreen. */
  focusEventControl: (target: MacroFocusTarget) => void;
  /** Scroll a logical event index into view. */
  scrollToEvent: (
    eventIndex: number,
    align?: 'start' | 'center' | 'end' | 'auto',
  ) => void;
  /** Scroll to the start (top) of the macro list. */
  scrollToStart: () => void;
  /** Scroll to the end (bottom) of the macro list, settling as bottom rows measure. */
  scrollToEnd: () => void;
  /** Clear all cached row measurements (seen and unseen) and re-measure mounted rows. */
  invalidateMeasurements: () => void;
  /** Read current shared row-layout geometry. */
  getLayoutGeometry: () => MacroRowLayoutGeometry;
}

export interface MacroEventViewportProps {
  /** Full logical event count in stopped mode (no 5000-event cap). */
  eventCount: number;
  /**
   * Context identity (e.g. `${devicePath}:${connectionGeneration}:${macroIndex}`).
   * Changes cancel pending focus/scroll, clear measurements, and reset scroll to 0.
   */
  contextKey: string | number;
  /**
   * Optional revision token or sequence reference for the current derived frame.
   */
  modelRevision?: string | number | object;
  /** The mounted scrolling container (`MacroSequenceContainer`). */
  scrollerElement: HTMLElement | null;
  /**
   * Optional ref to the lower-border toolbar container (`RecorderTools`) so
   * `Shift+Tab` from the first enabled toolbar control enters the actual last
   * logical enabled macro control.
   */
  toolbarElement?: HTMLElement | null;
  /** Measured height of the straddling lower-border toolbar (`toolbarHeight`). */
  toolbarHeight?: number;
  /** Whether editing controls (delay inputs and delete buttons) are disabled. */
  disabled?: boolean;
  /** Logical rows to overscan above and below the visible range (default 2). */
  overscan?: number;
  /** Returns the opaque stable UI ID (`viewId`) for `eventIndex`. */
  getViewId: (eventIndex: number) => MacroEventViewId;
  /** Resolves an opaque stable UI ID (`viewId`) to its current global `eventIndex`, or `-1`. */
  getIndexForViewId: (viewId: MacroEventViewId) => number;
  /**
   * Returns `'delay'` or `'key'` for `eventIndex` without building labels/JSX.
   * Used to determine control kinds (`['delay-input', 'delete']` vs `['delete']`)
   * for global `Tab` / `Shift+Tab` navigation.
   */
  getEventKind?: (eventIndex: number) => MacroEventKind;
  /**
   * Optional explicit getter for the enabled control kinds of `eventIndex` in tab order.
   */
  getEventControlKinds?: (
    eventIndex: number,
  ) => readonly MacroEventControlKind[];
  /**
   * Renders a single event cell for `(eventIndex, viewId, cellProps)`.
   * Invoked ONLY for mounted rows (visible + overscan + pinned rows) AFTER
   * TanStack Virtual computes the logical row range.
   * Attach cellProps.ref to the returned event's root element.
   */
  renderEvent: (
    eventIndex: number,
    viewId: MacroEventViewId,
    cellProps: MacroEventCellProps,
  ) => React.ReactNode;
  /** Rendered when `eventCount === 0`. */
  emptyState?: React.ReactNode;
  /**
   * Whether the outer scroller includes the trailing `::after` pseudo-element
   * for toolbar clearance (default `true`, matching `MacroSequenceContainer`).
   */
  hasTrailingAfterPseudo?: boolean;
}

const ViewportGrid = styled.div<{$gridTemplateColumns: string}>`
  grid-column: 1 / -1;
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: ${(props) => props.$gridTemplateColumns};
  gap: ${MACRO_EVENT_ROW_GAP}px ${MACRO_EVENT_COLUMN_GAP}px;
  align-content: start;
  align-items: stretch;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
`;

const ViewportSpacer = styled.div`
  grid-column: 1 / -1;
  width: 100%;
  min-width: 0;
  pointer-events: none;
  user-select: none;
`;

const FOCUSABLE_TOOLBAR_SELECTOR =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)';

function readCellHeight(
  element: HTMLElement,
  entry?: ResizeObserverEntry,
): number {
  const borderBoxBlockSize = entry?.borderBoxSize?.[0]?.blockSize;
  if (typeof borderBoxBlockSize === 'number' && borderBoxBlockSize > 0) {
    return Math.max(
      MACRO_EVENT_ESTIMATED_ROW_HEIGHT,
      Math.round(borderBoxBlockSize),
    );
  }
  const rectHeight = element.getBoundingClientRect().height;
  if (rectHeight > 0) {
    return Math.max(MACRO_EVENT_ESTIMATED_ROW_HEIGHT, Math.round(rectHeight));
  }
  const offsetHeight = element.offsetHeight;
  if (offsetHeight > 0) {
    return Math.max(MACRO_EVENT_ESTIMATED_ROW_HEIGHT, Math.round(offsetHeight));
  }
  return MACRO_EVENT_ESTIMATED_ROW_HEIGHT;
}

function findControlElementInCell(
  cell: HTMLElement | null | undefined,
  controlKind: MacroEventControlKind,
): HTMLElement | null {
  if (!cell) {
    return null;
  }
  if (controlKind === 'delay-input') {
    return cell.querySelector<HTMLElement>('input:not(:disabled)');
  }
  return cell.querySelector<HTMLElement>('button:not(:disabled)');
}

function getFirstFocusableToolbarControl(
  toolbarRoot: HTMLElement | null | undefined,
): HTMLElement | null {
  if (!toolbarRoot) {
    return null;
  }
  return toolbarRoot.querySelector<HTMLElement>(FOCUSABLE_TOOLBAR_SELECTOR);
}

export const MacroEventViewport = forwardRef<
  MacroEventViewportHandle,
  MacroEventViewportProps
>(function MacroEventViewport(
  {
    eventCount,
    contextKey,
    modelRevision,
    scrollerElement,
    toolbarElement,
    toolbarHeight = 0,
    disabled = false,
    overscan = 2,
    getViewId,
    getIndexForViewId,
    getEventKind,
    getEventControlKinds,
    renderEvent,
    emptyState = null,
    hasTrailingAfterPseudo = true,
  },
  ref,
) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Parent host refs attach after child layout effects; node identities rebind them.
  const scrollerRef = useMemo(() => ({current: scrollerElement}), [scrollerElement]);
  const toolbarRef = useMemo(() => ({current: toolbarElement}), [toolbarElement]);

  const [scrollerSize, setScrollerSize] = useState<{
    clientWidth: number;
    clientHeight: number;
  }>(() => ({
    clientWidth: scrollerRef.current?.clientWidth ?? 0,
    clientHeight: scrollerRef.current?.clientHeight ?? 0,
  }));

  const [focusedTarget, setFocusedTargetState] =
    useState<MacroFocusTarget | null>(null);
  const [pendingNavTarget, setPendingNavTargetState] =
    useState<MacroFocusTarget | null>(null);

  const focusedTargetRef = useRef<MacroFocusTarget | null>(null);
  const pendingNavTargetRef = useRef<MacroFocusTarget | null>(null);

  const setFocusedTarget = useCallback((next: MacroFocusTarget | null) => {
    focusedTargetRef.current = next;
    setFocusedTargetState((prev) => {
      if (
        prev === next ||
        (prev !== null &&
          next !== null &&
          prev.eventIndex === next.eventIndex &&
          prev.viewId === next.viewId &&
          prev.controlKind === next.controlKind)
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const setPendingNavTarget = useCallback((next: MacroFocusTarget | null) => {
    pendingNavTargetRef.current = next;
    setPendingNavTargetState((prev) => {
      if (
        prev === next ||
        (prev !== null &&
          next !== null &&
          prev.eventIndex === next.eventIndex &&
          prev.viewId === next.viewId &&
          prev.controlKind === next.controlKind)
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const latestPropsRef = useRef({
    eventCount,
    contextKey,
    modelRevision,
    disabled,
    getViewId,
    getIndexForViewId,
    getEventKind,
    getEventControlKinds,
  });
  latestPropsRef.current = {
    eventCount,
    contextKey,
    modelRevision,
    disabled,
    getViewId,
    getIndexForViewId,
    getEventKind,
    getEventControlKinds,
  };

  const layout = useMemo(
    () =>
      getMacroRowLayout({
        clientWidth: scrollerSize.clientWidth,
        clientHeight: scrollerSize.clientHeight,
        eventCount,
        toolbarHeight,
        hasTrailingAfterPseudo,
      }),
    [
      scrollerSize.clientWidth,
      scrollerSize.clientHeight,
      eventCount,
      toolbarHeight,
      hasTrailingAfterPseudo,
    ],
  );

  const {columns, rowCount, contentWidth, scrollPadding} = layout;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const resolveTargetEventIndex = useCallback(
    (target: MacroFocusTarget | null): number => {
      if (!target || disabled || eventCount <= 0) {
        return -1;
      }
      if (target.viewId !== undefined) {
        const byId = getIndexForViewId(target.viewId);
        if (byId >= 0 && byId < eventCount) {
          return byId;
        }
        return -1;
      }
      return target.eventIndex >= 0 && target.eventIndex < eventCount
        ? target.eventIndex
        : -1;
    },
    [disabled, eventCount, getIndexForViewId],
  );

  const focusedEventIndex = resolveTargetEventIndex(focusedTarget);
  const pendingNavEventIndex = resolveTargetEventIndex(pendingNavTarget);

  const focusedRowIndex =
    focusedEventIndex >= 0
      ? getMacroEventRowIndex(focusedEventIndex, columns)
      : -1;
  const pendingNavRowIndex =
    pendingNavEventIndex >= 0
      ? getMacroEventRowIndex(pendingNavEventIndex, columns)
      : -1;

  const rangeExtractor = useCallback(
    (range: Range): number[] => {
      const visible = defaultRangeExtractor(range);
      const pins: number[] = [];
      if (focusedRowIndex >= 0) {
        pins.push(focusedRowIndex);
      }
      if (pendingNavRowIndex >= 0 && pendingNavRowIndex !== focusedRowIndex) {
        pins.push(pendingNavRowIndex);
      }
      return mergeMacroRowIndices(visible, pins, range.count);
    },
    [focusedRowIndex, pendingNavRowIndex],
  );

  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count: rowCount,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => MACRO_EVENT_ESTIMATED_ROW_HEIGHT,
    overscan,
    gap: MACRO_EVENT_ROW_GAP,
    paddingStart: scrollPadding.paddingStart,
    paddingEnd: scrollPadding.paddingEnd,
    scrollPaddingStart: scrollPadding.scrollPaddingStart,
    scrollPaddingEnd: scrollPadding.scrollPaddingEnd,
    initialRect: {
      width: scrollerSize.clientWidth,
      height: scrollerSize.clientHeight,
    },
    rangeExtractor,
  });

  // Single owner of scroll-anchor correction: disable competing library scroll adjustments.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;

  const cellHeightsRef = useRef<WeakMap<Element, number>>(new WeakMap());
  const rowHeightsRef = useRef<Map<number, number>>(new Map());
  const cellObserverRef = useRef<ResizeObserver | null>(null);
  const cellRefCallbacksRef = useRef<
    Map<MacroEventViewId, (node: HTMLElement | null) => void>
  >(new Map());
  const mountedCellByViewIdRef = useRef<Map<MacroEventViewId, HTMLElement>>(
    new Map(),
  );
  const viewIdByCellRef = useRef<WeakMap<Element, MacroEventViewId>>(new WeakMap());
  const dirtyMountedRowsRef = useRef<Set<number>>(new Set());
  const lastMeasuredCommitRef = useRef<{
    contextKey: MacroEventViewportProps['contextKey'];
    modelRevision: MacroEventViewportProps['modelRevision'];
    eventCount: number;
    columns: number;
    contentWidth: number;
  } | null>(null);

  const activeScrollAnchorRef = useRef<MacroScrollAnchorSnapshot | null>(null);
  const pendingRestoreAnchorRef = useRef<MacroScrollAnchorSnapshot | null>(
    null,
  );
  const programmaticScrollTopRef = useRef<number | null>(null);
  const stickToEndRef = useRef<boolean>(false);
  const forceFocusRestoreRef = useRef<boolean>(false);

  const writeProgrammaticScrollTop = useCallback(
    (scroller: HTMLElement, nextScrollTop: number) => {
      const clamped = Math.max(0, nextScrollTop);
      const prevRangeStart = virtualizer.range?.startIndex ?? null;
      const prevRangeEnd = virtualizer.range?.endIndex ?? null;
      const scrollChanged = Math.abs(scroller.scrollTop - clamped) >= 0.5;
      const offsetChanged =
        virtualizer.scrollOffset === null ||
        Math.abs(virtualizer.scrollOffset - clamped) >= 0.5;
      if (!scrollChanged && !offsetChanged) {
        return;
      }
      programmaticScrollTopRef.current = clamped;
      if (scrollChanged) {
        scroller.scrollTop = clamped;
      }
      virtualizer.scrollOffset = clamped;
      const nextRange = virtualizer.calculateRange();
      if (
        (nextRange?.startIndex ?? null) !== prevRangeStart ||
        (nextRange?.endIndex ?? null) !== prevRangeEnd
      ) {
        virtualizer.options.onChange?.(virtualizer, false);
      }
    },
    [virtualizer],
  );

  const getRowMeasurements = useCallback(() => {
    // Refresh the public cache without relying on TanStack's private getMeasurements.
    virtualizer.getTotalSize();
    return virtualizer.measurementsCache;
  }, [virtualizer]);

  const computeAnchorFromCurrentScroll =
    useCallback((): MacroScrollAnchorSnapshot | null => {
      const {
        eventCount: count,
        getViewId: viewIdOf,
        getIndexForViewId: indexOfViewId,
      } = latestPropsRef.current;
      const currentLayout = layoutRef.current;
      const scroller = scrollerRef.current;
      if (count <= 0 || currentLayout.rowCount <= 0) {
        return null;
      }
      const scrollTop = scroller?.scrollTop ?? virtualizer.scrollOffset ?? 0;
      const padStart = currentLayout.scrollPadding.paddingStart;
      const measurements = getRowMeasurements();

      // Prefer a currently focused event if its row is visible within the viewport.
      const currentFocus = focusedTargetRef.current;
      if (currentFocus && scroller) {
        const focusedIdx =
          currentFocus.viewId !== undefined
            ? indexOfViewId(currentFocus.viewId)
            : currentFocus.eventIndex;
        if (focusedIdx >= 0 && focusedIdx < count) {
          const fRow = getMacroEventRowIndex(
            focusedIdx,
            currentLayout.columns,
          );
          const fBounds = measurements[fRow];
          if (fBounds) {
            const rowTopInScroller = fBounds.start - padStart;
            const rowBottomInScroller = fBounds.end - padStart;
            const viewportHeight =
              scroller.clientHeight > 0
                ? scroller.clientHeight
                : currentLayout.clientHeight;
            if (
              viewportHeight > 0 &&
              rowBottomInScroller > scrollTop &&
              rowTopInScroller < scrollTop + viewportHeight
            ) {
              return {
                eventIndex: focusedIdx,
                viewId: viewIdOf(focusedIdx),
                offsetInRowPx: scrollTop - rowTopInScroller,
                scrollTop,
              };
            }
          }
        }
      }

      const layoutOffset = Math.max(0, scrollTop) + padStart;
      const item =
        virtualizer.getVirtualItemForOffset(layoutOffset) ?? measurements[0];
      if (!item) {
        return {
          eventIndex: 0,
          viewId: viewIdOf(0),
          offsetInRowPx: 0,
          scrollTop,
        };
      }
      const eventIndex = Math.min(
        count - 1,
        Math.max(0, item.index * currentLayout.columns),
      );
      const rowTopInScroller = item.start - padStart;
      return {
        eventIndex,
        viewId: viewIdOf(eventIndex),
        offsetInRowPx: scrollTop - rowTopInScroller,
        scrollTop,
      };
    }, [getRowMeasurements, scrollerRef, virtualizer]);

  const resolveAnchorEventIndex = useCallback(
    (anchor: MacroScrollAnchorSnapshot | null): number => {
      const {eventCount: count, getIndexForViewId: indexOfViewId} =
        latestPropsRef.current;
      if (!anchor || count <= 0) {
        return -1;
      }
      if (anchor.viewId !== undefined) {
        const resolved = indexOfViewId(anchor.viewId);
        if (resolved >= 0 && resolved < count) {
          return resolved;
        }
      }
      if (anchor.eventIndex >= 0 && anchor.eventIndex < count) {
        return anchor.eventIndex;
      }
      return Math.max(0, Math.min(count - 1, anchor.eventIndex));
    },
    [],
  );

  const applyAnchorToScroller = useCallback(
    (anchor: MacroScrollAnchorSnapshot | null) => {
      const scroller = scrollerRef.current;
      const currentLayout = layoutRef.current;
      if (!scroller || !anchor || currentLayout.rowCount <= 0) {
        return;
      }
      const resolvedEventIndex = resolveAnchorEventIndex(anchor);
      if (resolvedEventIndex < 0) {
        return;
      }
      const anchorRow = getMacroEventRowIndex(
        resolvedEventIndex,
        currentLayout.columns,
      );
      const measurements = getRowMeasurements();
      const rowBounds = measurements[anchorRow];
      if (!rowBounds) {
        return;
      }
      const rowTopInScroller =
        rowBounds.start - currentLayout.scrollPadding.paddingStart;
      const nextScrollTop = Math.max(0, rowTopInScroller + anchor.offsetInRowPx);
      writeProgrammaticScrollTop(scroller, nextScrollTop);
      activeScrollAnchorRef.current = {
        eventIndex: resolvedEventIndex,
        viewId: latestPropsRef.current.getViewId(resolvedEventIndex),
        offsetInRowPx: anchor.offsetInRowPx,
        scrollTop: nextScrollTop,
      };
    },
    [getRowMeasurements, resolveAnchorEventIndex, scrollerRef, virtualizer, writeProgrammaticScrollTop],
  );

  const clearMeasurementCaches = useCallback(() => {
    cellHeightsRef.current = new WeakMap();
    rowHeightsRef.current.clear();
    dirtyMountedRowsRef.current.clear();
    lastMeasuredCommitRef.current = null;
    virtualizer.measure();
  }, [virtualizer]);

  const measureMountedRows = useCallback(
    (
      entryMap?: Map<Element, ResizeObserverEntry>,
      forceAllMounted: boolean = false,
    ) => {
      const scroller = scrollerRef.current;
      const currentLayout = layoutRef.current;
      const {
        eventCount: count,
        getViewId: viewIdOf,
        getIndexForViewId: indexOfViewId,
        contextKey: currentContext,
        modelRevision: currentRevision,
      } = latestPropsRef.current;

      if (!gridRef.current || currentLayout.rowCount <= 0 || count <= 0) {
        dirtyMountedRowsRef.current.clear();
        return;
      }

      const affectedRows = new Set<number>();
      let forceRead = forceAllMounted;
      if (entryMap !== undefined) {
        entryMap.forEach((entry, element) => {
          const viewId = viewIdByCellRef.current.get(element);
          if (
            viewId === undefined ||
            mountedCellByViewIdRef.current.get(viewId) !== element
          ) {
            return;
          }
          const index = indexOfViewId(viewId);
          if (!Number.isInteger(index) || index < 0 || index >= count) return;
          const row = getMacroEventRowIndex(index, currentLayout.columns);
          const height = readCellHeight(element as HTMLElement, entry);
          const previousHeight = cellHeightsRef.current.get(element);
          cellHeightsRef.current.set(element, height);
          if (height !== previousHeight || !rowHeightsRef.current.has(row)) {
            affectedRows.add(row);
          }
        });
      } else {
        const previous = lastMeasuredCommitRef.current;
        forceRead =
          forceRead ||
          previous === null ||
          previous.contextKey !== currentContext ||
          previous.modelRevision !== currentRevision ||
          previous.eventCount !== count ||
          previous.columns !== currentLayout.columns ||
          previous.contentWidth !== currentLayout.contentWidth;
        lastMeasuredCommitRef.current = {
          contextKey: currentContext,
          modelRevision: currentRevision,
          eventCount: count,
          columns: currentLayout.columns,
          contentWidth: currentLayout.contentWidth,
        };
        if (forceRead) {
          mountedCellByViewIdRef.current.forEach((_cell, viewId) => {
            const index = indexOfViewId(viewId);
            if (Number.isInteger(index) && index >= 0 && index < count) {
              affectedRows.add(getMacroEventRowIndex(index, currentLayout.columns));
            }
          });
        } else {
          dirtyMountedRowsRef.current.forEach((row) => affectedRows.add(row));
        }
        dirtyMountedRowsRef.current.clear();
      }

      const changedRows: Array<[number, number]> = [];
      const sortedRows = Array.from(affectedRows).sort((a, b) => a - b);
      for (const row of sortedRows) {
        if (row < 0 || row >= currentLayout.rowCount) continue;
        let rowHeight = MACRO_EVENT_ESTIMATED_ROW_HEIGHT;
        let hasCell = false;
        const end = Math.min(count, (row + 1) * currentLayout.columns);
        // A shrinking tallest cell must still be compared with its siblings.
        for (let index = row * currentLayout.columns; index < end; index++) {
          const cell = mountedCellByViewIdRef.current.get(viewIdOf(index));
          if (!cell) continue;
          hasCell = true;
          let height = cellHeightsRef.current.get(cell);
          if (forceRead || height === undefined) {
            height = readCellHeight(cell);
            cellHeightsRef.current.set(cell, height);
          }
          rowHeight = Math.max(rowHeight, height);
        }
        if (!hasCell) continue;
        const previousHeight =
          rowHeightsRef.current.get(row) ?? MACRO_EVENT_ESTIMATED_ROW_HEIGHT;
        if (rowHeight !== previousHeight) {
          changedRows.push([row, rowHeight]);
        } else if (!rowHeightsRef.current.has(row)) {
          rowHeightsRef.current.set(row, rowHeight);
        }
      }

      if (
        changedRows.length === 0 &&
        !stickToEndRef.current &&
        pendingRestoreAnchorRef.current === null
      ) {
        return;
      }
      const anchorBefore =
        pendingRestoreAnchorRef.current ??
        activeScrollAnchorRef.current ??
        computeAnchorFromCurrentScroll();
      const anchorEventIndex = resolveAnchorEventIndex(anchorBefore);
      const anchorRowIndex =
        anchorEventIndex >= 0
          ? getMacroEventRowIndex(anchorEventIndex, currentLayout.columns)
          : -1;
      let changedAboveAnchor = false;
      const anyRowChanged = changedRows.length > 0;
      for (const [rowIndex, measuredHeight] of changedRows) {
        rowHeightsRef.current.set(rowIndex, measuredHeight);
        virtualizer.resizeItem(rowIndex, measuredHeight);
        if (anchorRowIndex >= 0 && rowIndex < anchorRowIndex) {
          changedAboveAnchor = true;
        }
      }

      if (!scroller) {
        return;
      }

      if (stickToEndRef.current) {
        const endOffset = Math.max(
          scroller.scrollHeight,
          virtualizer.getTotalSize(),
        );
        writeProgrammaticScrollTop(scroller, endOffset);
        activeScrollAnchorRef.current = computeAnchorFromCurrentScroll();
        return;
      }

      if (pendingRestoreAnchorRef.current !== null) {
        const toRestore = pendingRestoreAnchorRef.current;
        pendingRestoreAnchorRef.current = null;
        applyAnchorToScroller(toRestore);
      } else if (changedAboveAnchor && anchorBefore !== null) {
        applyAnchorToScroller(anchorBefore);
      } else if (anyRowChanged && activeScrollAnchorRef.current === null) {
        activeScrollAnchorRef.current = computeAnchorFromCurrentScroll();
      }
    },
    [
      applyAnchorToScroller,
      computeAnchorFromCurrentScroll,
      resolveAnchorEventIndex,
      scrollerRef,
      virtualizer,
      writeProgrammaticScrollTop,
    ],
  );

  const ensureRowVisibleInScroller = useCallback(
    (rowIndex: number, align: 'start' | 'center' | 'end' | 'auto' = 'auto') => {
      const scroller = scrollerRef.current;
      const currentLayout = layoutRef.current;
      if (
        !scroller ||
        rowIndex < 0 ||
        rowIndex >= currentLayout.rowCount
      ) {
        return;
      }
      stickToEndRef.current = false;
      const measurements = getRowMeasurements();
      const item = measurements[rowIndex];
      if (!item) {
        return;
      }
      const viewportHeight =
        scroller.clientHeight > 0
          ? scroller.clientHeight
          : currentLayout.clientHeight > 0
          ? currentLayout.clientHeight
          : 0;
      const currentScrollTop = scroller.scrollTop;
      const padStart = currentLayout.scrollPadding.scrollPaddingStart;
      const padEnd = currentLayout.scrollPadding.scrollPaddingEnd;

      let effectiveAlign = align;
      if (effectiveAlign === 'auto') {
        if (viewportHeight <= 0) {
          effectiveAlign = 'start';
        } else if (item.end + padEnd > currentScrollTop + viewportHeight) {
          effectiveAlign = 'end';
        } else if (item.start - padStart < currentScrollTop) {
          effectiveAlign = 'start';
        } else {
          activeScrollAnchorRef.current = computeAnchorFromCurrentScroll();
          return;
        }
      }

      let rawTarget: number;
      if (effectiveAlign === 'start' || viewportHeight <= 0) {
        rawTarget = item.start - padStart;
      } else if (effectiveAlign === 'end') {
        rawTarget = item.end + padEnd - viewportHeight;
      } else {
        rawTarget = item.start + (item.size - viewportHeight) / 2;
      }

      const domMaxOffset =
        scroller.scrollHeight > scroller.clientHeight
          ? scroller.scrollHeight - scroller.clientHeight
          : 0;
      const virtualMaxOffset = Math.max(
        0,
        virtualizer.getTotalSize() - viewportHeight,
      );
      const maxOffset = Math.max(domMaxOffset, virtualMaxOffset, 0);
      const targetOffset = Math.max(0, Math.min(maxOffset, rawTarget));

      writeProgrammaticScrollTop(scroller, targetOffset);
      activeScrollAnchorRef.current = computeAnchorFromCurrentScroll();
    },
    [computeAnchorFromCurrentScroll, getRowMeasurements, scrollerRef, virtualizer, writeProgrammaticScrollTop],
  );

  const getControlKindsForIndex = useCallback(
    (eventIndex: number): readonly MacroEventControlKind[] => {
      const {
        disabled: isDisabled,
        eventCount: count,
        getEventControlKinds: customKinds,
        getEventKind: kindOf,
      } = latestPropsRef.current;
      if (isDisabled || eventIndex < 0 || eventIndex >= count) {
        return [];
      }
      if (customKinds) {
        return customKinds(eventIndex);
      }
      if (kindOf) {
        return kindOf(eventIndex) === 'delay'
          ? ['delay-input', 'delete']
          : ['delete'];
      }
      const cell = gridRef.current?.querySelector<HTMLElement>(
        `[data-macro-event="${eventIndex}"]`,
      );
      if (cell?.querySelector('input:not(:disabled)')) {
        return ['delay-input', 'delete'];
      }
      return ['delete'];
    },
    [],
  );

  const findFirstLogicalTarget = useCallback((): MacroFocusTarget | null => {
    const {eventCount: count, getViewId: viewIdOf} = latestPropsRef.current;
    for (let i = 0; i < count; i++) {
      const kinds = getControlKindsForIndex(i);
      if (kinds.length > 0) {
        return {
          eventIndex: i,
          viewId: viewIdOf(i),
          controlKind: kinds[0],
        };
      }
    }
    return null;
  }, [getControlKindsForIndex]);

  const findLastLogicalTarget = useCallback((): MacroFocusTarget | null => {
    const {eventCount: count, getViewId: viewIdOf} = latestPropsRef.current;
    for (let i = count - 1; i >= 0; i--) {
      const kinds = getControlKindsForIndex(i);
      if (kinds.length > 0) {
        return {
          eventIndex: i,
          viewId: viewIdOf(i),
          controlKind: kinds[kinds.length - 1],
        };
      }
    }
    return null;
  }, [getControlKindsForIndex]);

  const findAdjacentLogicalTarget = useCallback(
    (
      fromIndex: number,
      fromKind: MacroEventControlKind,
      direction: 1 | -1,
    ): MacroFocusTarget | null => {
      const {eventCount: count, getViewId: viewIdOf} = latestPropsRef.current;
      if (count <= 0) {
        return null;
      }
      const currentKinds = getControlKindsForIndex(fromIndex);
      const pos = currentKinds.indexOf(fromKind);
      if (pos !== -1) {
        const nextPos = pos + direction;
        if (nextPos >= 0 && nextPos < currentKinds.length) {
          return {
            eventIndex: fromIndex,
            viewId: viewIdOf(fromIndex),
            controlKind: currentKinds[nextPos],
          };
        }
      }
      for (
        let i = fromIndex + direction;
        i >= 0 && i < count;
        i += direction
      ) {
        const kinds = getControlKindsForIndex(i);
        if (kinds.length > 0) {
          return {
            eventIndex: i,
            viewId: viewIdOf(i),
            controlKind: direction > 0 ? kinds[0] : kinds[kinds.length - 1],
          };
        }
      }
      return null;
    },
    [getControlKindsForIndex],
  );

  const navigateToTarget = useCallback(
    (target: MacroFocusTarget) => {
      const {
        disabled: isDisabled,
        eventCount: count,
        getViewId: viewIdOf,
        getIndexForViewId: indexOfViewId,
      } = latestPropsRef.current;
      if (isDisabled || count <= 0) {
        return;
      }
      const resolvedIndex =
        target.viewId !== undefined
          ? indexOfViewId(target.viewId)
          : target.eventIndex;
      const validIndex =
        resolvedIndex >= 0 && resolvedIndex < count
          ? resolvedIndex
          : target.eventIndex >= 0 && target.eventIndex < count
          ? target.eventIndex
          : -1;
      if (validIndex < 0) {
        return;
      }
      const normalizedTarget: MacroFocusTarget = {
        ...target,
        eventIndex: validIndex,
        viewId: viewIdOf(validIndex),
      };
      const targetRow = getMacroEventRowIndex(
        validIndex,
        layoutRef.current.columns,
      );
      ensureRowVisibleInScroller(targetRow, 'auto');

      const cell = gridRef.current?.querySelector<HTMLElement>(
        `[data-macro-event="${validIndex}"]`,
      );
      const controlEl = findControlElementInCell(
        cell,
        normalizedTarget.controlKind,
      );
      if (controlEl) {
        setFocusedTarget(normalizedTarget);
        setPendingNavTarget(null);
        controlEl.focus({preventScroll: true});
        if (
          normalizedTarget.controlKind === 'delay-input' &&
          controlEl instanceof HTMLInputElement &&
          normalizedTarget.selectionStart != null
        ) {
          try {
            controlEl.setSelectionRange(
              normalizedTarget.selectionStart,
              normalizedTarget.selectionEnd ?? normalizedTarget.selectionStart,
            );
          } catch {
            // Number inputs in some browsers do not support setSelectionRange.
          }
        }
        ensureRowVisibleInScroller(targetRow, 'auto');
      } else {
        setPendingNavTarget(normalizedTarget);
      }
    },
    [ensureRowVisibleInScroller, setFocusedTarget, setPendingNavTarget],
  );

  // Set up ResizeObserver for mounted cells only.
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const map = new Map<Element, ResizeObserverEntry>();
      for (let i = 0; i < entries.length; i++) {
        map.set(entries[i].target, entries[i]);
      }
      measureMountedRows(map, false);
    });
    cellObserverRef.current = observer;
    mountedCellByViewIdRef.current.forEach((cell) => {
      observer.observe(cell, {box: 'border-box'});
    });
    return () => {
      observer.disconnect();
      cellObserverRef.current = null;
    };
  }, [measureMountedRows]);

  // Observe scroller size changes and track user scroll position for the single scroll-anchor owner.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const updateSize = () => {
      const nextWidth = scroller.clientWidth;
      const nextHeight = scroller.clientHeight;
      setScrollerSize((prev) =>
        prev.clientWidth === nextWidth && prev.clientHeight === nextHeight
          ? prev
          : {clientWidth: nextWidth, clientHeight: nextHeight},
      );
    };
    updateSize();

    const onScroll = () => {
      const currentTop = scroller.scrollTop;
      if (
        programmaticScrollTopRef.current !== null &&
        Math.abs(currentTop - programmaticScrollTopRef.current) < 1.5
      ) {
        programmaticScrollTopRef.current = null;
        return;
      }
      programmaticScrollTopRef.current = null;
      stickToEndRef.current = false;
      activeScrollAnchorRef.current = computeAnchorFromCurrentScroll();
    };

    scroller.addEventListener('scroll', onScroll, {passive: true});
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(scroller);
    }
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      resizeObserver?.disconnect();
    };
  }, [computeAnchorFromCurrentScroll, scrollerRef]);

  // Context key changes (slot/mode/device/generation): cancel pending focus/scroll and clear measurements.
  const prevContextKeyRef = useRef(contextKey);
  useLayoutEffect(() => {
    if (prevContextKeyRef.current === contextKey) {
      return;
    }
    prevContextKeyRef.current = contextKey;
    stickToEndRef.current = false;
    pendingRestoreAnchorRef.current = null;
    activeScrollAnchorRef.current = null;
    forceFocusRestoreRef.current = false;
    setPendingNavTarget(null);
    setFocusedTarget(null);
    virtualizer.cancelScroll();
    clearMeasurementCaches();
    const scroller = scrollerRef.current;
    if (scroller) {
      writeProgrammaticScrollTop(scroller, 0);
    }
  }, [
    clearMeasurementCaches,
    contextKey,
    scrollerRef,
    setFocusedTarget,
    setPendingNavTarget,
    virtualizer,
    writeProgrammaticScrollTop,
  ]);

  // Invalidate all seen and unseen row size caches when contentWidth or columns change.
  const prevWidthStateRef = useRef({
    contentWidth,
    columns,
    contextKey,
  });
  useLayoutEffect(() => {
    const prev = prevWidthStateRef.current;
    prevWidthStateRef.current = {contentWidth, columns, contextKey};
    if (prev.contextKey !== contextKey) {
      return;
    }
    if (prev.contentWidth !== contentWidth || prev.columns !== columns) {
      if (
        pendingRestoreAnchorRef.current === null &&
        activeScrollAnchorRef.current !== null
      ) {
        pendingRestoreAnchorRef.current = activeScrollAnchorRef.current;
      }
      clearMeasurementCaches();
    }
  }, [clearMeasurementCaches, columns, contentWidth, contextKey]);

  // Invalidate all seen and unseen row size caches on late font load.
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) {
      return;
    }
    const onFontsLoaded = () => {
      if (
        pendingRestoreAnchorRef.current === null &&
        activeScrollAnchorRef.current !== null
      ) {
        pendingRestoreAnchorRef.current = activeScrollAnchorRef.current;
      }
      clearMeasurementCaches();
      measureMountedRows(undefined, true);
    };
    fonts.addEventListener('loadingdone', onFontsLoaded);
    return () => {
      fonts.removeEventListener('loadingdone', onFontsLoaded);
    };
  }, [clearMeasurementCaches, measureMountedRows]);

  // Prune out-of-range row caches; the post-commit pass remeasures current cells.
  const prevEventCountRef = useRef({eventCount, contextKey});
  useLayoutEffect(() => {
    const prev = prevEventCountRef.current;
    prevEventCountRef.current = {eventCount, contextKey};
    if (prev.contextKey !== contextKey) {
      return;
    }
    if (prev.eventCount !== eventCount) {
      for (const r of rowHeightsRef.current.keys()) {
        if (r >= rowCount) {
          rowHeightsRef.current.delete(r);
        }
      }
    }
  }, [contextKey, eventCount, rowCount]);

  // Clear focus/pending targets if editing becomes disabled or list becomes empty.
  useLayoutEffect(() => {
    if (disabled || eventCount <= 0) {
      if (focusedTargetRef.current !== null) {
        setFocusedTarget(null);
      }
      if (pendingNavTargetRef.current !== null) {
        setPendingNavTarget(null);
      }
    }
  }, [disabled, eventCount, setFocusedTarget, setPendingNavTarget]);

  const virtualItems = virtualizer.getVirtualItems();
  const sortedRowIndices = useMemo(() => {
    if (rowCount <= 0) {
      return [];
    }
    const fromVirtualizer = virtualItems.map((item) => item.index);
    const pins: number[] = [];
    if (focusedRowIndex >= 0 && focusedRowIndex < rowCount) {
      pins.push(focusedRowIndex);
    }
    if (
      pendingNavRowIndex >= 0 &&
      pendingNavRowIndex < rowCount &&
      pendingNavRowIndex !== focusedRowIndex
    ) {
      pins.push(pendingNavRowIndex);
    }
    return mergeMacroRowIndices(fromVirtualizer, pins, rowCount);
  }, [focusedRowIndex, pendingNavRowIndex, rowCount, virtualItems]);

  const renderPlan = useMemo(
    () =>
      computeMacroRowRenderPlan({
        sortedRowIndices,
        rowCount,
        columns,
        eventCount,
        getRowBounds: (r: number): MacroRowBounds | undefined =>
          virtualizer.measurementsCache[r],
        paddingStart: scrollPadding.paddingStart,
        estimateRowHeight: MACRO_EVENT_ESTIMATED_ROW_HEIGHT,
      }),
    [
      columns,
      eventCount,
      rowCount,
      scrollPadding.paddingStart,
      sortedRowIndices,
      virtualItems,
      virtualizer.measurementsCache,
    ],
  );

  // Measure mounted rows and complete pending keyboard navigation / focus restoration after commit.
  useLayoutEffect(() => {
    measureMountedRows(undefined, false);

    const pending = pendingNavTargetRef.current;
    if (pending && !disabled && eventCount > 0) {
      const resolvedIdx = resolveTargetEventIndex(pending);
      if (resolvedIdx < 0) {
        setPendingNavTarget(null);
      } else {
        const targetRow = getMacroEventRowIndex(resolvedIdx, columns);
        ensureRowVisibleInScroller(targetRow, 'auto');
        const cell = gridRef.current?.querySelector<HTMLElement>(
          `[data-macro-event="${resolvedIdx}"]`,
        );
        const controlEl = findControlElementInCell(cell, pending.controlKind);
        if (controlEl) {
          const committedTarget: MacroFocusTarget = {
            ...pending,
            eventIndex: resolvedIdx,
            viewId: getViewId(resolvedIdx),
          };
          setFocusedTarget(committedTarget);
          setPendingNavTarget(null);
          controlEl.focus({preventScroll: true});
          if (
            committedTarget.controlKind === 'delay-input' &&
            controlEl instanceof HTMLInputElement &&
            committedTarget.selectionStart != null
          ) {
            try {
              controlEl.setSelectionRange(
                committedTarget.selectionStart,
                committedTarget.selectionEnd ?? committedTarget.selectionStart,
              );
            } catch {
              // Ignore on browsers that disallow selection range on number inputs.
            }
          }
          ensureRowVisibleInScroller(targetRow, 'auto');
        }
      }
      return;
    }

    if (forceFocusRestoreRef.current && focusedTargetRef.current && !disabled) {
      forceFocusRestoreRef.current = false;
      const currentFocus = focusedTargetRef.current;
      const resolvedIdx = resolveTargetEventIndex(currentFocus);
      if (resolvedIdx >= 0) {
        const cell = gridRef.current?.querySelector<HTMLElement>(
          `[data-macro-event="${resolvedIdx}"]`,
        );
        const controlEl = findControlElementInCell(
          cell,
          currentFocus.controlKind,
        );
        if (controlEl && document.activeElement !== controlEl) {
          controlEl.focus({preventScroll: true});
          if (
            currentFocus.controlKind === 'delay-input' &&
            controlEl instanceof HTMLInputElement &&
            currentFocus.selectionStart != null
          ) {
            try {
              controlEl.setSelectionRange(
                currentFocus.selectionStart,
                currentFocus.selectionEnd ?? currentFocus.selectionStart,
              );
            } catch {
              // Ignore on number inputs.
            }
          }
        }
      }
    }
  }, [
    columns,
     contentWidth,
    disabled,
    ensureRowVisibleInScroller,
    eventCount,
    getViewId,
    measureMountedRows,
    modelRevision,
    renderPlan,
    resolveTargetEventIndex,
    setFocusedTarget,
    setPendingNavTarget,
  ]);

  // Global Tab / Shift+Tab navigation across scroller entry, mounted/unmounted events, and toolbar reverse entry.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const toolbar = toolbarRef?.current;

    const onScrollerKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Tab' ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        latestPropsRef.current.disabled ||
        latestPropsRef.current.eventCount <= 0
      ) {
        return;
      }

      const targetNode = event.target as HTMLElement | null;
      if (!targetNode) {
        return;
      }

      // Forward Tab from the scroller itself enters the actual first logical enabled control (event 0).
      if (targetNode === scroller) {
        if (event.shiftKey) {
          return;
        }
        const firstTarget = findFirstLogicalTarget();
        if (firstTarget) {
          event.preventDefault();
          navigateToTarget(firstTarget);
        }
        return;
      }

      const cell = targetNode.closest<HTMLElement>('[data-macro-event]');
      if (!cell || !gridRef.current?.contains(cell)) {
        return;
      }
      const rawEventIndex = cell.getAttribute('data-macro-event');
      if (rawEventIndex === null) {
        return;
      }
      const currentIndex = Number(rawEventIndex);
      if (!Number.isInteger(currentIndex)) {
        return;
      }
      const currentKind: MacroEventControlKind =
        targetNode.tagName === 'INPUT' ? 'delay-input' : 'delete';
      const direction: 1 | -1 = event.shiftKey ? -1 : 1;
      const nextTarget = findAdjacentLogicalTarget(
        currentIndex,
        currentKind,
        direction,
      );

      if (nextTarget) {
        event.preventDefault();
        navigateToTarget(nextTarget);
        return;
      }

      if (direction === -1) {
        // Shift+Tab before the actual first logical control moves back to the scroller.
        event.preventDefault();
        setPendingNavTarget(null);
        setFocusedTarget(null);
        scroller?.focus({preventScroll: true});
        return;
      }

      // Forward Tab past the actual last logical control moves to the first enabled toolbar control if present.
      const firstToolbarControl = getFirstFocusableToolbarControl(
        toolbarRef?.current,
      );
      setPendingNavTarget(null);
      setFocusedTarget(null);
      if (firstToolbarControl) {
        event.preventDefault();
        firstToolbarControl.focus({preventScroll: true});
      }
    };

    const onToolbarKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Tab' ||
        !event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        latestPropsRef.current.disabled ||
        latestPropsRef.current.eventCount <= 0
      ) {
        return;
      }
      const firstToolbarControl = getFirstFocusableToolbarControl(toolbar);
      if (!firstToolbarControl || event.target !== firstToolbarControl) {
        return;
      }
      const lastTarget = findLastLogicalTarget();
      if (lastTarget) {
        event.preventDefault();
        navigateToTarget(lastTarget);
      }
    };

    scroller?.addEventListener('keydown', onScrollerKeyDown);
    toolbar?.addEventListener('keydown', onToolbarKeyDown);
    return () => {
      scroller?.removeEventListener('keydown', onScrollerKeyDown);
      toolbar?.removeEventListener('keydown', onToolbarKeyDown);
    };
  }, [
    findAdjacentLogicalTarget,
    findFirstLogicalTarget,
    findLastLogicalTarget,
    navigateToTarget,
    scrollerRef,
    setFocusedTarget,
    setPendingNavTarget,
    toolbarRef,
  ]);

  const handleFocusCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const targetNode = event.target as HTMLElement | null;
      if (!targetNode) {
        return;
      }
      const cell = targetNode.closest<HTMLElement>('[data-macro-event]');
      if (!cell || !gridRef.current?.contains(cell)) {
        return;
      }
      const rawIndex = cell.getAttribute('data-macro-event');
      if (rawIndex === null) {
        return;
      }
      const idx = Number(rawIndex);
      if (
        !Number.isInteger(idx) ||
        idx < 0 ||
        idx >= latestPropsRef.current.eventCount
      ) {
        return;
      }
      const controlKind: MacroEventControlKind =
        targetNode.tagName === 'INPUT' ? 'delay-input' : 'delete';
      const viewId = latestPropsRef.current.getViewId(idx);
      setFocusedTarget({
        eventIndex: idx,
        viewId,
        controlKind,
      });
      if (pendingNavTargetRef.current !== null) {
        setPendingNavTarget(null);
      }
    },
    [setFocusedTarget, setPendingNavTarget],
  );

  const handleBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (pendingNavTargetRef.current !== null) {
        return;
      }
      const related = event.relatedTarget as Node | null;
      if (related && gridRef.current?.contains(related)) {
        return;
      }
      // If relatedTarget is outside the grid (e.g. scroller on delete, toolbar, or outside click), release focus pin.
      if (related !== null) {
        setFocusedTarget(null);
      }
    },
    [setFocusedTarget],
  );

  const getCellRefCallback = useCallback(
    (viewId: MacroEventViewId) => {
      let cb = cellRefCallbacksRef.current.get(viewId);
      if (!cb) {
        cb = (node: HTMLElement | null) => {
          const previous = mountedCellByViewIdRef.current.get(viewId);
          if (previous && previous !== node) {
            cellObserverRef.current?.unobserve(previous);
            viewIdByCellRef.current.delete(previous);
            cellHeightsRef.current.delete(previous);
          }
          if (node) {
            mountedCellByViewIdRef.current.set(viewId, node);
            viewIdByCellRef.current.set(node, viewId);
            const index = latestPropsRef.current.getIndexForViewId(viewId);
            if (index >= 0 && index < latestPropsRef.current.eventCount) {
              dirtyMountedRowsRef.current.add(
                getMacroEventRowIndex(index, layoutRef.current.columns),
              );
            }
            if (previous !== node) {
              cellObserverRef.current?.observe(node, {box: 'border-box'});
            }
          } else {
            mountedCellByViewIdRef.current.delete(viewId);
            cellRefCallbacksRef.current.delete(viewId);
          }
        };
        cellRefCallbacksRef.current.set(viewId, cb);
      }
      return cb;
    },
    [],
  );

  useImperativeHandle(
    ref,
    (): MacroEventViewportHandle => ({
      captureSnapshot: () => {
        const anchor =
          activeScrollAnchorRef.current ?? computeAnchorFromCurrentScroll();
        let focus = focusedTargetRef.current;
        if (focus) {
          const resolvedIdx = resolveTargetEventIndex(focus);
          if (resolvedIdx >= 0) {
            const cell = gridRef.current?.querySelector<HTMLElement>(
              `[data-macro-event="${resolvedIdx}"]`,
            );
            const inputEl =
              focus.controlKind === 'delay-input'
                ? cell?.querySelector<HTMLInputElement>('input')
                : null;
            focus = {
              ...focus,
              eventIndex: resolvedIdx,
              viewId: latestPropsRef.current.getViewId(resolvedIdx),
              selectionStart: inputEl?.selectionStart ?? null,
              selectionEnd: inputEl?.selectionEnd ?? null,
            };
          }
        }
        const pendingNavigation = pendingNavTargetRef.current;
        return {
          contextKey: latestPropsRef.current.contextKey,
          modelRevision:
            typeof latestPropsRef.current.modelRevision === 'string' ||
            typeof latestPropsRef.current.modelRevision === 'number'
              ? latestPropsRef.current.modelRevision
              : undefined,
          anchor,
          focus,
          pendingNavigation,
        };
      },
      captureScrollAnchor: () =>
        activeScrollAnchorRef.current ?? computeAnchorFromCurrentScroll(),
      restoreSnapshot: (snapshot) => {
        if (
          snapshot.contextKey !== undefined &&
          snapshot.contextKey !== latestPropsRef.current.contextKey
        ) {
          return;
        }
        if (snapshot.invalidateUnseenMeasurements) {
          clearMeasurementCaches();
        }
        if ('anchor' in snapshot) {
          pendingRestoreAnchorRef.current = snapshot.anchor ?? null;
          if (snapshot.anchor) {
            applyAnchorToScroller(snapshot.anchor);
          }
        }
        if ('focus' in snapshot) {
          const nextFocus = snapshot.focus ?? null;
          forceFocusRestoreRef.current = nextFocus !== null;
          setFocusedTarget(nextFocus);
        }
        if ('pendingNavigation' in snapshot) {
          setPendingNavTarget(snapshot.pendingNavigation ?? null);
        }
      },
      restoreScrollAnchor: (anchor, options) => {
        if (
          options?.contextKey !== undefined &&
          options.contextKey !== latestPropsRef.current.contextKey
        ) {
          return;
        }
        if (options?.invalidateUnseenMeasurements) {
          clearMeasurementCaches();
        }
        pendingRestoreAnchorRef.current = anchor;
        if (anchor) {
          applyAnchorToScroller(anchor);
        }
      },
      focusEventControl: (target) => {
        navigateToTarget(target);
      },
      scrollToEvent: (eventIndex, align = 'auto') => {
        if (
          eventIndex < 0 ||
          eventIndex >= latestPropsRef.current.eventCount
        ) {
          return;
        }
        const targetRow = getMacroEventRowIndex(
          eventIndex,
          layoutRef.current.columns,
        );
        ensureRowVisibleInScroller(targetRow, align);
      },
      scrollToStart: () => {
        stickToEndRef.current = false;
        pendingRestoreAnchorRef.current = null;
        const scroller = scrollerRef.current;
        if (scroller) {
          writeProgrammaticScrollTop(scroller, 0);
        }
        activeScrollAnchorRef.current = computeAnchorFromCurrentScroll();
      },
      scrollToEnd: () => {
        pendingRestoreAnchorRef.current = null;
        stickToEndRef.current = true;
        virtualizer.scrollToEnd({behavior: 'auto'});
        const scroller = scrollerRef.current;
        if (scroller) {
          const endOffset = Math.max(
            scroller.scrollHeight,
            virtualizer.getTotalSize(),
          );
          writeProgrammaticScrollTop(scroller, endOffset);
        }
        activeScrollAnchorRef.current = computeAnchorFromCurrentScroll();
      },
      invalidateMeasurements: () => {
        if (
          pendingRestoreAnchorRef.current === null &&
          activeScrollAnchorRef.current !== null
        ) {
          pendingRestoreAnchorRef.current = activeScrollAnchorRef.current;
        }
        clearMeasurementCaches();
        measureMountedRows(undefined, true);
      },
      getLayoutGeometry: () => layoutRef.current,
    }),
    [
      applyAnchorToScroller,
      clearMeasurementCaches,
      computeAnchorFromCurrentScroll,
      ensureRowVisibleInScroller,
      measureMountedRows,
      navigateToTarget,
      resolveTargetEventIndex,
      scrollerRef,
      setFocusedTarget,
      setPendingNavTarget,
      virtualizer,
      writeProgrammaticScrollTop,
    ],
  );

  if (eventCount <= 0 || rowCount <= 0) {
    return <>{emptyState}</>;
  }

  const gridChildren: React.ReactNode[] = [];
  const {segments, trailingSpacer} = renderPlan;

  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    if (segment.leadingSpacer) {
      gridChildren.push(
        <ViewportSpacer
          key={segment.leadingSpacer.key}
          aria-hidden="true"
          data-macro-spacer={`${segment.leadingSpacer.startRow}-${segment.leadingSpacer.endRow}`}
          style={{height: `${segment.leadingSpacer.heightPx}px`}}
        />,
      );
    }
    for (
      let eventIndex = segment.startEventIndex;
      eventIndex < segment.endEventIndexExclusive;
      eventIndex++
    ) {
      const viewId = getViewId(eventIndex);
      const rowIndex = getMacroEventRowIndex(eventIndex, columns);
      const cellProps: MacroEventCellProps = {
        key: viewId,
        ref: getCellRefCallback(viewId),
        'data-macro-event': eventIndex,
        'data-macro-view-id': String(viewId),
        'data-macro-row': rowIndex,
      };
      const node = renderEvent(eventIndex, viewId, cellProps);
      if (React.isValidElement(node) && node.key !== String(viewId)) {
        gridChildren.push(React.cloneElement(node, {key: viewId}));
      } else {
        gridChildren.push(node);
      }
    }
  }

  if (trailingSpacer) {
    gridChildren.push(
      <ViewportSpacer
        key={trailingSpacer.key}
        aria-hidden="true"
        data-macro-spacer={`${trailingSpacer.startRow}-${trailingSpacer.endRow}`}
        style={{height: `${trailingSpacer.heightPx}px`}}
      />,
    );
  }

  return (
    <ViewportGrid
      ref={gridRef}
      $gridTemplateColumns={layout.viewportGridTemplateColumns}
      data-macro-viewport-grid=""
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      {gridChildren}
    </ViewportGrid>
  );
});
