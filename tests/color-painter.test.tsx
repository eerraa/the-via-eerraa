import './setup';
import {expect, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {act, create} from 'react-test-renderer';
import type {VIAKey} from '@the-via/reader';

await import('../src/utils/keyboard-api');
const {store} = await import('../src/store');
const {useColorPainter} = await import('../src/utils/use-color-painter');

test('a keyboard without custom RGB data settles instead of rendering indefinitely', () => {
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
  const Picture = ({palette}: {palette: [number, number]}) => {
    const {keyColors} = useColorPainter(keys, palette);
    if (++renders > 8) throw new Error('The empty RGB picture never settled');
    return <output>{keyColors.length}</output>;
  };
  let renderer!: ReturnType<typeof create>;
  try {
    act(() => {
      renderer = create(
        <Provider store={testStore}>
          <Picture palette={[0, 1]} />
        </Provider>,
      );
    });
    expect(renderer.root.findByType('output').children).toEqual(['0']);
    expect(renders).toBeLessThanOrEqual(2);
    const settled = renders;
    act(() => {
      renderer.update(
        <Provider store={testStore}>
          <Picture palette={[120, 1]} />
        </Provider>,
      );
    });
    expect(renders).toBe(settled + 1);
    expect(renderer.root.findByType('output').children).toEqual(['0']);
  } finally {
    act(() => renderer?.unmount());
  }
});
