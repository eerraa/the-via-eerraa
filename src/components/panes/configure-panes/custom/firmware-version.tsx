import {type FC} from 'react';
import {useTranslation} from 'react-i18next';
import styled from 'styled-components';
import {RangeValueDisplay} from '../../../inputs/accent-range';
import {AccentButton} from '../../../inputs/accent-button';
import {FirmwareLinkButton} from '../../../firmware-link';
import {ControlRow, Detail, Label} from '../../grid';
import {
  type EraFirmwareVersionSource,
  readEraFirmwareVersion,
} from 'src/utils/era-firmware-version';
import {getStatusMaker, rememberMaker} from 'src/utils/era-firmware-catalog';
import {FIRMWARE_ROUTE, getFirmwareBoardPath} from 'src/utils/firmware-route';
import {useSelectedFirmwareUpdate} from 'src/utils/use-firmware-catalog';

type Props = {
  source: EraFirmwareVersionSource;
  menuData: Record<string, unknown>;
};

const UpdateLabel = styled(Label)`
  white-space: nowrap;
  flex-shrink: 0;
`;

const UpdateDetail = styled(Detail)`
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px 12px;
  padding: 5px 0;
  line-height: 1.3;
  text-align: right;
`;

const Muted = styled.span`
  color: var(--color_label);
`;

/**
 * ADR 0004 §6: compare VERSION with the bundled catalog. Read-only — it sends
 * nothing to the keyboard and adds no SET or SAVE affordance (ADR 0003 §7).
 */
const FirmwareUpdateRow: FC<{version: string | null}> = ({version}) => {
  const {t} = useTranslation();
  const status = useSelectedFirmwareUpdate(version);
  if (!status) {
    return null;
  }
  const maker = getStatusMaker(status);
  const boardPath =
    'board' in status
      ? getFirmwareBoardPath(maker?.id ?? null, status.board.id)
      : FIRMWARE_ROUTE;

  let content;
  switch (status.kind) {
    case 'update-available':
      content = (
        <>
          <span>
            {t('New version {{version}}', {version: status.file.version})}
          </span>
          <FirmwareLinkButton to={boardPath} primary>
            {t('Open')}
          </FirmwareLinkButton>
        </>
      );
      break;
    case 'up-to-date':
      content = (
        <>
          <span>{t('Up to date')}</span>
          <FirmwareLinkButton to={boardPath}>{t('Open')}</FirmwareLinkButton>
        </>
      );
      break;
    case 'no-claim':
      content = (
        <>
          <span>{t('Latest {{version}}', {version: status.file.version})}</span>
          <FirmwareLinkButton to={boardPath}>{t('Open')}</FirmwareLinkButton>
        </>
      );
      break;
    case 'choose-maker':
      content = (
        <>
          {status.update && (
            <Muted>
              {status.update.version
                ? t('Latest {{version}}', {version: status.update.version})
                : t('New version')}
            </Muted>
          )}
          <span>{t('Which maker sold this keyboard?')}</span>
          {status.makers.map((candidate) => (
            <AccentButton
              key={candidate.id}
              type="button"
              onClick={() => rememberMaker(status.board.id, candidate.id)}
            >
              {candidate.name}
            </AccentButton>
          ))}
        </>
      );
      break;
    default:
      // No file to go to, so no button.
      content = <Muted>{t('Not published')}</Muted>;
  }

  return (
    <ControlRow data-era-firmware-update={status.kind}>
      <UpdateLabel>{t('Firmware update')}</UpdateLabel>
      <UpdateDetail role="status">{content}</UpdateDetail>
    </ControlRow>
  );
};

/** One read-only presentation for both firmware-family wire adapters. */
export const FirmwareVersion: FC<Props> = ({source, menuData}) => {
  const {t} = useTranslation();
  const version = readEraFirmwareVersion(source, menuData);
  return (
    <>
      <ControlRow data-era-firmware-version="true">
        <Label>{t('Current Version')}</Label>
        <Detail>
          <RangeValueDisplay role="status">{version ?? '—'}</RangeValueDisplay>
        </Detail>
      </ControlRow>
      <FirmwareUpdateRow version={version} />
    </>
  );
};
