import {useEffect, useState} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getMenuObservation,
  menuObservationScope,
  refreshMenuObservation,
} from 'src/store/menuObservationThunks';
import {LINK_RESULT, POLLING_CURRENT, type MenuObservationValue} from 'src/utils/menu-observation';
import {getSelectedDevicePath} from 'src/store/devicesSlice';
import {isApplying} from 'src/store/applyingSlice';
import {refreshCustomMenuValue} from 'src/store/menusSlice';
import {ControlRow, Label, Detail} from '../../grid';
import {ApplyNote} from './deferred-apply';

const Row = styled(ControlRow)`
  flex-wrap: wrap;
`;
const Actions = styled(Detail)`
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
`;

type LinkLevels = {scope: string; current: MenuObservationValue; stored?: MenuObservationValue};

const linkLevel = (bytes: number[] | null): MenuObservationValue => {
  if (!bytes) return {status: 'error'};
  const end = bytes.indexOf(0);
  const text = String.fromCharCode(...bytes.slice(0, end));
  return end >= 0 && ['High', 'Medium', 'Low', 'Unknown'].includes(text)
    ? {status: 'ready', text}
    : {status: 'malformed'};
};

// LINK's current speed is a scoped receipt of an explicit read, not a draft or
// a CONFIG-cache value. Keep it stable during background reads and retire it on
// failures or context changes, just like the polling observation.
export const useMenuObservation = (command?: string) => {
  const dispatch = useAppDispatch();
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [levels, setLevels] = useState<LinkLevels>();
  const scope = useAppSelector(menuObservationScope);
  const value = useAppSelector((state) => command ? getMenuObservation(state, command) : undefined);
  const applying = useAppSelector((state) => {
    const path = getSelectedDevicePath(state);
    return !!path && isApplying(state, path, 'menu');
  });
  useEffect(() => {
    if (!command || !scope || applying) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (!active || (typeof document !== 'undefined' && document.hidden))
        return;
      const result = await dispatch(refreshMenuObservation(command));
      if (!active) return;
      if (
        command !== POLLING_CURRENT &&
        active &&
        result &&
        ['ready', 'unsupported', 'malformed'].includes(result.status)
      ) {
        const current = linkLevel(await dispatch(refreshCustomMenuValue('id_qmk_split_link_runtime')));
        if (!active) return;
        const stored = current.status === 'ready'
          ? linkLevel(await dispatch(refreshCustomMenuValue('id_qmk_split_link_stored')))
          : undefined;
        if (!active) return;
        setLevels({scope, current, stored});
        if (current.status !== 'error' && stored?.status !== 'error') {
          timer = setTimeout(refresh, 1000);
        }
      } else if (active && result?.status === 'malformed') {
        timer = setTimeout(refresh, 1000);
      } else if (command === LINK_RESULT) {
        setLevels({scope, current: result ?? {status: 'error'}});
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
  return {value, levels: levels?.scope === scope ? levels : undefined, applying};
};

export const ObservationText = ({value}: {value?: MenuObservationValue}) => {
  const {t} = useTranslation();
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
  return <span role="status">{text}</span>;
};

export const ObservationRow = ({label, value}: {label: string; value?: MenuObservationValue}) => (
    <Row>
      <Label>{label}</Label>
      <Actions>
        <ObservationText value={value} />
      </Actions>
    </Row>
);

export const MenuObservation = ({command, label}: {command: string; label: string}) => {
  const {value} = useMenuObservation(command);
  return <ObservationRow label={label} value={value} />;
};

export const LinkApplyStatus = ({observation, confirmed}: {
  observation: ReturnType<typeof useMenuObservation>;
  confirmed: boolean;
}) => {
  const {t} = useTranslation();
  const {value, levels, applying} = observation;
  if (applying) return <ApplyNote role="status">{t('Applying...')}</ApplyNote>;
  if (value?.status === 'ready' && /^(Pending|Busy|Failed|Cancelled)/.test(value.text)) {
    return <ApplyNote role={value.text.startsWith('Pending') ? 'status' : 'alert'}>{value.text}</ApplyNote>;
  }
  if (value && !['ready', 'unsupported', 'loading'].includes(value.status)) {
    return <ApplyNote><ObservationText value={value} /></ApplyNote>;
  }
  const {current, stored} = levels ?? {};
  if (current?.status === 'ready' && stored) {
    if (stored.status !== 'ready') return <ApplyNote><ObservationText value={stored} /></ApplyNote>;
    if (current.text !== stored.text) {
      return <ApplyNote role="alert">{t('Current and saved speeds differ.')}</ApplyNote>;
    }
    if (confirmed && current.text !== 'Unknown' && (value?.status === 'unsupported' ||
      (value?.status === 'ready' && (value.text === `Applied ${current.text}` || value.text === 'Already set')))) {
      return <ApplyNote role="status">{t('Applied')}</ApplyNote>;
    }
  }
  return null;
};
