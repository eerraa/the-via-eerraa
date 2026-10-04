import {useMemo, FC, useCallback, useEffect} from 'react';
import styled from 'styled-components';
import {CenterPane} from '../pane';
import {
  SubmenuTab,
  SubmenuTabBar,
  TabbedBody,
  TabbedCell,
} from '../submenu-tabs';
import {title, component} from '../../icons/adjust';
import {
  getSelectedMacroDrafts,
  isMacroDraftPending,
  MacroDetailPane,
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
  saveMacros,
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
  padding: 12px;
  padding-top: 0;
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

      const newMacros = macroExpressions.map((oldMacro, i) =>
        i === macroIndex ? macro : oldMacro,
      );

      await dispatch(saveMacros(selectedDevice, newMacros));
    },
    [macroExpressions, saveMacros, dispatch, selectedDevice, macrosReady],
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
              />
            ) : (
              <ConfigureStatusMessage role="status">
                {t('Loading...')}
              </ConfigureStatusMessage>
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
