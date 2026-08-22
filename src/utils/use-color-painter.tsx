import {ThreeEvent} from '@react-three/fiber';
import {VIAKey} from '@the-via/reader';
import {useCallback, useEffect, useState} from 'react';
import {
  getSelectedConnectedDevice,
  getSelectedKeyboardAPI,
} from 'src/store/devicesSlice';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getSelectedCustomMenuAvailability,
  getSelectedCustomMenuData,
} from 'src/store/menusSlice';
import {invalidateStateSyncDomain} from 'src/store/stateSyncCandidateActions';
import {getHSVFrom256} from './color-math';

export const keyColorsFromPerKeyRGB = (
  perKeyRGB: number[][] | undefined,
  keys: VIAKey[],
) => {
  const colors = perKeyRGB ?? [];
  const ledIndices = keys.find((key) => 'li' in key)
    ? keys.map((key) => key.li ?? -1)
    : [];
  return ledIndices.map((ledIndex) => {
    const color = colors[ledIndex];
    if (color) {
      return getHSVFrom256(color);
    }
    return undefined;
  });
};

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
  const menuAvailability = useAppSelector(
    getSelectedCustomMenuAvailability,
  );
  const [keyColors, setKeyColors] = useState<number[][]>([]);

  const perKeyRGB = (customMenuData as {__perKeyRGB?: number[][]}).__perKeyRGB;

  useEffect(() => {
    setKeyColors(keyColorsFromPerKeyRGB(perKeyRGB, keys) as any);
  }, [keys, perKeyRGB]);

  const onKeycapPointerHandler = useCallback(
    (evt: ThreeEvent<MouseEvent> | React.MouseEvent, idx: number) => {
      if (evt.buttons === 1 && api && menuAvailability === 'available') {
        const hue = Math.round((selectedPaletteColor[0] * 255) / 360);
        const sat = Math.round(selectedPaletteColor[1] * 255);
        const ledIndex = keys[idx].li;
        if (ledIndex !== undefined) {
          const previousColors = keyColors;
          setKeyColors((colors) => {
            colors[idx] = selectedPaletteColor;
            return [...colors];
          });
          const connectionGeneration = api.getConnectionGeneration();
          let didSet = false;
          const invalidateConfig = () => {
            if (selectedDevice) {
              dispatch(
                invalidateStateSyncDomain({
                  devicePath: selectedDevice.path,
                  connectionGeneration,
                  domain: 'config',
                }),
              );
            }
          };
          void api
            .setPerKeyRGBMatrix(ledIndex, hue, sat)
            .then(() => {
              didSet = true;
              invalidateConfig();
              return api.commitCustomMenu(0);
            })
            .then(() => {
              invalidateConfig();
            })
            .catch((error) => {
              console.warn('Setting per-key RGB failed', error);
              if (!didSet) {
                setKeyColors(previousColors);
              }
              invalidateConfig();
            });
        }
      }
    },
    [
      api,
      dispatch,
      keyColors,
      keys,
      menuAvailability,
      selectedDevice,
      selectedPaletteColor,
    ],
  );

  return {
    keyColors,
    onKeycapPointerDown: onKeycapPointerHandler,
    onKeycapPointerOver: onKeycapPointerHandler,
  };
};
