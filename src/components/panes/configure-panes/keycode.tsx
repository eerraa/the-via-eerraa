import {FC, useEffect, useMemo, useState} from 'react';
import {title, component} from '../../icons/keyboard';
import * as EncoderPane from './encoder';
import {OverflowCell, SubmenuOverflowCell, SubmenuRow} from '../grid';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getBasicKeyToByte,
  getSelectedDefinition,
  getSelectedKeyDefinitions,
} from 'src/store/definitionsSlice';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {
  getSelectedKey,
  getSelectedKeymap,
  updateKey as updateKeyAction,
  updateSelectedKey,
} from 'src/store/keymapSlice';
import {getMacroCount} from 'src/store/macrosSlice';
import {getDisableFastRemap} from 'src/store/settingsSlice';
import {getNextKey} from 'src/utils/keyboard-rendering';
import {useTranslation} from 'react-i18next';
import {KeycodePicker} from '../../inputs/keycode-picker';
import {buildEnabledKeycodeMenus} from 'src/utils/keycode-menus';

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
  const macros = useAppSelector((state: any) => state.macros);
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const matrixKeycodes = useAppSelector(getSelectedKeymap);
  const selectedKey = useAppSelector(getSelectedKey);
  const disableFastRemap = useAppSelector(getDisableFastRemap);
  const selectedKeyDefinitions = useAppSelector(getSelectedKeyDefinitions);
  const {basicKeyToByte, byteToKey} = useAppSelector(getBasicKeyToByte);
  const macroCount = useAppSelector(getMacroCount);

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

  const [selectedCategory, setSelectedCategory] = useState(menus[0]?.id ?? '');

  if (!selectedDefinition || !selectedDevice || !matrixKeycodes) {
    return null;
  }

  const updateKey = (value: number) => {
    if (selectedKey !== null) {
      dispatch(updateKeyAction(selectedKey, value));
      dispatch(
        updateSelectedKey(
          disableFastRemap || !selectedKeyDefinitions
            ? null
            : getNextKey(selectedKey, selectedKeyDefinitions),
        ),
      );
    }
  };

  return (
    <>
      <SubmenuOverflowCell>
        {menus.map(({id, label}) => (
          <SubmenuRow
            $selected={id === selectedCategory}
            onClick={() => setSelectedCategory(id)}
            key={id}
          >
            {t(label)}
          </SubmenuRow>
        ))}
      </SubmenuOverflowCell>
      <OverflowCell>
        <KeycodePicker
          menus={menus}
          basicKeyToByte={basicKeyToByte}
          byteToKey={byteToKey}
          value={selectedKey !== null ? matrixKeycodes[selectedKey] : undefined}
          macrosSupported={macros.isFeatureSupported}
          onSelect={updateKey}
          renderCategoryNav={false}
          selectedCategoryId={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />
      </OverflowCell>
    </>
  );
};

export const Icon = component;
export const Title = title;
