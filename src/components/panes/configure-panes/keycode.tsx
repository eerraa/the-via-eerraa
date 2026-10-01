import {FC, useEffect, useMemo} from 'react';
import {title, component} from '../../icons/keyboard';
import * as EncoderPane from './encoder';
import {SpanOverflowCell} from '../grid';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getBasicKeyToByte,
  getSelectedDefinition,
  getSelectedKeyDefinitions,
} from 'src/store/definitionsSlice';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {
  getNumberOfLayers,
  getSelectedKey,
  getSelectedKeymap,
  getSelectedLayerIndex,
  updateKey as updateKeyAction,
  updateSelectedKey,
} from 'src/store/keymapSlice';
import {getPaletteMacroCount} from 'src/store/macrosSlice';
import {getDisableFastRemap} from 'src/store/settingsSlice';
import {getNextKey} from 'src/utils/keyboard-rendering';
import {useTranslation} from 'react-i18next';
import {buildEnabledKeycodeMenus} from 'src/utils/keycode-menus';
import {KeycodePalette} from '../../inputs/keycode-palette/keycode-palette';
import {useTapDanceBinding} from '../../inputs/keycode-palette/use-tap-dance';

export const Pane: FC = () => {
  const selectedKey = useAppSelector(getSelectedKey);
  const dispatch = useAppDispatch();
  const keys = useAppSelector(getSelectedKeyDefinitions);
  useEffect(
    () => () => {
      dispatch(updateSelectedKey(null));
    },
    [],
  );

  if (selectedKey !== null && keys[selectedKey]?.ei !== undefined) {
    return <EncoderPane.Pane />;
  }
  return <KeycodePane />;
};

export const KeycodePane: FC = () => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const matrixKeycodes = useAppSelector(getSelectedKeymap);
  const selectedKey = useAppSelector(getSelectedKey);
  const selectedLayer = useAppSelector(getSelectedLayerIndex);
  const numberOfLayers = useAppSelector(getNumberOfLayers);
  const disableFastRemap = useAppSelector(getDisableFastRemap);
  const selectedKeyDefinitions = useAppSelector(getSelectedKeyDefinitions);
  const {basicKeyToByte, byteToKey} = useAppSelector(getBasicKeyToByte);
  const macroCount = useAppSelector(getPaletteMacroCount);
  const tapDance = useTapDanceBinding(selectedDefinition as any);

  const menus = useMemo(() => {
    if (!selectedDefinition) {
      return [];
    }
    return buildEnabledKeycodeMenus({
      definition: selectedDefinition,
      basicKeyToByte,
      protocol: selectedDevice?.protocol,
      macroCount,
    });
  }, [selectedDefinition, basicKeyToByte, selectedDevice, macroCount]);

  if (!selectedDefinition || !selectedDevice || !matrixKeycodes) {
    return null;
  }

  const updateKey = (value: number, options?: {stay?: boolean}) => {
    if (selectedKey !== null) {
      dispatch(updateKeyAction(selectedKey, value));
      if (options?.stay) {
        return;
      }
      dispatch(
        updateSelectedKey(
          disableFastRemap || !selectedKeyDefinitions
            ? null
            : getNextKey(selectedKey, selectedKeyDefinitions),
          selectedKeyDefinitions,
        ),
      );
    }
  };

  return (
    <SpanOverflowCell>
      <KeycodePalette
        menus={menus}
        basicKeyToByte={basicKeyToByte}
        byteToKey={byteToKey}
        target={
          selectedKey === null
            ? null
            : {
                name: t('Selected key'),
                sub: t('Layer {{layer}}', {layer: selectedLayer}),
                value: matrixKeycodes[selectedKey] ?? null,
              }
        }
        onAssign={updateKey}
        layerCount={numberOfLayers}
        tapDance={tapDance}
      />
    </SpanOverflowCell>
  );
};

export const Icon = component;
export const Title = title;
