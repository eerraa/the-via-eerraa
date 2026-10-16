import {FC, useState, useEffect} from 'react';
import {Detail, Label, ControlRow, SpanOverflowCell} from '../grid';
import {CenterPane} from '../pane';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {PelpiKeycodeInput} from 'src/components/inputs/pelpi/keycode-input';
import {AccentButton} from 'src/components/inputs/accent-button';
import {getSelectedKeyDefinitions} from 'src/store/definitionsSlice';
import {
  getSelectedKey,
  getSelectedKeymap,
  getSelectedLayerIndex,
  getSelectedEncoderMap,
  loadEncoderValues,
  updateEncoderValue,
  updateKey,
} from 'src/store/keymapSlice';
import type {VIAKey} from '@the-via/reader';
import {
  getSelectedConnectedDevice,
  getSelectedDevicePath,
  getSelectedKeyboardAPI,
} from 'src/store/devicesSlice';
import {ErrorMessage} from 'src/components/styled';

const Encoder = styled(CenterPane)`
  height: 100%;
  background: var(--color_dark_grey);
`;

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 0 12px;
`;

const EMPTY_KEYMAP: number[] = [];

// A turn's key, an empty slot until the keyboard has answered for the knob.
const RotationKeycode: FC<{
  value?: number;
  label: string;
  setValue: (val: number) => void;
}> = ({value, label, setValue}) =>
  value === undefined ? (
    <AccentButton disabled aria-busy aria-label={label} />
  ) : (
    <PelpiKeycodeInput value={value} meta={{label}} setValue={setValue} />
  );

// Each knob on each layer has its own pane, so what was read or picked for
// another knob or layer is never drawn for it.
export const Pane: FC = () => {
  const selectedKey = useAppSelector(getSelectedKey);
  const keys: (VIAKey & {ei?: number})[] = useAppSelector(
    getSelectedKeyDefinitions,
  );
  const layer = useAppSelector(getSelectedLayerIndex);
  const path = useAppSelector(getSelectedDevicePath);
  return <KnobPane key={`${path}:${keys[selectedKey ?? -1]?.ei}:${layer}`} />;
};

const KnobPane: FC = () => {
  const {t} = useTranslation();
  const selectedKey = useAppSelector(getSelectedKey);
  const dispatch = useAppDispatch();
  const keys: (VIAKey & {ei?: number})[] = useAppSelector(
    getSelectedKeyDefinitions,
  );
  const matrixKeycodes = useAppSelector(
    (state) => getSelectedKeymap(state) || EMPTY_KEYMAP,
  );
  const layer = useAppSelector(getSelectedLayerIndex);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const api = useAppSelector(getSelectedKeyboardAPI);
  const selectedEncoderMap = useAppSelector(getSelectedEncoderMap);
  const val = matrixKeycodes[selectedKey ?? -1];
  const encoderKey = keys[selectedKey ?? -1];
  const encoderId =
    encoderKey?.ei === undefined ? undefined : Number(encoderKey.ei);
  const cachedEncoderValues =
    encoderId === undefined
      ? undefined
      : selectedEncoderMap?.[encoderId]?.[layer];
  const [cwValue, setCWValue] = useState(cachedEncoderValues?.[1]);
  const [ccwValue, setCCWValue] = useState(cachedEncoderValues?.[0]);
  const [loadFailed, setLoadFailed] = useState(false);
  const canClick =
    !!encoderKey && encoderKey.col !== -1 && encoderKey.row !== -1;

  const setEncoderValue = (type: 'ccw' | 'cw' | 'click', val: number) => {
    if (
      api &&
      selectedKey !== null &&
      encoderKey &&
      encoderKey.ei !== undefined
    ) {
      const encoderId = +encoderKey.ei;
      switch (type) {
        case 'ccw': {
          const previous = ccwValue;
          setCCWValue(val);
          void dispatch(updateEncoderValue(layer, encoderId, false, val)).catch(
            () => {
              setCCWValue(previous);
            },
          );
          break;
        }
        case 'cw': {
          const previous = cwValue;
          setCWValue(val);
          void dispatch(updateEncoderValue(layer, encoderId, true, val)).catch(
            () => {
              setCWValue(previous);
            },
          );
          break;
        }
        case 'click': {
          dispatch(updateKey(selectedKey, val));
          break;
        }
      }
    }
  };
  useEffect(() => {
    if (
      selectedDevice &&
      selectedDevice.protocol >= 10 &&
      encoderKey !== undefined &&
      encoderKey.ei !== undefined &&
      api
    ) {
      const encoderId = +encoderKey.ei;
      if (cachedEncoderValues) {
        setCCWValue(cachedEncoderValues[0]);
        setCWValue(cachedEncoderValues[1]);
      } else {
        // A reply for a knob or layer no longer shown is dropped.
        let current = true;
        void dispatch(loadEncoderValues(layer, encoderId)).then(
          ([ccw, cw]) => {
            if (current) {
              setCCWValue(ccw);
              setCWValue(cw);
            }
          },
          () => {
            if (current) {
              setLoadFailed(true);
            }
          },
        );
        return () => {
          current = false;
        };
      }
    }
  }, [
    api,
    cachedEncoderValues?.[0],
    cachedEncoderValues?.[1],
    encoderKey,
    layer,
    selectedDevice,
  ]);

  if (
    encoderKey === undefined ||
    (selectedDevice && selectedDevice.protocol < 10) ||
    loadFailed
  ) {
    return (
      <SpanOverflowCell>
        <ErrorMessage>
          {t(
            'Your current firmware does not support rotary encoders. Install the latest firmware for your device.',
          )}
        </ErrorMessage>
      </SpanOverflowCell>
    );
  }
  return (
    <SpanOverflowCell>
      <Encoder>
        <Container>
          <ControlRow>
            <Label>{t('Rotate Counterclockwise')}</Label>
            <Detail>
              <RotationKeycode
                value={ccwValue}
                label={t('Rotate Counterclockwise')}
                setValue={(val: number) => setEncoderValue('ccw', val)}
              />
            </Detail>
          </ControlRow>
          <ControlRow>
            <Label>{t('Rotate Clockwise')}</Label>
            <Detail>
              <RotationKeycode
                value={cwValue}
                label={t('Rotate Clockwise')}
                setValue={(val: number) => setEncoderValue('cw', val)}
              />
            </Detail>
          </ControlRow>
          {canClick && (
            <ControlRow>
              <Label>{t('Press Encoder')}</Label>
              <Detail>
                <PelpiKeycodeInput
                  value={val}
                  meta={{label: t('Press Encoder')}}
                  setValue={(val: number) => setEncoderValue('click', val)}
                />
              </Detail>
            </ControlRow>
          )}
        </Container>
      </Encoder>
    </SpanOverflowCell>
  );
};
