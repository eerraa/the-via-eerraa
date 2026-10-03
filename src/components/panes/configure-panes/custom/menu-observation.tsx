import {useEffect, useState} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getMenuObservation,
  menuObservationScope,
  refreshMenuObservation,
} from 'src/store/menuObservationThunks';
import {POLLING_CURRENT} from 'src/utils/menu-observation';
import {getSelectedDevicePath} from 'src/store/devicesSlice';
import {isApplying} from 'src/store/applyingSlice';
import {refreshCustomMenuValue} from 'src/store/menusSlice';
import {ControlRow, Label, Detail} from '../../grid';
import {AccentButton} from '../../../inputs/accent-button';

const Row = styled(ControlRow)`
  flex-wrap: wrap;
`;
const Actions = styled(Detail)`
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
`;
const Note = styled.div`
  flex-basis: 100%;
  font-size: 16px;
  line-height: 1.4;
  padding-bottom: 12px;
  color: var(--color_label);
`;

export const MenuObservation = ({
  command,
  label,
}: {
  command: string;
  label: string;
}) => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const scope = useAppSelector(menuObservationScope);
  const value = useAppSelector((state) => getMenuObservation(state, command));
  const applying = useAppSelector((state) => {
    const path = getSelectedDevicePath(state);
    return !!path && isApplying(state, path, 'menu');
  });
  useEffect(() => {
    if (applying) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (!active || (typeof document !== 'undefined' && document.hidden))
        return;
      const result = await dispatch(refreshMenuObservation(command));
      if (
        command !== POLLING_CURRENT &&
        active &&
        result &&
        ['ready', 'unsupported', 'malformed'].includes(result.status)
      ) {
        await dispatch(refreshCustomMenuValue('id_qmk_split_link_runtime'));
        if (active)
          await dispatch(refreshCustomMenuValue('id_qmk_split_link_stored'));
        if (active) timer = setTimeout(refresh, 1000);
      }
    };
    void refresh();
    const activate = () => {
      if (!document.hidden) {
        setRefreshEpoch((epoch) => epoch + 1);
      }
    };
    if (typeof document !== 'undefined')
      document.addEventListener?.('visibilitychange', activate);
    return () => {
      active = false;
      clearTimeout(timer);
      if (typeof document !== 'undefined')
        document.removeEventListener?.('visibilitychange', activate);
    };
  }, [command, scope, dispatch, applying, refreshEpoch]);
  const status = value?.status;
  const text =
    value?.status === 'ready'
      ? value.text
      : status === 'unsupported'
        ? t('Not supported by this firmware')
        : status === 'timeout'
          ? t('Read timed out')
          : status === 'malformed'
            ? t('Invalid response')
            : status === 'disconnected'
              ? t('Disconnected')
              : status === 'error'
                ? t('Read failed')
                : t('Loading...');
  return (
    <Row>
      <Label>{label}</Label>
      <Actions>
        <span role="status">{text}</span>
        {command === POLLING_CURRENT && (
          <AccentButton
            type="button"
            disabled={!scope || applying || status === 'loading'}
            onClick={() => setRefreshEpoch((epoch) => epoch + 1)}
          >
            {t('Refresh')}
          </AccentButton>
        )}
      </Actions>
      {command === POLLING_CURRENT && (
        <Note>
          {t('Keyboard IN interval setting at the last successful read; not measured host polling or input latency.')}
        </Note>
      )}
    </Row>
  );
};
