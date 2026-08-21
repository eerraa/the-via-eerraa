import {ThreeEvent} from '@react-three/fiber';
import {VIAKey} from '@the-via/reader';
import {useCallback, useEffect, useState} from 'react';
import {
  getSelectedConnectedDevice,
  getSelectedKeyboardAPI,
} from 'src/store/devicesSlice';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {getSelectedCustomMenuData} from 'src/store/menusSlice';
import {invalidateStateSyncDomain} from 'src/store/stateSyncCandidateActions';
import {getHSVFrom256} from './color-math';

export const useColorPainter = (
  keys: VIAKey[],
  selectedPaletteColor: [number, number],
) => {
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const dispatch = useAppDispatch();
  const api = useAppSelector(getSelectedKeyboardAPI);
  const customMenuData = useAppSelector(getSelectedCustomMenuData) || {
    __perKeyRGB: [],
  };
  const [keyColors, setKeyColors] = useState<number[][]>([]);

  useEffect(() => {
    const perKeyRGB = (customMenuData as any).__perKeyRGB ?? [];
    const ledIndices = keys.find((k) => 'li' in k)
      ? keys.map((k) => k.li ?? -1)
      : [];
    const storeKeyColors = ledIndices.map((i: number) => {
      const color = perKeyRGB[i ?? -1];
      if (color) {
        return getHSVFrom256(color);
      }
      return undefined;
    });
    setKeyColors(storeKeyColors as any);
  }, [customMenuData.__perKeyRGB && customMenuData.__perKeyRGB.length, keys]);

  const onKeycapPointerHandler = useCallback(
    (evt: ThreeEvent<MouseEvent> | React.MouseEvent, idx: number) => {
      if (evt.buttons === 1 && api) {
        const hue = Math.round((selectedPaletteColor[0] * 255) / 360);
        const sat = Math.round(selectedPaletteColor[1] * 255);
        const ledIndex = keys[idx].li;
        if (ledIndex !== undefined) {
          setKeyColors((colors) => {
            colors[idx] = selectedPaletteColor;
            return [...colors];
          });
          const connectionGeneration = api.getConnectionGeneration();
          void api
            .setPerKeyRGBMatrix(ledIndex, hue, sat)
            .then(() => api.commitCustomMenu(0))
            .then(() => {
              if (
                selectedDevice &&
                api.isConnectionGenerationCurrent(connectionGeneration)
              ) {
                dispatch(
                  invalidateStateSyncDomain({
                    devicePath: selectedDevice.path,
                    connectionGeneration,
                    domain: 'config',
                  }),
                );
              }
            })
            .catch((error) =>
              console.warn('Setting per-key RGB failed', error),
            );
        }
      }
    },
    [api, dispatch, keys, selectedDevice, selectedPaletteColor],
  );

  return {
    keyColors,
    onKeycapPointerDown: onKeycapPointerHandler,
    onKeycapPointerOver: onKeycapPointerHandler,
  };
};
