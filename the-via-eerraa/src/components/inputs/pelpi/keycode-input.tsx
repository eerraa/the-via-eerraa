import React from 'react';
import {useTranslation} from 'react-i18next';
import {
  getBasicKeyToByte,
  getSelectedDefinition,
} from 'src/store/definitionsSlice';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {getPaletteMacroCount} from 'src/store/macrosSlice';
import {getNumberOfLayers} from 'src/store/keymapSlice';
import {buildEnabledKeycodeMenus} from 'src/utils/keycode-menus';
import {
  buildKeycodeIndex,
  describeKeycodeValue,
} from 'src/utils/keycode-palette';
import {legendText} from 'src/utils/keycap-legend';
import {AccentButton} from '../accent-button';
import {
  KeycodePalette,
  useHostLayoutNames,
} from '../keycode-palette/keycode-palette';
import type {PelpiInput} from './input';

// A keycode setting opens its keys in a window over the page, as a Tap Dance
// action does: KEYMAP's categories, LT·MT among them, titled with the setting. A
// key picked sets it and closes the window; an LT·MT choice sets it and leaves the
// window open for the next. Esc, Close or a click beside it close it unchanged.

export const PelpiKeycodeInput: React.FC<
  PelpiInput<{label?: string; labelledBy?: string}>
> = (props) => {
  const buttonId = React.useId();
  const [open, setOpen] = React.useState(false);
  const close = () => setOpen(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const {t} = useTranslation();
  const {basicKeyToByte, byteToKey} = useAppSelector(getBasicKeyToByte);
  const definition = useAppSelector(getSelectedDefinition);
  const device = useAppSelector(getSelectedConnectedDevice);
  const macroCount = useAppSelector(getPaletteMacroCount);
  const numberOfLayers = useAppSelector(getNumberOfLayers);
  const layout = useHostLayoutNames();

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
  const index = React.useMemo(
    () => buildKeycodeIndex(menus, basicKeyToByte),
    [menus, basicKeyToByte],
  );

  const label = props.meta.label ?? t('Keycode');
  // The key as the palette draws it, on one line; the QMK code is in the tooltip.
  const shown = describeKeycodeValue(
    props.value,
    index,
    basicKeyToByte,
    byteToKey,
    layout,
  );
  const legend = legendText(shown.legend);

  return (
    <>
      <AccentButton
        ref={triggerRef}
        id={buttonId}
        aria-labelledby={
          props.meta.labelledBy
            ? `${props.meta.labelledBy} ${buttonId}`
            : undefined
        }
        title={legend === shown.code ? undefined : shown.code}
        onClick={() => setOpen(true)}
      >
        {legend || t('Blank')}
      </AccentButton>
      {open ? (
        <KeycodePalette
          menus={menus}
          basicKeyToByte={basicKeyToByte}
          byteToKey={byteToKey}
          target={{name: label, value: props.value}}
          onAssign={(value, options) => {
            props.setValue(value);
            if (!options?.stay) {
              close();
            }
          }}
          layerCount={numberOfLayers}
          popup={{title: label, onClose: close, returnFocus: triggerRef}}
        />
      ) : null}
    </>
  );
};
