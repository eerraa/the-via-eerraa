import './setup';
import {afterEach, describe, expect, test} from 'bun:test';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {DisplayMode} from '../src/types/keyboard-rendering';

// Settle the store's import cycle as the application does.
await import('../src/utils/keyboard-api');
const {
  getKeyboardAreaHeight,
  getSharedKeyboardAreaHeight,
  useKeyboardAreaHeight,
  useReportKeyboardFrame,
  KeyboardAreaContext,
} = await import('../src/utils/keyboard-area');
const {getCameraZoom} = await import('../src/components/three-fiber/camera');

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const render = (element: JSX.Element) =>
  act(() => {
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });

// The original canvas ratio: height must not start shrinking a keyboard that
// already fits at the scale its width allows. No viewport-height cap is used.
const canvasScale = (
  width: number,
  height: number,
  areaWidth: number,
  areaHeight: number,
) =>
  Math.min(
    1,
    areaWidth / (54 * width - 2 + 70),
    areaHeight / (56 * height - 2 + 70),
  );

describe('the keyboard area fits the active picture', () => {
  test('removes spare height while preserving the original key scale', () => {
    for (const frame of [
      {width: 16.5, height: 5.25}, // ERA65
      {width: 16.25, height: 6.5}, // Q1
      {width: 23, height: 7},
      {width: 5, height: 10}, // a tall custom definition still uses the 500px cap
    ]) {
      for (const width of [1920, 1536, 1280, 820, 500]) {
        const height = getKeyboardAreaHeight(frame, width);
        expect(height).toBeLessThanOrEqual(500);
        expect(
          canvasScale(frame.width, frame.height, width, height),
        ).toBeCloseTo(canvasScale(frame.width, frame.height, width, 500), 8);
        if (height < 500) {
          const caseHeight =
            (56 * frame.height - 2 + 30) *
            canvasScale(frame.width, frame.height, width, height);
          expect((height - caseHeight) / 2).toBeGreaterThanOrEqual(54);
        }
      }
    }
    expect(getKeyboardAreaHeight({width: 16.5, height: 5.25}, 1920)).toBe(430);
    expect(getKeyboardAreaHeight(undefined, 1920)).toBe(500);
    expect(getKeyboardAreaHeight({width: 16.5, height: 5.25}, undefined)).toBe(
      500,
    );
  });

  test('the 3D camera preserves projected size when the canvas loses spare height', () => {
    for (const height of [500, 430, 384]) {
      expect(height * getCameraZoom(height)).toBeCloseTo(
        500 * getCameraZoom(500),
        8,
      );
    }
    expect(getCameraZoom(0)).toBe(getCameraZoom(500));
  });

  test('shares one height across routes, matrix mode and download-only browsers', () => {
    const Frame = ({mode, height}: {mode: DisplayMode; height: number}) => {
      useReportKeyboardFrame(mode, 16.5, height);
      return null;
    };
    const Reader = ({path, width}: {path: string; width: number}) => (
      <output data-path={path}>{useKeyboardAreaHeight(width)}</output>
    );
    const App = ({path = '/', width = 1920, height = 5.25, shown = true}) => (
      <>
        <Reader path={path} width={width} />
        <KeyboardAreaContext.Provider value={true}>
          {shown && <Frame mode={DisplayMode.Configure} height={height} />}
          <Frame mode={DisplayMode.Test} height={6.5} />
        </KeyboardAreaContext.Provider>
        <Frame mode={DisplayMode.Configure} height={10} />
        <Frame mode={DisplayMode.Design} height={1} />
      </>
    );
    const value = () => Number(renderer!.root.findByType('output').children[0]);
    render(<App />);
    expect(value()).toBe(500);
    for (const path of ['/test', '/design', '/debug', '/firmware/common/era65']) {
      render(<App path={path} />);
      expect(value()).toBe(500);
    }
    render(<App width={820} />);
    const sharedNarrowHeight = getSharedKeyboardAreaHeight([
      {width: 16.5, height: 5.25},
      {width: 16.5, height: 6.5},
    ], 820);
    expect(value()).toBe(sharedNarrowHeight);
    for (const path of ['/test', '/design', '/debug', '/firmware/common/era65']) {
      render(<App path={path} width={820} />);
      expect(value()).toBe(sharedNarrowHeight);
    }
    render(<App height={6.5} />);
    expect(value()).toBe(500);
    render(<App path="/test" />);
    expect(value()).toBe(500);
    render(<App path="/design" />);
    expect(value()).toBe(500);
    render(<App path="/firmware" />);
    expect(value()).toBe(500);
    render(<App shown={false} />);
    expect(value()).toBe(500);
    render(<App />);
    expect(value()).toBe(500);
  });

  test('releases a changed tall layout without retaining a stale frame', () => {
    const Frame = ({height}: {height: number}) => {
      useReportKeyboardFrame(DisplayMode.Configure, 5, height);
      return null;
    };
    const Reader = () => <output>{useKeyboardAreaHeight(500)}</output>;
    const App = ({height = 10, shown = true}) => (
      <>
        <Reader />
        <KeyboardAreaContext.Provider value={true}>
          {shown && <Frame height={height} />}
        </KeyboardAreaContext.Provider>
      </>
    );
    const value = () => Number(renderer!.root.findByType('output').children[0]);
    render(<App />);
    expect(value()).toBe(500);
    render(<App height={3} />);
    const compactHeight = value();
    expect(compactHeight).toBeLessThan(500);
    render(<App shown={false} />);
    expect(value()).toBe(getSharedKeyboardAreaHeight([], 500));
    expect(value()).toBeLessThan(compactHeight);
    for (const height of [NaN, Infinity, -Infinity, 0, -1]) {
      render(<App height={height} />);
      expect(value()).toBe(getSharedKeyboardAreaHeight([], 500));
    }
    render(<App />);
    expect(value()).toBe(500);
  });

  test('page and internal scrollbars use the same window width', () => {
    const previousWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const Reader = ({width}: {width: number}) => (
      <output>{useKeyboardAreaHeight(width)}</output>
    );
    try {
      Object.defineProperty(window, 'innerWidth', {value: 844, configurable: true});
      render(<Reader width={829} />);
      const height = Number(renderer!.root.findByType('output').children[0]);
      render(<Reader width={844} />);
      expect(Number(renderer!.root.findByType('output').children[0])).toBe(height);
      expect(height).toBe(getSharedKeyboardAreaHeight([], 844));
    } finally {
      if (previousWidth) Object.defineProperty(window, 'innerWidth', previousWidth);
      else delete (window as {innerWidth?: number}).innerWidth;
    }
  });
});
