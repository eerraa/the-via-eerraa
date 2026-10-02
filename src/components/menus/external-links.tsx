import {faDownload} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {useTranslation} from 'react-i18next';
import styled from 'styled-components';
import {useLocation} from 'wouter';
import {getStatusMaker} from 'src/utils/era-firmware-catalog';
import {
  FIRMWARE_ROUTE,
  followFirmwareLink,
  getFirmwareBoardPath,
  isFirmwarePath,
} from 'src/utils/firmware-route';
import {useSelectedFirmwareUpdate} from 'src/utils/use-firmware-catalog';
import {focusRing} from '../inputs/accent-button';
import {Tooltip} from '../inputs/tooltip';
import {LanguageSelect} from './language-select';

const ExternalLinkContainer = styled.span`
  grid-column: 3;
  justify-self: end;
  margin-right: 1em;
  display: flex;
  align-items: center;
  gap: 1em;

  @media (max-width: 720px) {
    max-width: 100%;
    margin-right: 0;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
`;

// ADR 0004 §4: one split control, `ERA │ Firmware`. The wordmark stays the
// platform identity; the second segment is the firmware entry.
const FirmwarePill = styled.a`
  position: relative;
  display: inline-flex;
  align-items: stretch;
  height: 34px;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-radius: 17px;
  color: var(--color_inside-accent);
  opacity: 1;
  text-decoration: none;
  white-space: nowrap;
  user-select: none;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    opacity: 1;
    color: var(--color_accent-text);

    & .tooltip {
      transform: scale(1) translateX(0px);
      opacity: 1;
    }
  }
  ${focusRing}

  .tooltip {
    transform: translateX(5px) scale(0.6);
    opacity: 0;
  }
`;

const EraSegment = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 0 10px 0 13px;
`;

const EraWordmark = styled.span`
  font-family: GothamRoundedBold, 'Fira Sans Condensed', sans-serif;
  font-size: 24px;
  font-weight: 500;
  letter-spacing: -0.08em;
  line-height: 1;
  transform: skewX(-8deg);
`;

const SegmentDivider = styled.span`
  width: 1.5px;
  background: currentColor;
`;

const ActionSegment = styled.span<{$filled: boolean}>`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 13px 0 10px;
  border-radius: 0 15.5px 15.5px 0;
  font-family: 'Fira Sans Condensed', Helvetica, Helvetica Neue, Arial, serif;
  font-size: 16px;
  font-weight: 500;
  text-transform: uppercase;
  background: ${(props) =>
    props.$filled ? 'var(--color_accent)' : 'transparent'};
  color: ${(props) =>
    props.$filled ? 'var(--color_inside-accent)' : 'inherit'};
`;

const tooltipStyles = {
  containerStyles: {
    position: 'absolute',
    top: 44,
    right: 0,
    transformOrigin: 'right',
    transition: 'all 0.1s ease-in-out',
    zIndex: 4,
    pointerEvents: 'none',
  },
  contentStyles: {
    padding: '5px 10px',
    borderRadius: 10,
    background: 'var(--color_accent)',
    color: 'var(--color_inside-accent)',
    fontFamily:
      "'Fira Sans Condensed', Helvetica, Helvetica Neue, Arial, serif",
    fontSize: 18,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
  },
  pointerStyles: {
    borderLeft: '6px solid transparent',
    borderRight: '6px solid transparent',
    borderBottom: '6px solid var(--color_accent)',
    position: 'absolute',
    top: -6,
    right: 22,
    width: 0,
  },
} as const;

const FirmwareEntry = () => {
  const {t} = useTranslation();
  const [location] = useLocation();
  const status = useSelectedFirmwareUpdate();
  const maker = getStatusMaker(status);
  const board = status && 'board' in status ? status.board : null;
  const to = board
    ? getFirmwareBoardPath(maker?.id ?? null, board.id)
    : FIRMWARE_ROUTE;
  // A legacy shared board counts once every maker's release is newer; the
  // number shows only when they agree, and the link still asks for the maker.
  const newer =
    status?.kind === 'update-available'
      ? {version: status.file.version}
      : status?.kind === 'choose-maker'
      ? status.update ?? null
      : null;
  const update =
    newer && board
      ? newer.version
        ? t('{{board}} {{version}}', {
            board: board.name,
            version: newer.version,
          })
        : board.name
      : null;

  return (
    <FirmwarePill
      href={to}
      onClick={followFirmwareLink(to)}
      aria-label={`ERA · ${
        update ? `${t('New version')} · ${update}` : t('Firmware')
      }`}
      data-firmware-update={update ? 'available' : undefined}
    >
      <EraSegment aria-hidden="true">
        <EraWordmark>ERA</EraWordmark>
      </EraSegment>
      <SegmentDivider aria-hidden="true" />
      <ActionSegment
        aria-hidden="true"
        $filled={!!update || isFirmwarePath(location)}
      >
        <FontAwesomeIcon icon={faDownload} />
        {update ? t('New version') : t('Firmware')}
      </ActionSegment>
      {update && <Tooltip {...tooltipStyles}>{update}</Tooltip>}
    </FirmwarePill>
  );
};

export const ExternalLinks = () => (
  <ExternalLinkContainer>
    <LanguageSelect />
    <FirmwareEntry />
  </ExternalLinkContainer>
);
