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
import {beginForegroundMutation} from 'src/store/stateSyncSlice';
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
      if (
        evt.buttons === 1 &&
        api &&
        selectedDevice &&
        menuAvailability === 'available'
      ) {
        const hue = Math.round((selectedPaletteColor[0] * 255) / 360);
        const sat = Math.round(selectedPaletteColor[1] * 255);
        const ledIndex = keys[idx].li;
        if (ledIndex !== undefined) {
          const previousColors = [...keyColors];
          setKeyColors((colors) => {
            const nextColors = [...colors];
            nextColors[idx] = selectedPaletteColor;
            return nextColors;
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
          dispatch(
            beginForegroundMutation({
              path: selectedDevice.path,
              generation: connectionGeneration,
              domains: ['config'],
            }),
          );
          void (async () => {
            try {
              const owner = Symbol(`per-key-rgb:${ledIndex}`);
              await api.withPathReservation(
                connectionGeneration,
                owner,
                async (reservedApi) => {
                  await reservedApi.setPerKeyRGBMatrix(ledIndex, hue, sat);
                  didSet = true;
                  await reservedApi.commitCustomMenu(0);
                },
              );
            } catch (error) {
              console.warn('Setting per-key RGB failed', error);
              if (!didSet) {
                setKeyColors(previousColors);
              }
            } finally {
              invalidateConfig();
              if (api.isConnectionGenerationCurrent(connectionGeneration)) {
                const {refreshConfigDomain} = await import(
                  'src/store/stateSyncThunks'
                );
                await dispatch(refreshConfigDomain(selectedDevice));
              }
            }
          })();
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
