import React from 'react';
import {getBasicKeyToByte} from 'src/store/definitionsSlice';
import {useAppSelector} from 'src/store/hooks';
import {AccentButton} from '../accent-button';
import {KeycodePicker} from '../keycode-picker';
import {
  ModalBackground,
  ModalContainer,
} from '../dialog-base';
import type {PelpiInput} from './input';
import {formatKeycodeLabel} from '../../../utils/keycode-picker';
import {buildEnabledKeycodeMenus} from 'src/utils/keycode-menus';
import {getSelectedDefinition} from 'src/store/definitionsSlice';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {getMacroCount} from 'src/store/macrosSlice';
import {useTranslation} from 'react-i18next';

export const PelpiKeycodeInput: React.FC<PelpiInput<{}>> = (props) => {
  const [showPicker, setShowPicker] = React.useState(false);
  const {t} = useTranslation();
  const {basicKeyToByte, byteToKey} = useAppSelector(getBasicKeyToByte);
  const definition = useAppSelector(getSelectedDefinition);
  const device = useAppSelector(getSelectedConnectedDevice);
  const macroCount = useAppSelector(getMacroCount);
  const macros = useAppSelector((state: any) => state.macros);

  const menus = React.useMemo(() => {
    if (!definition) {
      return [];
    }
    return buildEnabledKeycodeMenus({
      definition,
      basicKeyToByte,
      protocol: device?.protocol,
      macroCount,
    });
  }, [definition, basicKeyToByte, device, macroCount]);

  return (
    <>
      <AccentButton onClick={() => setShowPicker(true)}>
        {formatKeycodeLabel(props.value, basicKeyToByte, byteToKey)}
      </AccentButton>
      {showPicker && (
        <ModalBackground onClick={() => setShowPicker(false)}>
          <ModalContainer
            onClick={(event) => event.stopPropagation()}
            style={{maxHeight: '80vh', overflow: 'auto', alignItems: 'stretch'}}
          >
            <KeycodePicker
              menus={menus}
              basicKeyToByte={basicKeyToByte}
              byteToKey={byteToKey}
              value={props.value}
              macrosSupported={macros.isFeatureSupported !== false}
              onSelect={(keycode) => {
                props.setValue(keycode);
                setShowPicker(false);
              }}
            />
            <AccentButton onClick={() => setShowPicker(false)}>
              {t('Close')}
            </AccentButton>
          </ModalContainer>
        </ModalBackground>
      )}
    </>
  );
};
