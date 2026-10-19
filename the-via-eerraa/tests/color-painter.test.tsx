import './setup';
import {expect, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {act, create} from 'react-test-renderer';
import type {VIAKey} from '@the-via/reader';

await import('../src/utils/keyboard-api');
const {store} = await import('../src/store');
const {useColorPainter} = await import('../src/utils/use-color-painter');

test('a keyboard without custom RGB data stays usable when the palette changes', () => {
  const initial = store.getState();
  const state = {
    ...initial,
    devices: {
      ...initial.devices,
      selectedDevicePath: null,
      selectedConnectionGeneration: null,
      connectedDevicePaths: {},
    },
    menus: {...initial.menus, customMenuDataMap: {}},
  };
  const testStore = configureStore({reducer: () => state});
  const keys: VIAKey[] = [];
  let renders = 0;
  const Picture = ({hue}: {hue: number}) => {
    const {keyColors} = useColorPainter(keys, [hue, 1]);
    if (++renders > 8) throw new Error('The empty RGB picture never settled');
    return <output>{keyColors.length}</output>;
  };
  let renderer!: ReturnType<typeof create>;
  try {
    act(() => {
      renderer = create(
        <Provider store={testStore}>
          <Picture hue={0} />
        </Provider>,
      );
    });
    for (const hue of [0, 120]) {
      act(() =>
        renderer.update(
          <Provider store={testStore}>
            <Picture hue={hue} />
          </Provider>,
        ),
      );
      expect(renderer.root.findByType('output').children).toEqual(['0']);
    }
  } finally {
    act(() => renderer.unmount());
  }
});
