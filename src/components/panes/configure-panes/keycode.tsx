import {FC, useContext, useEffect, useMemo, useState} from 'react';
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
  getHoveredKey,
  getNumberOfLayers,
  getSelectedKey,
  getSelectedKeymap,
  getSelectedLayerIndex,
  setLayer,
  updateKey as updateKeyAction,
  updateSelectedKey,
} from 'src/store/keymapSlice';
import {getPaletteMacroCount} from 'src/store/macrosSlice';
import {getSelectedCustomMenuData} from 'src/store/menusSlice';
import {
  clearLtmtReturn,
  clearMacroReturn,
  getLtmtReturn,
  getMacroReturn,
  keepLtmtReturn,
  keepMacroReturn,
  openConfigureMenu,
  openConfigureSubmenu,
} from 'src/store/configurePlaceSlice';
import {getDisableFastRemap} from 'src/store/settingsSlice';
import {getNextKey} from 'src/utils/keyboard-rendering';
import {getMacroKeycodeIndex, isMacroKeycodeByte} from 'src/utils/key';
import {title as macrosTitle} from '../../icons/adjust';
import {useTranslation} from 'react-i18next';
import {buildEnabledKeycodeMenus} from 'src/utils/keycode-menus';
import {getExactMsFamily} from 'src/utils/era-advanced-metadata';
import {ConfigureRail} from 'src/utils/use-configure-place';
import {useIsEraDefinition} from 'src/utils/use-is-era-definition';
import {
  KeycodePalette,
  LTMT_CATEGORY,
  type TappingSummary,
} from '../../inputs/keycode-palette/keycode-palette';
import {useTapDanceBinding} from '../../inputs/keycode-palette/use-tap-dance';
import {collectDeferredItems} from './custom/deferred-apply';
import {deferredRowFor, dropdownChoices} from './custom/custom-control';

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

const TERM_COMMANDS = [
  'id_qmk_tapping_global_term_exact',
  'id_qmk_tapping_global_term',
];
const PERMISSIVE_HOLD = 'id_qmk_tapping_permissive_hold';
const HOLD_ON_OTHER_KEY_PRESS = 'id_qmk_tapping_hold_on_other_key_press';
const TAPPING_OPTIONS = [
  PERMISSIVE_HOLD,
  HOLD_ON_OTHER_KEY_PRESS,
  'id_qmk_tapping_retro_tapping',
];

// A definition menu's sub-tabs, as its tab bar has them.
const submenusOf = (node: {content?: unknown}): {label: string}[] =>
  (Array.isArray(node.content) ? node.content : []).flatMap((child) =>
    'label' in child ? [child] : submenusOf(child),
  );

/**
 * The TAPPING line under the LT·MT choices: the keyboard's tapping term and the
 * options it has on, read as the TAPPING menu's controls read them, and the way to
 * the rail menu whose sub-tab holds them, found by its commands. Null while the
 * definition has no such sub-tab or its values are not read.
 */
const useTappingSummary = (): TappingSummary | null => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();
  const rail = useContext(ConfigureRail);
  const menuData = useAppSelector(getSelectedCustomMenuData);
  const device = useAppSelector(getSelectedConnectedDevice);
  const selectedKey = useAppSelector(getSelectedKey);
  const layer = useAppSelector(getSelectedLayerIndex);
  const eraDefinition = useIsEraDefinition();
  if (!device || !menuData) {
    return null;
  }
  // Names as the menu shows them: an ERA definition's as it spells them.
  const name = (label: string) => (eraDefinition ? label : t(label));
  const exactMsFamily = getExactMsFamily(device.vendorProductId);
  for (const {key, viaMenu} of rail) {
    if (!viaMenu) {
      continue;
    }
    for (const submenu of submenusOf(viaMenu)) {
      const items = collectDeferredItems(submenu);
      const item = (command: string) =>
        items.find(({content}) => content[0] === command);
      const term = TERM_COMMANDS.map(item).find(Boolean);
      const options = items.filter(({content}) =>
        TAPPING_OPTIONS.includes(content[0]),
      );
      if (!term || options.length !== TAPPING_OPTIONS.length) {
        continue;
      }
      if ([term, ...options].some(({content}) => !menuData[content[0]])) {
        return null;
      }
      const on = new Set(
        options
          .filter(
            (option) =>
              deferredRowFor(option, menuData, exactMsFamily)?.saved === true,
          )
          .map(({content}) => content[0]),
      );
      const termRow = deferredRowFor(term, menuData, exactMsFamily);
      // The exact term is a millisecond field; the older one a list of times.
      const choice =
        !termRow?.bounds && term.type === 'dropdown'
          ? dropdownChoices(term.options).find(
              ({value}) => value === termRow?.saved,
            )
          : undefined;
      const termText = termRow?.bounds
        ? `${termRow.saved} ms`
        : choice && name(choice.label);
      if (!termText) {
        return null;
      }
      return {
        term: termText,
        // The menu hides Permissive Hold while Hold on Other Key Press is on.
        options: options
          .filter(
            ({content: [command]}) =>
              on.has(command) &&
              !(command === PERMISSIVE_HOLD && on.has(HOLD_ON_OTHER_KEY_PRESS)),
          )
          .map(({label, content}) => name(label ?? content[0])),
        menu: name(submenu.label),
        open: () => {
          const board = device.vendorProductId;
          dispatch(
            keepLtmtReturn({
              board,
              ltmt: {
                keymap: Title,
                menu: key,
                submenu: submenu.label,
                selectedKey,
                layer,
              },
            }),
          );
          dispatch(
            openConfigureSubmenu({
              board,
              menu: viaMenu.label,
              submenu: submenu.label,
            }),
          );
          dispatch(openConfigureMenu({board, menu: key}));
        },
      };
    }
  }
  return null;
};

