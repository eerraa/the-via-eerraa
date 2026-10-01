import {
  createContext,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
} from 'react';
import {DisplayMode} from 'src/types/keyboard-rendering';
import {createGlobalStyle, css} from 'styled-components';
import {calculateKeyboardFrameDimensions, CSSVarObject} from './keyboard-rendering';
import {ANSI_TEST_LAYOUT, getTestKeyboardKeys} from './key-event';

export const KEYBOARD_AREA_MAX_HEIGHT = 500;
/** The keyboard canvases, their hidden offset and the layer column share it. */
export const keyboardAreaHeight = `var(--keyboard-area-height, ${KEYBOARD_AREA_MAX_HEIGHT}px)`;

export const KeyboardAreaStyle = createGlobalStyle<{
  $height: number;
  $scrollPage?: boolean;
}>`
  :root {
    --keyboard-area-height: ${(props) => props.$height}px;
  }

  ${(props) => props.$scrollPage && css`
    @media (max-height: ${props.$height + 250}px) {
      body {
        overflow-y: auto;
      }

      #root {
        height: auto;
        min-height: 100%;
      }

      #root > [data-routed-keyboard-pane] {
        flex: none;
        height: auto;
        overflow: visible;
      }

      #root > [data-routed-keyboard-pane] > [data-pane-grid] {
        height: auto;
      }
    }
  `}
`;
// Room above and below the case for the layer row and badges over it and the
// test note under it: the band a full-size board has in the tallest area.
const KEYBOARD_AREA_RESERVE = 54;
// Horizontal room the keyboard canvases keep beside the case.
const KEYBOARD_CANVAS_PADDING = 70;

type KeyboardFrame = {width: number; height: number};

const AREA_MODES = [DisplayMode.Configure, DisplayMode.Test, DisplayMode.Design];
// The ordinary tester remains the reference even when matrix testing is chosen,
// or a download-only browser has no routed canvas mounted.
const TEST_FRAME = calculateKeyboardFrameDimensions(
  getTestKeyboardKeys(ANSI_TEST_LAYOUT),
);

// Only the app's routed keyboards own this area; firmware previews also use
// KeyboardCanvas in Design mode but must not replace the design route's frame.
export const KeyboardAreaContext = createContext(false);

const frames = new Map<DisplayMode, KeyboardFrame>();
const listeners = new Set<() => void>();
let revision = 0;

const isUsableFrame = (frame: KeyboardFrame) =>
  Number.isFinite(frame.width) &&
  Number.isFinite(frame.height) &&
  frame.width > 0 &&
  frame.height > 0;

const setFrame = (mode: DisplayMode, frame: KeyboardFrame | null) => {
  if (frame && !isUsableFrame(frame)) {
    frame = null;
  }
  const current = frames.get(mode);
  if (
    frame
      ? current?.width === frame.width && current?.height === frame.height
      : !current
  ) {
    return;
  }
  if (frame) {
    frames.set(mode, frame);
  } else {
    frames.delete(mode);
  }
  revision++;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getRevision = () => revision;

/**
 * Height of the keyboard area for a frame, in key units, drawn in a window
 * `containerWidth` wide: the case at the size its width allows plus the
 * reserve, never taller than the classic area. Never below the height at
 * which the canvases would shrink the keys.
 */
export const getKeyboardAreaHeight = (
  frame: KeyboardFrame | undefined,
  containerWidth: number | undefined,
) => {
  if (!frame || !isUsableFrame(frame) || !containerWidth) {
    return KEYBOARD_AREA_MAX_HEIGHT;
  }
  const scale = Math.min(
    1,
    containerWidth /
      (CSSVarObject.keyXPos * frame.width -
        CSSVarObject.keyXSpacing +
        KEYBOARD_CANVAS_PADDING),
  );
  const caseHeight =
    CSSVarObject.keyYPos * frame.height -
    CSSVarObject.keyYSpacing +
    CSSVarObject.insideBorder * 3;
  return Math.min(
    KEYBOARD_AREA_MAX_HEIGHT,
    Math.ceil(scale * caseHeight + KEYBOARD_AREA_RESERVE * 2),
  );
};

export const getSharedKeyboardAreaHeight = (
  areaFrames: Iterable<KeyboardFrame>,
  containerWidth: number | undefined,
) =>
  Math.max(
    getKeyboardAreaHeight(TEST_FRAME, containerWidth),
    ...Array.from(areaFrames)
      .filter(isUsableFrame)
      .map((frame) => getKeyboardAreaHeight(frame, containerWidth)),
  );

/** The mounted keyboard of a route tells the area how big it is. */
export const useReportKeyboardFrame = (
  mode: DisplayMode,
  width: number,
  height: number,
) => {
  const inKeyboardArea = useContext(KeyboardAreaContext);
  const reports = inKeyboardArea && AREA_MODES.includes(mode);
  useLayoutEffect(() => {
    if (!reports) {
      return;
    }
    setFrame(mode, {width, height});
    return () => setFrame(mode, null);
  }, [reports, mode, width, height]);
};

export const useKeyboardAreaHeight = (
  containerWidth: number | undefined,
) => {
  useSyncExternalStore(subscribe, getRevision, getRevision);
  // A whole-page scrollbar must not change the common height when another
  // route uses an internal scrollbar. Element measurements still trigger resize.
  const viewportWidth =
    typeof window === 'undefined'
      ? containerWidth
      : window.innerWidth || containerWidth;
  return getSharedKeyboardAreaHeight(frames.values(), viewportWidth);
};
