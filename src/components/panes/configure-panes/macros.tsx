import {useState, useMemo, FC, useCallback, useEffect} from 'react';
import styled from 'styled-components';
import {OverflowCell, SubmenuOverflowCell, SubmenuRow} from '../grid';
import {CenterPane} from '../pane';
import {title, component} from '../../icons/adjust';
import {MacroDetailPane} from './submenus/macros/macro-detail';
import {useAppDispatch, useAppSelector} from '../../../store/hooks';
import {getSelectedConnectedDevice} from '../../../store/devicesSlice';
import {
  getExpressions,
  getIsMacrosReady,
  getMacroCount,
  saveMacros,
} from '../../../store/macrosSlice';
import {getSelectedStateSyncCapability} from '../../../store/stateSyncSlice';
import {refreshMacroDomain} from '../../../store/stateSyncThunks';
import {ConfigureStatusMessage} from './status-message';
import {useTranslation} from 'react-i18next';

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

const MenuContainer = styled.div`
  padding: 15px 10px 20px 10px;
`;

export const Pane: FC = () => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const macrosReady = useAppSelector(getIsMacrosReady);
  const macroExpressions = useAppSelector(getExpressions);
  const macroCount = useAppSelector(getMacroCount);
  const stateSyncCapability = useAppSelector(getSelectedStateSyncCapability);

  const [selectedMacro, setSelectedMacro] = useState(0);

  useEffect(() => {
    if (
      selectedDevice &&
      stateSyncCapability === 'capable' &&
      !macrosReady
    ) {
      void dispatch(refreshMacroDomain(selectedDevice));
    }
  }, [dispatch, macrosReady, selectedDevice, stateSyncCapability]);

  const saveMacro = useCallback(
    async (macro: string) => {
      if (!selectedDevice || !macrosReady) {
        return;
      }

      const newMacros = macroExpressions.map((oldMacro, i) =>
        i === selectedMacro ? macro : oldMacro,
      );

      return dispatch(saveMacros(selectedDevice, newMacros));
    },
    [
      macroExpressions,
      saveMacros,
      dispatch,
      selectedDevice,
      selectedMacro,
      macrosReady,
    ],
  );

  const macroMenus = useMemo(
    () =>
      Array(macroCount)
        .fill(0)
        .map((_, idx) => idx)
        .map((idx) => (
          <SubmenuRow
            $selected={selectedMacro === idx}
            onClick={() => setSelectedMacro(idx)}
            key={idx}
            style={{borderWidth: 0, textAlign: 'center'}}
          >
            {`M${idx}`}
          </SubmenuRow>
        )),
    [selectedMacro, macroCount],
  );

  if (!selectedDevice) {
    return null;
  }
  return (
    <>
      <SubmenuOverflowCell>
        <MenuContainer>{macroMenus}</MenuContainer>
      </SubmenuOverflowCell>
      <OverflowCell>
        <MacroPane>
          <Container>
            {macrosReady ? (
              <MacroDetailPane
                macroExpressions={macroExpressions}
                selectedMacro={selectedMacro}
                saveMacros={saveMacro}
                protocol={selectedDevice.protocol}
              />
            ) : (
              <ConfigureStatusMessage role="status">
                {t('Loading...')}
              </ConfigureStatusMessage>
            )}
          </Container>
        </MacroPane>
      </OverflowCell>
    </>
  );
};

// TODO: these are used in the context that configure.tsx imports menus with props Icon, Title, Pane.
// Should we encapsulate this type and wrap the exports to conform to them?
export const Icon = component;
export const Title = title;
