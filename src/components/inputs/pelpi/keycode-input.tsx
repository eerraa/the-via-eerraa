import React from 'react';
import styled from 'styled-components';
import {getBasicKeyToByte} from 'src/store/definitionsSlice';
import {useAppSelector} from 'src/store/hooks';
import {AccentButton} from '../accent-button';
import {KeycodePicker} from '../keycode-picker';
import {ModalBackground, ModalContainer} from '../dialog-base';
import type {PelpiInput} from './input';
import {formatKeycodeLabel} from '../../../utils/keycode-picker';
import {buildEnabledKeycodeMenus} from 'src/utils/keycode-menus';
import {getSelectedDefinition} from 'src/store/definitionsSlice';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {getMacroCount} from 'src/store/macrosSlice';
import {useTranslation} from 'react-i18next';

const KeycodePickerDialog = styled(ModalContainer)`
  width: min(1600px, calc(100vw - 40px));
  height: min(760px, calc(100vh - 40px));
  min-width: 0;
  min-height: 0;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 40px);
  justify-content: flex-start;
  align-items: stretch;
  gap: 12px;
  overflow: hidden;
`;

const DialogTitle = styled.h2`
  margin: 0;
  color: var(--color_label-highlighted);
  font-size: 20px;
  font-weight: 500;
  line-height: 1.4;
`;

const PickerViewport = styled.div`
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
`;

const CloseButton = styled(AccentButton)`
  width: 100%;
  flex: none;
`;

export const PelpiKeycodeInput: React.FC<PelpiInput<{}>> = (props) => {
  const [showPicker, setShowPicker] = React.useState(false);
  const dialogTitleId = React.useId();
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
          <KeycodePickerDialog
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            onClick={(event) => event.stopPropagation()}
          >
            <DialogTitle id={dialogTitleId}>
              {t('Choose a keycode')}
            </DialogTitle>
            <PickerViewport>
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
            </PickerViewport>
            <CloseButton onClick={() => setShowPicker(false)}>
              {t('Close')}
            </CloseButton>
          </KeycodePickerDialog>
        </ModalBackground>
      )}
    </>
  );
};
