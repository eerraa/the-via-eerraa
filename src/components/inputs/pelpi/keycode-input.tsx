import React from 'react';
import {createPortal} from 'react-dom';
import styled from 'styled-components';
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
import {AccentButton} from '../accent-button';
import {
  KeycodePalette,
  useHostLayoutNames,
} from '../keycode-palette/keycode-palette';
import {TextAction} from '../keycode-palette/palette-parts';
import type {PelpiInput} from './input';

// A keycode setting opens the same palette as KEYMAP, docked to the bottom of the
// window so the setting it belongs to stays in view above it.

const Scrim = styled.div`
  position: fixed;
  inset: 0;
  z-index: 3;
  background: rgb(0 0 0 / 35%);
`;

const Dock = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 4;
  height: min(660px, 76vh);
  border-top: 1px solid var(--color_accent);
  background: var(--bg_menu);
  --palette-surface: var(--bg_menu);
  box-shadow: 0 -12px 32px rgb(0 0 0 / 35%);

  &:focus {
    outline: none;
  }
`;

export const PelpiKeycodeInput: React.FC<
  PelpiInput<{label?: string; labelledBy?: string}>
> = (props) => {
  const buttonId = React.useId();
  const [open, setOpen] = React.useState(false);
  const close = () => setOpen(false);
  const dockRef = React.useRef<HTMLDivElement>(null);
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

  // While the dock is open the page behind it is inert, so Tab stays in the
  // dock (it is portalled outside #root). Every way out gives focus back to the
  // button that opened it, once the page is live again.
  React.useEffect(() => {
    if (!open) {
      return;
    }
    const page = document.getElementById('root');
    page?.setAttribute('inert', '');
    dockRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      page?.removeAttribute('inert');
      triggerRef.current?.focus();
    };
  }, [open]);

  const label = props.meta.label ?? t('Keycode');
  // The key as the palette draws it, on one line; the QMK code is in the tooltip.
  const shown = describeKeycodeValue(
    props.value,
    index,
    basicKeyToByte,
    byteToKey,
    layout,
  );
  const legend = `${shown.top} ${shown.bottom}`.trim();

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
      {open
        ? createPortal(
            <>
              <Scrim onClick={close} />
              <Dock
                ref={dockRef}
                role="dialog"
                aria-modal="true"
                aria-label={t('Choose a keycode')}
                tabIndex={-1}
              >
                <KeycodePalette
                  menus={menus}
                  basicKeyToByte={basicKeyToByte}
                  byteToKey={byteToKey}
                  target={{name: label, value: props.value}}
                  onAssign={(value) => {
                    props.setValue(value);
                    close();
                  }}
                  layerCount={numberOfLayers}
                  headerEnd={
                    <TextAction
                      type="button"
                      $tone="plain"
                      onClick={close}
                    >
                      {t('Close')}
                    </TextAction>
                  }
                />
              </Dock>
            </>,
            document.body,
          )
        : null}
    </>
  );
};
