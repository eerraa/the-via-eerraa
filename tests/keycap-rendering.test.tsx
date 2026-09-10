import './setup';
import {afterEach, beforeEach, describe, expect, mock, test} from 'bun:test';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Keycap} from '../src/components/two-string/unit-key/keycap';
import {
  DisplayMode,
  type TwoStringKeycapProps,
} from '../src/types/keyboard-rendering';
import {useSkipFontCheck} from '../src/utils/use-skip-font-check';

const originalDocument = Object.getOwnPropertyDescriptor(
  globalThis,
  'document',
);
const originalPixelRatio = Object.getOwnPropertyDescriptor(
  globalThis,
  'devicePixelRatio',
);
const latinLabel = {key: 'KC_A', label: 'A'};
const arrowLabel = {key: 'KC_LEFT', label: '←'};
const noop = () => {};
const keyProps: Omit<TwoStringKeycapProps, 'key'> = {
  label: latinLabel,
  scale: [1, 1, 1],
  color: {c: '#cccccc', t: '#111111'},
  selected: false,
  disabled: false,
  mode: DisplayMode.Configure,
  rotation: [0, 0, 0],
  position: [0, 0, 0],
  keyState: -1,
  shouldRotate: false,
  textureWidth: 1,
  textureHeight: 1,
  textureOffsetX: 0,
  skipFontCheck: false,
  idx: 0,
  clipPath: null,
  onClick: noop,
};

const FontKeycap = (props: Partial<TwoStringKeycapProps>) => {
  const skipFontCheck = useSkipFontCheck();
  return (
    <Keycap
      key="keycap"
      {...keyProps}
      {...props}
      skipFontCheck={skipFontCheck}
    />
  );
};

let renderer: ReactTestRenderer | undefined;
let fonts: EventTarget & {
  load: ReturnType<typeof mock>;
  check: ReturnType<typeof mock>;
};
let fontAvailable: boolean;
let resolveFont: () => void;
let rejectFont: (error: Error) => void;
let fillText: ReturnType<typeof mock>;
let canvas: object;

beforeEach(() => {
  fontAvailable = false;
  const fontLoad = new Promise<void>((resolve, reject) => {
    resolveFont = resolve;
    rejectFont = reject;
  });
  fonts = Object.assign(new EventTarget(), {
    load: mock(() => fontLoad),
    // The arrow subset can be available while the Latin face is not.
    check: mock((_font: string, text: string) => fontAvailable || text === '←'),
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {fonts},
  });
  Object.defineProperty(globalThis, 'devicePixelRatio', {
    configurable: true,
    value: 1,
  });
  fillText = mock(() => {});
  const context = {
    scale: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    clip: noop,
    fillText,
    measureText: () => ({width: 10}),
  };
  canvas = {width: 300, height: 150, style: {}, getContext: () => context};
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  for (const [name, original] of [
    ['document', originalDocument],
    ['devicePixelRatio', originalPixelRatio],
  ] as const) {
    if (original) {
      Object.defineProperty(globalThis, name, original);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
});

const render = (props: Partial<TwoStringKeycapProps> = {}) => {
  act(() => {
    const element = <FontKeycap {...props} />;
    if (renderer) {
      renderer.update(element);
    } else {
      renderer = create(element, {
        createNodeMock: (node) => (node.type === 'canvas' ? canvas : null),
      });
    }
  });
};

describe('2D keycap font lifecycle', () => {
  test('loads the font with the size and weight used by the canvas check', () => {
    render();
    expect(fonts.load).toHaveBeenCalledWith('bold 16px "Fira Sans"');
  });

  test('paints the initial layer on font failure after a readiness rerender', async () => {
    render({disabled: true});
    // Configure becomes selectable while the same keymap is already present.
    // The canvas ref is now attached; this render must not freeze fallback=false.
    render({disabled: false});
    expect(fillText).not.toHaveBeenCalled();

    await act(async () => rejectFont(new Error('Font download failed')));
    expect(fillText).toHaveBeenCalledWith(
      'A',
      expect.any(Number),
      expect.any(Number),
    );
    // No layer switch or device read is needed to make the accepted label visible.
  });

  test('repaints the current layer when fonts finish and removes its listener on unmount', async () => {
    render({label: arrowLabel});
    expect(fillText).toHaveBeenCalledWith(
      '←',
      expect.any(Number),
      expect.any(Number),
    );
    fillText.mockClear();
    render({label: latinLabel});
    expect(fillText).not.toHaveBeenCalled();

    fontAvailable = true;
    await act(async () => {
      resolveFont();
      fonts.dispatchEvent(new Event('loadingdone'));
    });
    expect(fillText).toHaveBeenCalledWith(
      'A',
      expect.any(Number),
      expect.any(Number),
    );

    act(() => renderer!.unmount());
    renderer = undefined;
    fillText.mockClear();
    act(() => fonts.dispatchEvent(new Event('loadingdone')));
    expect(fillText).not.toHaveBeenCalled();
  });
});
