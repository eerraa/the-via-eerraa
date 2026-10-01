import {VIADefinitionV2, VIADefinitionV3} from '@the-via/reader';
import {KeyboardAPI, KeyboardValue} from './keyboard-api';
import {useEffect, useRef, useState} from 'react';
import {ConnectedDevice, TestKeyState} from 'src/types/types';
import {reachesSettingsControl} from './use-global-keys';

const invertTestKeyState = (s: TestKeyState) =>
  s === TestKeyState.KeyDown ? TestKeyState.KeyUp : TestKeyState.KeyDown;

/** The switch matrix as the keyboard reports it, one bit per switch. */
export const readSwitchMatrix = async (
  api: KeyboardAPI,
  protocol: number,
  {rows, cols}: {rows: number; cols: number},
) => {
  const bytesPerRow = Math.ceil(cols / 8);
  const rowsPerQuery = Math.floor(28 / bytesPerRow);
  const flat: number[] = [];
  for (let offset = 0; offset < rows; offset += rowsPerQuery) {
    const querySize = Math.min(
      rows * bytesPerRow - flat.length, // bytes remaining
      bytesPerRow * rowsPerQuery, // max bytes per query
    );
    flat.push(
      ...((await api.getKeyboardValue(
        KeyboardValue.SWITCH_MATRIX_STATE,
        protocol >= 12 ? [offset] : [],
        querySize,
      )) as number[]),
    );
  }
  return flat;
};

export const useMatrixTest = (
  startTest: boolean,
  api?: KeyboardAPI,
  device?: ConnectedDevice,
  selectedDefinition?: VIADefinitionV2 | VIADefinitionV3,
  onReadFailed?: () => void,
) => {
  const selectedKeyArr = useState<any>([]);
  const [, setSelectedKeys] = selectedKeyArr;
  const readFailed = useRef(onReadFailed);
  readFailed.current = onReadFailed;

  useEffect(() => {
    let flat: number[] = [];
    // Each run reads on its own: the picture can go and come back while a read
    // is under way, and that read then neither changes the keys nor reads on.
    let ticking = false;
    const stopTicking = () => {
      ticking = false;
    };

    const startTicking = async (
      api: KeyboardAPI,
      protocol: number,
      selectedDefinition: VIADefinitionV2 | VIADefinitionV3,
      prevFlat: number[],
    ) => {
      if (startTest && api && selectedDefinition) {
        const {cols, rows} = selectedDefinition.matrix;
        const bytesPerRow = Math.ceil(cols / 8);
        try {
          const newFlat = await readSwitchMatrix(
            api,
            protocol,
            selectedDefinition.matrix,
          );
          if (!ticking) {
            return;
          }

          const keysChanges = newFlat.some(
            (val, byteIdx) => val ^ (prevFlat[byteIdx] || 0),
          );
          if (!keysChanges) {
            await api.timeout(20);
            if (ticking) {
              startTicking(api, protocol, selectedDefinition, prevFlat);
            }
            return;
          }
          setSelectedKeys((selectedKeys: any) =>
            newFlat.reduce(
              (res, val, byteIdx) => {
                const xor = val ^ (prevFlat[byteIdx] || 0);
                if (xor === 0) {
                  return res;
                }
                const row = ~~(byteIdx / bytesPerRow);

                const colOffset =
                  8 * (bytesPerRow - 1 - (byteIdx % bytesPerRow));
                return Array(Math.max(0, Math.min(8, cols - colOffset)))
                  .fill(0)
                  .reduce((resres, _, idx) => {
                    const matrixIdx = cols * row + idx + colOffset;
                    resres[matrixIdx] =
                      ((xor >> idx) & 1) === 1
                        ? invertTestKeyState(resres[matrixIdx])
                        : resres[matrixIdx];
                    return resres;
                  }, res);
              },
              Array.isArray(selectedKeys) && selectedKeys.length === rows * cols
                ? [...selectedKeys]
                : Array(rows * cols).fill(TestKeyState.Initial),
            ),
          );
          await api.timeout(20);
          if (ticking) {
            startTicking(api, protocol, selectedDefinition, newFlat);
          }
        } catch (e) {
          if (!ticking) {
            return;
          }
          ticking = false;
          readFailed.current?.();
        }
      }
    };

    if (startTest && api && device && selectedDefinition) {
      ticking = true;
      startTicking(api, device.protocol, selectedDefinition, flat);
    }

    return () => {
      stopTicking();
    };
  }, [
    startTest,
    selectedDefinition,
    api,
    device?.path,
    device?.protocol,
  ]);

  const downHandler = (evt: KeyboardEvent) => {
    if (!reachesSettingsControl(evt)) {
      evt.preventDefault();
    }
  };
  const upHandler = downHandler;

  useEffect(() => {
    if (startTest) {
      window.addEventListener('keydown', downHandler);
      window.addEventListener('keyup', upHandler);
    }
    // Remove event listeners on cleanup
    return () => {
      window.removeEventListener('keydown', downHandler);
      window.removeEventListener('keyup', upHandler);
    };
  }, [startTest]);

  return selectedKeyArr;
};