export const KeycodePane: FC = () => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const matrixKeycodes = useAppSelector(getSelectedKeymap);
  const selectedKey = useAppSelector(getSelectedKey);
  const hoveredKey = useAppSelector(getHoveredKey);
  const selectedLayer = useAppSelector(getSelectedLayerIndex);
  const numberOfLayers = useAppSelector(getNumberOfLayers);
  const disableFastRemap = useAppSelector(getDisableFastRemap);
  const selectedKeyDefinitions = useAppSelector(getSelectedKeyDefinitions);
  const {basicKeyToByte, byteToKey} = useAppSelector(getBasicKeyToByte);
  const macroCount = useAppSelector(getPaletteMacroCount);
  const tapDance = useTapDanceBinding(selectedDefinition as any);
  const tapping = useTappingSummary();
  // Back from TAPPING through "To Keymap": the key and the layer as the link left
  // them, with the LT·MT tab open again. Leaving KEYMAP cleared the selected key,
  // so it is set again.
  const ltmtReturn = useAppSelector(getLtmtReturn);
  const [restored] = useState(() => (ltmtReturn?.back ? ltmtReturn : null));
  useEffect(() => {
    if (restored && selectedDevice) {
      dispatch(setLayer(restored.layer));
      dispatch(updateSelectedKey(restored.selectedKey, selectedKeyDefinitions));
      dispatch(clearLtmtReturn({board: selectedDevice.vendorProductId}));
    }
  }, []);
  // Back from Macros: the key and the layer the Macro tab left, with the macro to
  // focus. Sent from Macros opened another way, there is no key to take back:
  // only the macro is focused.
  const macroReturn = useAppSelector(getMacroReturn);
  const [macroBack] = useState(() =>
    macroReturn?.back ? {...macroReturn, back: macroReturn.back} : null,
  );
  useEffect(() => {
    if (!macroBack || !selectedDevice) {
      return;
    }
    if (macroBack.layer !== null) {
      dispatch(setLayer(macroBack.layer));
    }
    if (macroBack.selectedKey !== null) {
      dispatch(
        updateSelectedKey(macroBack.selectedKey, selectedKeyDefinitions),
      );
    }
    dispatch(clearMacroReturn({board: selectedDevice.vendorProductId}));
  }, []);

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

  // The Macro tab's way to the Macros menu: the macro on the selected key opens,
  // else the one last open there. KEYMAP keeps its key and layer for the way back.
  const rail = useContext(ConfigureRail);
  const macroMenu = rail.find(({key}) => key === macrosTitle)?.key;

  if (!selectedDefinition || !selectedDevice || !matrixKeycodes) {
    return null;
  }

  const board = selectedDevice.vendorProductId;
  const macroLink = macroMenu
    ? {
        open: () => {
          const value =
            selectedKey === null ? undefined : matrixKeycodes[selectedKey];
          dispatch(
            keepMacroReturn({
              board,
              macro: {
                keymap: Title,
                menu: macroMenu,
                selectedKey,
                layer: selectedLayer,
              },
            }),
          );
          if (
            value !== undefined &&
            isMacroKeycodeByte(value, basicKeyToByte)
          ) {
            dispatch(
              openConfigureSubmenu({
                board,
                menu: macrosTitle,
                submenu: `M${getMacroKeycodeIndex(value, basicKeyToByte)}`,
              }),
            );
          }
          dispatch(openConfigureMenu({board, menu: macroMenu}));
        },
      }
    : null;

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
                value: matrixKeycodes[selectedKey] ?? null,
              }
        }
        onAssign={updateKey}
        layerCount={numberOfLayers}
        tapDance={tapDance}
        tapping={tapping}
        initialCategory={
          restored ? LTMT_CATEGORY : macroBack ? 'macro' : undefined
        }
        initialFocusCode={
          macroBack ? `MACRO(${macroBack.back.macro})` : undefined
        }
        macroLink={macroLink}
        keyboardHover={
          hoveredKey === null ? null : (matrixKeycodes[hoveredKey] ?? null)
        }
      />
    </SpanOverflowCell>
  );
};

export const Icon = component;
export const Title = title;
