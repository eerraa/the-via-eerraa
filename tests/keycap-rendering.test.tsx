import './setup';
import {expect, mock, test} from 'bun:test';
import {act, create} from 'react-test-renderer';
import {Keycap} from '../src/components/two-string/unit-key/keycap';
import {
  DisplayMode,
  type TwoStringKeycapProps,
} from '../src/types/keyboard-rendering';
import {keycapLegend} from '../src/utils/keycap-legend';
import {useSkipFontCheck} from '../src/utils/use-skip-font-check';

const noop = () => {};
const keyLabel = (code: string, name: string, shortName?: string) => ({
  ...keycapLegend({type: 'named', code, name, shortName}),
  key: code,
});
const keyProps: Omit<TwoStringKeycapProps, 'key'> = {
  label: keyLabel('KC_A', 'A'),
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
const FontKeycap = (props: Partial<TwoStringKeycapProps>) => (
  <Keycap
    key="keycap"
    {...keyProps}
    {...props}
    skipFontCheck={useSkipFontCheck()}
  />
);

test('the current key label appears after either font load or failure without another device read', async () => {
  const originals = ['document', 'devicePixelRatio'].map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  try {
    for (const succeeds of [true, false]) {
      let finish!: () => void;
      let fail!: (error: Error) => void;
      let available = false;
      const load = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      const fonts = Object.assign(new EventTarget(), {
        load: () => load,
        check: (_font: string, text: string) => available || text === '←',
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {fonts},
      });
      Object.defineProperty(globalThis, 'devicePixelRatio', {
        configurable: true,
        value: 1,
      });
      const fillText = mock(noop);
      const canvas = {
        width: 300,
        height: 150,
        style: {},
        getContext: () => ({
          scale: noop,
          beginPath: noop,
          moveTo: noop,
          lineTo: noop,
          clip: noop,
          fillText,
          measureText: () => ({width: 10}),
        }),
      };
      let renderer!: ReturnType<typeof create>;
      try {
        act(() => {
          renderer = create(
            <FontKeycap label={keyLabel('KC_LEFT', 'Left', '←')} />,
            {
              createNodeMock: (node) =>
                node.type === 'canvas' ? canvas : null,
            },
          );
        });
        expect(fillText).toHaveBeenCalledWith(
          '←',
          expect.any(Number),
          expect.any(Number),
        );
        fillText.mockClear();
        act(() => renderer.update(<FontKeycap disabled={true} />));
        act(() => renderer.update(<FontKeycap disabled={false} />));
        expect(fillText).not.toHaveBeenCalled();
        await act(async () => {
          if (succeeds) {
            available = true;
            finish();
            fonts.dispatchEvent(new Event('loadingdone'));
          } else {
            fail(new Error('Font download failed'));
          }
        });
        expect(fillText).toHaveBeenCalledWith(
          'A',
          expect.any(Number),
          expect.any(Number),
        );
      } finally {
        act(() => renderer.unmount());
      }
      fillText.mockClear();
      act(() => fonts.dispatchEvent(new Event('loadingdone')));
      expect(fillText).not.toHaveBeenCalled();
    }
  } finally {
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

// KEYMAP's corner describes the keyboard key under the pointer: a key there says
// when the pointer reaches and leaves it.
test('a KEYMAP key reports the pointer reaching and leaving it', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {fonts: Object.assign(new EventTarget(), {check: () => true})},
  });
  try {
    const onHover = mock(noop);
    for (const mode of [DisplayMode.Configure, DisplayMode.Test]) {
      let renderer!: ReturnType<typeof create>;
      act(() => {
        renderer = create(
          <Keycap
            key="keycap"
            {...keyProps}
            mode={mode}
            idx={3}
            onHover={onHover}
          />,
        );
      });
      const key = renderer.root.find(
        (node) =>
          node.type === 'div' && typeof node.props.onPointerOver === 'function',
      );
      act(() => key.props.onPointerOver({}));
      act(() => key.props.onPointerOut({}));
      act(() => renderer.unmount());
    }
    // The key tester's keyboard says nothing.
    expect(onHover.mock.calls).toEqual([
      [3, true],
      [3, false],
    ]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
