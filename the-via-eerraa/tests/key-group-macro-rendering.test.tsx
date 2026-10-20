import './setup';
import {expect, mock, test} from 'bun:test';
import {configureStore} from '@reduxjs/toolkit';
import {readFileSync} from 'node:fs';
import {Provider} from 'react-redux';
import {act, create} from 'react-test-renderer';
import type {VIADefinitionV3} from '@the-via/reader';
import {DisplayMode} from '../src/types/keyboard-rendering';
import type {ConnectedDevice} from '../src/types/types';

await import('../src/utils/keyboard-api');
const {KeyGroup} = await import('../src/components/two-string/key-group');
const devices = await import('../src/store/devicesSlice');
const macros = await import('../src/store/macrosSlice');
const {default: settings} = await import('../src/store/settingsSlice');
const {default: firmware} = await import('../src/store/firmwareSlice');
const {default: keymap} = await import('../src/store/keymapSlice');
const {default: definitions, getBasicKeyToByte} =
  await import('../src/store/definitionsSlice');
const {expressionToRawSequence} =
  await import('../src/utils/macro-api/macro-api.common');

test('macro write bookkeeping does not repaint keyboard canvases; accepted content still updates its tooltip', async () => {
  const originals = ['document', 'devicePixelRatio'].map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  const fonts = Object.assign(new EventTarget(), {
    load: async () => [],
    check: () => true,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {fonts},
  });
  Object.defineProperty(globalThis, 'devicePixelRatio', {
    configurable: true,
    value: 1,
  });
  const store = configureStore({
    reducer: {
      devices: devices.default,
      macros: macros.default,
      settings,
      firmware,
      keymap,
      definitions,
    },
  });
  const device: ConnectedDevice = {
    path: 'key-group-macro-rendering',
    vendorId: 0x4552,
    productId: 0xa004,
    productName: 'TOMAK',
    vendorProductId: 0x4552a004,
    protocol: 12,
    requiredDefinitionVersion: 'v3',
    hasResolvedDefinition: true,
  };
  store.dispatch(devices.updateConnectedDevices({[device.path]: device}));
  store.dispatch(devices.selectDevice({device, connectionGeneration: 1}));
  const owner = {
    path: device.path,
    connectionGeneration: 1,
    selectionGeneration: devices.getSelectionGeneration(store.getState() as any),
  };
  store.dispatch(macros.macrosLoadStarted(owner));
  store.dispatch(macros.loadMacrosSuccess({
    ...owner,
    ast: [expressionToRawSequence('before')],
    macroBufferSize: 64,
    macroCount: 1,
  }));
  const {basicKeyToByte} = getBasicKeyToByte(store.getState() as any);
  const definition: VIADefinitionV3 = JSON.parse(
    readFileSync('public/definitions/era/v3/1163042817.json', 'utf8'),
  );
  const props = {
    keys: definition.layouts.keys.slice(0, 2),
    matrixKeycodes: [basicKeyToByte.KC_A, basicKeyToByte._QK_MACRO],
    definition,
    mode: DisplayMode.Configure,
    selectable: false,
  };
  const fillText = mock(() => {});
  const app = () => <Provider store={store}><KeyGroup {...props} /></Provider>;
  let renderer: ReturnType<typeof create> | undefined;
  try {
    await act(async () => {
      renderer = create(app(), {
        createNodeMock: (node) => node.type === 'canvas' ? {
          width: 300,
          height: 150,
          style: {},
          getContext: () => ({
            scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, clip() {},
            fillText,
          }),
        } : null,
      });
    });
    const rendered = () => JSON.stringify(renderer!.toJSON());
    expect(fillText).toHaveBeenCalled();
    expect(rendered()).toContain('before');
    fillText.mockClear();
    act(() => store.dispatch(macros.macroWriteStarted({
      path: device.path, generation: 1,
    })));
    // A parent render must not make unchanged legends new painting inputs.
    act(() => renderer!.update(app()));
    expect(fillText).not.toHaveBeenCalled();
    act(() => store.dispatch(macros.macroWriteFinished({
      path: device.path, generation: 1,
    })));
    act(() => renderer!.update(app()));
    expect(fillText).not.toHaveBeenCalled();
    act(() => store.dispatch(macros.saveMacrosSuccess({
      ast: [expressionToRawSequence('after')],
    })));
    expect(rendered()).toContain('after');
    expect(rendered()).not.toContain('before');
    expect(fillText).toHaveBeenCalled();
  } finally {
    if (renderer) act(() => renderer!.unmount());
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
