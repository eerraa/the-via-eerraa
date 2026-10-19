import {useMemo, FC, useCallback, useEffect, useState} from 'react';
import styled from 'styled-components';
import {CenterPane} from '../pane';
import {
  SubmenuTab,
  SubmenuTabBar,
  TabbedBody,
  TabbedCell,
} from '../submenu-tabs';
import {title, component} from '../../icons/adjust';
import {title as keymapTitle} from '../../icons/keyboard';
import {BackRow, TextAction} from '../../inputs/keycode-palette/palette-parts';
import {returnFromMacros} from '../../../store/configurePlaceSlice';
import {
  getSelectedMacroDrafts,
  isMacroDraftPending,
  MacroDetailPane,
  MacroModeRow,
} from './submenus/macros/macro-detail';
import {DirtyDot} from '../../inputs/dirty-dot';
import {useAppDispatch, useAppSelector} from '../../../store/hooks';
import {
  getSelectedConnectedDevice,
  getSelectedKeyboardAPI,
  getSelectedConnectionGeneration,
} from '../../../store/devicesSlice';
import {
  getExpressions,
  getIsMacrosReady,
  getMacroCount,
  saveMacro as writeMacro,
} from '../../../store/macrosSlice';
import {getSelectedKeycodesVersion} from '../../../store/firmwareSlice';
import {getSelectedStateSyncCapability} from '../../../store/stateSyncSlice';
import {ensureMacroContents} from '../../../store/stateSyncThunks';
import {getMacroAPI} from '../../../utils/macro-api';
import {ConfigureStatusMessage} from './status-message';
import {useTranslation} from 'react-i18next';
import {useSubmenuTab} from '../../../utils/use-configure-place';

const MacroPane = styled(CenterPane)`
  height: 100%;
  background: var(--color_dark_grey);
`;

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  padding: 12px;
  /* As far below the slot tabs as KEYMAP's keys sit below its tabs. */
  padding-top: 20px;
  /* A long macro grows past the pane, as in VIA, and the column scrolls it. */
  overflow: auto;
  > * {
    flex-shrink: 0;
  }
`;

// The link that leaves the menu, at the start of the macro's mode row.
const BackLinks = styled(BackRow)`
  width: auto;
  max-width: none;
  margin: 0;
`;

export const Pane: FC = () => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const connectionGeneration = useAppSelector(getSelectedConnectionGeneration);
  const macrosReady = useAppSelector(getIsMacrosReady);
  const macroExpressions = useAppSelector(getExpressions);
  const macroCount = useAppSelector(getMacroCount);
  const macroDrafts = useAppSelector(getSelectedMacroDrafts);
  const stateSyncCapability = useAppSelector(getSelectedStateSyncCapability);
  const api = useAppSelector(getSelectedKeyboardAPI);
  const keycodesVersion = useAppSelector(getSelectedKeycodesVersion);
  const protocol = selectedDevice?.protocol;
  const [recording, setRecording] = useState(false);

  const macroLabels = useMemo(
    () => Array.from({length: macroCount}, (_, idx) => `M${idx}`),
    [macroCount],
  );
  const [selectedLabel, openSubmenu] = useSubmenuTab(title, macroLabels);
  const selectedMacro = Math.max(
    macroLabels.findIndex((label) => label === selectedLabel),
    0,
  );

  const macroApi = useMemo(
    () =>
      api && protocol !== undefined
        ? getMacroAPI(protocol, keycodesVersion, api)
        : undefined,
    [api, keycodesVersion, protocol],
  );

  // Asked again when State Sync capability settles, which can follow the first render.
  useEffect(() => {
    if (selectedDevice && !macrosReady) {
      void dispatch(ensureMacroContents(selectedDevice));
    }
  }, [dispatch, macrosReady, selectedDevice, stateSyncCapability]);

  const saveMacro = useCallback(
    async (macroIndex: number, macro: string) => {
      if (!selectedDevice || !macrosReady) {
        throw new Error('Macros are not loaded');
      }

      await dispatch(writeMacro(selectedDevice, macroIndex, macro));
    },
    [dispatch, selectedDevice, macrosReady],
  );

  const macroMenus = useMemo(
    () =>
      Array(macroCount)
        .fill(0)
        .map((_, idx) => idx)
        .map((idx) => (
          <SubmenuTab
            key={idx}
            type="button"
            $selected={selectedMacro === idx}
            aria-pressed={selectedMacro === idx}
            onClick={() => openSubmenu(macroLabels[idx])}
          >
            {macroLabels[idx]}
            {macrosReady &&
            isMacroDraftPending(
              macroApi,
              macroDrafts[idx],
              macroExpressions[idx] || '',
            ) ? (
              <DirtyDot aria-hidden="true" />
            ) : null}
          </SubmenuTab>
        )),
    [
      selectedMacro,
      macroCount,
      macroLabels,
      openSubmenu,
      macrosReady,
      macroApi,
      macroDrafts,
      macroExpressions,
    ],
  );

  if (!selectedDevice) {
    return null;
  }
  const toKeymap = () =>
    dispatch(
      returnFromMacros({
        board: selectedDevice.vendorProductId,
        keymap: keymapTitle,
        menu: title,
        macro: selectedMacro,
      }),
    );
  // The way out of the menu sits at the start of the mode row, so it takes no
  // row of its own; while the macros load, the row holds it alone. Opened from
  // KEYMAP's Macro tab, the menu leads back to the key it left; opened another
  // way, it takes the macro shown to KEYMAP, to be put on a key there.
  const backLinks = (
    <TextAction type="button" disabled={recording} onClick={toKeymap}>
      {t('To Keymap')}
    </TextAction>
  );
  return (
    <TabbedCell>
      <SubmenuTabBar label={t('Macros')}>{macroMenus}</SubmenuTabBar>
      <TabbedBody>
        <MacroPane>
          <Container>
            {macrosReady ? (
              <MacroDetailPane
                key={`${selectedDevice.path}:${connectionGeneration}`}
                macroExpressions={macroExpressions}
                selectedMacro={selectedMacro}
                saveMacros={saveMacro}
                macroApi={macroApi}
                onRecordingChange={setRecording}
                lead={<BackLinks>{backLinks}</BackLinks>}
              />
            ) : (
              <>
                <MacroModeRow lead={<BackLinks>{backLinks}</BackLinks>} />
                <ConfigureStatusMessage role="status">
                  {t('Loading...')}
                </ConfigureStatusMessage>
              </>
            )}
          </Container>
        </MacroPane>
      </TabbedBody>
    </TabbedCell>
  );
};

// TODO: these are used in the context that configure.tsx imports menus with props Icon, Title, Pane.
// Should we encapsulate this type and wrap the exports to conform to them?
export const Icon = component;
export const Title = title;
