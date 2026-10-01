import {faDownload} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {type FC, useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {useTranslation} from 'react-i18next';
import styled from 'styled-components';
import {useLocation} from 'wouter';
import {navigate} from 'wouter/use-location';
import {
  type FirmwareBoardInfo,
  type FirmwareData,
  type FirmwareFile,
  type FirmwareMaker,
  type FirmwareUpdateStatus,
  formatFirmwareFileSize,
  getFirmwareBoardInfo,
  getFirmwareFileName,
  getMakerBoard,
  getStatusMaker,
  readRememberedMaker,
  rememberMaker,
  sortMakersForDisplay,
} from 'src/utils/era-firmware-catalog';
import {getEraFirmwareReleaseDate} from 'src/utils/era-firmware-version';
import {
  followFirmwareLink,
  getFirmwareBoardPath,
  getFirmwarePath,
  parseFirmwarePath,
  resolveFirmwareRoute,
  stayOnFirmwarePage,
} from 'src/utils/firmware-route';
import {
  getFirmwareData,
  useSelectedFirmwareUpdate,
} from 'src/utils/use-firmware-catalog';
import {
  AccentLink,
  FirmwareLinkButton,
  PrimaryAccentLink,
} from '../firmware-link';
import {AccentButton, focusRing} from '../inputs/accent-button';
import {Announcement, TabRow} from '../inputs/keycode-palette/palette-parts';
import {FirmwareKeyboard} from './firmware-keyboard';
import {
  ControlRow,
  Detail,
  Grid,
  IconContainer,
  Label,
  MenuCell,
  Row,
} from './grid';
import {Pane} from './pane';
import {
  SubmenuTabBar,
  SubmenuTabLink,
  TabbedBody,
  TabbedCell,
} from './submenu-tabs';

// ADR 0004 §4. The page speaks the grammar of the rest of the app: the list is
// one column of setting rows, with maker selection in the body; a board's page puts
// that board where Configure shows the keyboard, with its file and steps as rows
// below. It reads the bundled catalog and the selected keyboard's already-loaded
// state only; it never talks to the keyboard, and it renders without WebHID.

const NARROW = '@media (max-width: 720px)';

const FirmwareGrid = styled(Grid)`
  overflow: hidden;

  /* A phone stacks the cells: the rail goes, the rows take the width. */
  ${NARROW} {
    display: flex;
    flex-direction: column;

    > div {
      flex: 1;
      min-width: 0;
      min-height: 0;
    }
  }
`;

const Rail = styled(MenuCell)`
  pointer-events: all;
  border-top: none;

  ${NARROW} {
    display: none;
  }
`;

const RailList = styled.div`
  padding: 15px 10px 20px 10px;
`;

const Panel = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
`;

// Keep the common keyboard height in short windows; let the whole board page
// scroll rather than squeezing its download controls into a zero-height panel.
const BoardPane = styled(Pane)`
  @media (max-height: 650px) {
    overflow-y: auto;

    ${Panel} {
      flex: none;
    }

    ${FirmwareGrid} {
      height: auto;
      overflow: visible;
    }

    ${TabbedCell},
    ${TabbedBody} {
      flex: none;
      overflow: visible;
    }
  }
`;

const MakerTabs = styled.div`
  flex: none;

  nav {
    height: auto;
    min-height: 56px;
    flex-wrap: wrap;
  }
`;

const MakerChoice = styled(SubmenuTabLink)`
  flex: 0 0 auto;
  box-sizing: border-box;
  max-width: 100%;
  min-height: 56px;
  justify-content: center;
  text-align: center;
  white-space: normal;
  overflow-wrap: anywhere;
`;

const MakerChoices = styled(TabRow)`
  width: 100%;
  max-width: 960px;
  justify-content: center;
`;

const MakerNavigation: FC<{
  makers: FirmwareMaker[];
  maker: FirmwareMaker | null;
  boardId?: string;
}> = ({makers, maker, boardId}) => {
  const {t} = useTranslation();
  return (
    <MakerTabs data-firmware-maker-navigation="true">
      <SubmenuTabBar links label={t('Keyboard maker')}>
        {makers.map((candidate) => {
          const keepBoard = !!(boardId && getMakerBoard(candidate, boardId));
          const selected = candidate.id === maker?.id;
          const to = getFirmwarePath(
            candidate.id,
            !selected && keepBoard ? boardId : null,
          );
          return (
            <MakerChoice
              key={candidate.id}
              href={to}
              $selected={selected}
              aria-current={selected ? 'page' : undefined}
              data-firmware-maker={candidate.id}
              onClick={
                selected && !boardId
                  ? stayOnFirmwarePage
                  : followFirmwareLink(to, {
                      replace: true,
                      onNavigate: () => {
                        if (!selected && keepBoard && boardId) {
                          rememberMaker(boardId, candidate.id);
                        }
                      },
                    })
              }
            >
              {candidate.name}
            </MakerChoice>
          );
        })}
      </SubmenuTabBar>
    </MakerTabs>
  );
};

const readFirmwareSearch = () =>
  typeof location === 'undefined' ? '' : location.search;
const subscribeFirmwareSearch = (callback: () => void) => {
  if (typeof window === 'undefined' || !window.addEventListener) return () => {};
  const events = ['popstate', 'pushState', 'replaceState'];
  events.forEach((event) => window.addEventListener(event, callback));
  return () =>
    events.forEach((event) => window.removeEventListener(event, callback));
};

const Column = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 12px 24px;

  ${NARROW} {
    padding: 0 16px 24px;
  }
`;

const Line = styled(ControlRow)<{$connected?: boolean}>`
  align-items: center;
  gap: 8px 16px;
  box-shadow: ${(props) =>
    props.$connected ? 'inset 3px 0 0 var(--color_accent)' : 'none'};

  ${NARROW} {
    flex-wrap: wrap;
    line-height: 1.4;
    padding-top: 10px;
    padding-bottom: 10px;
  }
`;

const Values = styled(Detail)`
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px 16px;
  line-height: 1.4;
`;

const BoardLink = styled.a<{$strong: boolean}>`
  color: ${(props) =>
    props.$strong ? 'var(--color_label-highlighted)' : 'var(--color_label)'};
  opacity: 1;

  &:hover {
    opacity: 1;
    color: var(--color_accent-text);
  }
  ${focusRing}
`;

const Muted = styled.span`
  color: var(--color_label);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
`;

const VersionText = styled.span`
  color: var(--color_accent-text);
  font-variant-numeric: tabular-nums;
`;

const HashValue = styled.code`
  font-family: 'Fira Code', Consolas, monospace;
  font-size: 14px;
  color: var(--color_label);
  overflow-wrap: anywhere;
  user-select: text;
`;

const Steps = styled.div`
  box-sizing: border-box;
  width: 100%;
  max-width: 960px;
  padding: 10px 5px 16px;
  border-bottom: 1px solid var(--border_color_cell);
  color: var(--color_label-highlighted);
  font-size: 17px;
  line-height: 1.6;

  ol,
  ul {
    margin: 0;
    padding-left: 22px;
  }
  ol li {
    list-style: decimal;
    margin: 2px 0;
  }
  ul {
    margin-top: 10px;
    color: var(--color_label);
    font-size: 16px;
  }
  ul li {
    list-style: disc;
    margin: 2px 0;
  }
`;

const CopyHash: FC<{value: string}> = ({value}) => {
  const {t} = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);
  return (
    <>
      <AccentButton
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            // The hash stays selectable text when the clipboard is unavailable.
          }
        }}
      >
        {copied ? t('Copied') : t('Copy')}
      </AccentButton>
      <Announcement role="status">{copied ? t('Copied') : ''}</Announcement>
    </>
  );
};

const FlashingSteps: FC<{board: FirmwareBoardInfo}> = ({board}) => {
  const {t} = useTranslation();
  const h7s = board.family === 'h7s';
  // Bootmagic reads each half's own top-left key, and each half reports only
  // its own VERSION while it is the one on USB.
  const steps = [
    t('Download the ZIP and unzip it. The .uf2 file is inside.'),
    h7s
      ? t(
          'Enter the bootloader with SYSTEM → BOOT → Jump To BOOT, a QK_BOOT key, or by holding the top-left key while plugging in USB.',
        )
      : board.split
      ? t(
          'Enter the bootloader with SYSTEM → BOOT → Jump To BOOT, a QK_BOOT key, or by holding the top-left key of each half while plugging in its USB (Bootmagic, resets the keymap and settings).',
        )
      : t(
          'Enter the bootloader with SYSTEM → BOOT → Jump To BOOT, a QK_BOOT key, or by holding the top-left key while plugging in USB (Bootmagic, resets the keymap and settings).',
        ),
    h7s
      ? t(
          "Copy the .uf2 file to the bootloader's removable disk. The keyboard restarts when the copy finishes.",
        )
      : t(
          'Copy the .uf2 file to the RPI-RP2 drive that appears. The keyboard restarts when the copy finishes.',
        ),
    board.split
      ? t(
          'Split keyboard: flash both halves with the same .uf2 file, one half at a time, and check SYSTEM → VERSION on each half.',
        )
      : t('Check SYSTEM → VERSION after the update.'),
  ];
  const notes = [
    h7s
      ? t(
          'Installing a different firmware version resets the keymap, macros and VIA settings on first boot. Back up the keymap, macros and Tap Dance with Save + Load first.',
        )
      : t(
          'Installing a different firmware version can reset the keymap, macros and VIA settings on first boot. Back up the keymap, macros and Tap Dance with Save + Load first.',
        ),
    t(
      "If the keyboard doesn't appear after the update, press Authorize device again.",
    ),
    t('The ZIP also contains a readme and the usevia.app folder for official VIA.'),
  ];
  return (
    <Steps>
      <ol>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <ul>
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </Steps>
  );
};

const FirmwareRail: FC = () => {
  const {t} = useTranslation();
  return (
    <Rail>
      <RailList>
        <Row $selected={true} $static title={t('Firmware')}>
          <IconContainer>
            <FontAwesomeIcon icon={faDownload} />
          </IconContainer>
        </Row>
      </RailList>
    </Rail>
  );
};

/**
 * The connected keyboard as the first row, read like a list row: its name leads
 * to its page, then how it compares, then its file.
 */
const ConnectedRow: FC<{
  status: FirmwareUpdateStatus;
  viewing: {maker: string | null; board: string | null};
}> = ({status, viewing}) => {
  const {t} = useTranslation();
  if (!('board' in status)) {
    return null;
  }
  const {board} = status;
  const maker = getStatusMaker(status);
  const to = getFirmwareBoardPath(maker?.id ?? null, board.id);
  // On its own page the name leads nowhere and the file is the next row.
  const showingIt =
    viewing.maker === (maker?.id ?? null) && viewing.board === board.id;
  const name = board.name;
  const file = 'file' in status ? status.file : null;
  return (
    <Line role="status" data-firmware-status={status.kind} $connected>
      <Label>
        {showingIt ? (
          <BoardLink as="span" $strong>
            {name}
          </BoardLink>
        ) : (
          <BoardLink href={to} onClick={followFirmwareLink(to)} $strong>
            {name}
          </BoardLink>
        )}
      </Label>
      <Values>
        {status.kind === 'choose-maker' && (
          <>
            {status.update && (
              <Muted>
                {status.update.version
                  ? t('Latest {{version}}', {version: status.update.version})
                  : t('New version')}
              </Muted>
            )}
            <Muted>{t('Which maker sold this keyboard?')}</Muted>
            {status.makers.map((candidate) => (
              <FirmwareLinkButton
                key={candidate.id}
                to={getFirmwarePath(candidate.id, board.id)}
                onNavigate={() => rememberMaker(board.id, candidate.id)}
              >
                {candidate.name}
              </FirmwareLinkButton>
            ))}
          </>
        )}
        {status.kind === 'unpublished' && <Muted>{t('Not published')}</Muted>}
        {status.kind === 'no-claim' && (
          <VersionText>
            {t('Latest {{version}}', {version: status.file.version})}
          </VersionText>
        )}
        {status.kind === 'up-to-date' && (
          <Muted>
            {t('Current {{version}}', {version: status.current})} ·{' '}
            {t('Up to date')}
          </Muted>
        )}
        {status.kind === 'update-available' && (
          <>
            <Muted>
              {t('Current {{version}}', {version: status.current})} →
            </Muted>
            <VersionText>
              {t('Latest {{version}}', {version: status.file.version})}
            </VersionText>
          </>
        )}
        {file && !showingIt && (
          <FirmwareLinkButton
            to={to}
            primary={status.kind === 'update-available'}
          >
            {t('Download')}
          </FirmwareLinkButton>
        )}
        {maker && status.makers.length > 1 && (
          <AccentButton
            type="button"
            title={t('Change maker')}
            aria-label={t('Change maker')}
            onClick={() => rememberMaker(board.id, null)}
          >
            {t('Change')}
          </AccentButton>
        )}
      </Values>
    </Line>
  );
};

const DownloadLink: FC<{
  file: FirmwareFile;
  primary?: boolean;
}> = ({file, primary}) => {
  const {t} = useTranslation();
  const Link = primary ? PrimaryAccentLink : AccentLink;
  return (
    <Link href={file.url} download={getFirmwareFileName(file)}>
      {t('Download')}
    </Link>
  );
};

const useConnected = () => {
  const status = useSelectedFirmwareUpdate();
  const board = status && 'board' in status ? status.board : null;
  const maker = getStatusMaker(status);
  const makerIds = maker
    ? [maker.id]
    : status && 'makers' in status
    ? status.makers.map((candidate) => candidate.id)
    : [];
  return {status, board, maker, makerIds};
};

const MakersView: FC<{makers: FirmwareMaker[]}> = ({makers}) => {
  const {t} = useTranslation();
  return (
    <Pane data-firmware-page="true" data-firmware-view="makers">
      <Panel>
        <FirmwareGrid>
          <FirmwareRail />
          <TabbedCell>
            <TabbedBody>
              <Column>
                <MakerChoices
                  as="nav"
                  $height={56}
                  aria-label={t('Keyboard maker')}
                  data-firmware-maker-navigation="chooser"
                >
                  {makers.map((maker) => {
                    const to = getFirmwarePath(maker.id);
                    return (
                      <MakerChoice
                        key={maker.id}
                        href={to}
                        onClick={followFirmwareLink(to)}
                        $selected={false}
                        data-firmware-maker={maker.id}
                      >
                        {maker.name}
                      </MakerChoice>
                    );
                  })}
                </MakerChoices>
              </Column>
            </TabbedBody>
          </TabbedCell>
        </FirmwareGrid>
      </Panel>
    </Pane>
  );
};

const ListView: FC<{
  data: FirmwareData;
  makers: FirmwareMaker[];
  maker: FirmwareMaker;
}> = ({data, makers, maker}) => {
  const {t} = useTranslation();
  const connected = useConnected();
  return (
    <Pane data-firmware-page="true" data-firmware-view="list">
      <Panel>
        <FirmwareGrid>
          <FirmwareRail />
          <TabbedCell>
            <MakerNavigation makers={makers} maker={maker} />
            <TabbedBody>
              <Column>
                {connected.status && (
                  <ConnectedRow
                    status={connected.status}
                    viewing={{maker: null, board: null}}
                  />
                )}
                {maker.boards.map((entry) => {
                  const board = getFirmwareBoardInfo(data, entry.board);
                  const to = getFirmwarePath(maker.id, board.id);
                  const isConnected =
                    connected.board?.id === board.id &&
                    connected.makerIds.includes(maker.id);
                  return (
                    <Line
                      key={board.id}
                      $connected={isConnected}
                      data-firmware-board={board.id}
                      data-firmware-connected={isConnected ? 'true' : undefined}
                    >
                      <Label>
                        <BoardLink
                          href={to}
                          onClick={followFirmwareLink(to)}
                          $strong={isConnected}
                        >
                          {board.name}
                        </BoardLink>
                      </Label>
                      <Values>
                        {entry.file ? (
                          <>
                            <VersionText>{entry.file.version}</VersionText>
                            <FirmwareLinkButton to={to}>
                              {t('Download')}
                            </FirmwareLinkButton>
                          </>
                        ) : (
                          <Muted>{t('Not published')}</Muted>
                        )}
                      </Values>
                    </Line>
                  );
                })}
              </Column>
            </TabbedBody>
          </TabbedCell>
        </FirmwareGrid>
      </Panel>
    </Pane>
  );
};

const BoardView: FC<{
  data: FirmwareData;
  boardId: string;
  maker: FirmwareMaker | null;
  makers: FirmwareMaker[];
}> = ({data, boardId, maker, makers}) => {
  const {t} = useTranslation();
  const connected = useConnected();
  const board = getFirmwareBoardInfo(data, boardId);
  const file = maker ? getMakerBoard(maker, boardId)?.file ?? null : null;
  const showConnected =
    connected.status !== null && connected.board?.id === boardId;
  return (
    <BoardPane data-firmware-page="true" data-firmware-view="board">
      <FirmwareKeyboard data={data} boardId={boardId} />
      <Panel>
        <FirmwareGrid>
          <FirmwareRail />
          <TabbedCell>
            <MakerNavigation
              makers={sortMakersForDisplay(data.catalog.makers)}
              maker={maker}
              boardId={boardId}
            />
            <TabbedBody>
              <Column>
                {showConnected && connected.status && (
                  <ConnectedRow
                    status={connected.status}
                    viewing={{maker: maker?.id ?? null, board: boardId}}
                  />
                )}
                <Line data-firmware-file={file ? 'published' : 'none'}>
                  <Label
                    title={t('Latest firmware')}
                    data-firmware-board-name="true"
                  >
                    {board.name}
                  </Label>
                  <Values>
                    {!maker ? (
                      <>
                        <Muted>{t('Which maker sold this keyboard?')}</Muted>
                        {makers.map((candidate) => (
                          <FirmwareLinkButton
                            key={candidate.id}
                            to={getFirmwarePath(candidate.id, boardId)}
                            onNavigate={() =>
                              rememberMaker(boardId, candidate.id)
                            }
                          >
                            {candidate.name}
                          </FirmwareLinkButton>
                        ))}
                      </>
                    ) : file ? (
                      <>
                        <VersionText>{file.version}</VersionText>
                        <Muted>
                          {getEraFirmwareReleaseDate(file.version)} ·{' '}
                          {formatFirmwareFileSize(file.size)}
                        </Muted>
                        <DownloadLink file={file} primary />
                      </>
                    ) : (
                      <Muted>{t('Not published')}</Muted>
                    )}
                  </Values>
                </Line>
                {file && (
                  <Line>
                    <Label>{t('SHA-256')}</Label>
                    <Values>
                      <HashValue>{file.sha256}</HashValue>
                      <CopyHash value={file.sha256} />
                    </Values>
                  </Line>
                )}
                <Line>
                  <Label>{t('How to flash')}</Label>
                </Line>
                <FlashingSteps board={board} />
              </Column>
            </TabbedBody>
          </TabbedCell>
        </FirmwareGrid>
      </Panel>
    </BoardPane>
  );
};

export const FirmwarePane: FC = () => {
  const [location] = useLocation();
  const data = getFirmwareData();
  const makers = useMemo(
    () => sortMakersForDisplay(data.catalog.makers),
    [data],
  );
  const connected = useConnected();
  const search = useSyncExternalStore(
    subscribeFirmwareSearch,
    readFirmwareSearch,
    readFirmwareSearch,
  );
  const route = resolveFirmwareRoute(
    parseFirmwarePath(location) ?? {maker: null, board: null},
    makers,
    readRememberedMaker,
  );
  const rootEntry = location.replace(/\/+$/, '') === getFirmwarePath();
  const showConnectedBoard =
    rootEntry && !!connected.board && !new URLSearchParams(search).has('makers');
  // Keep the file page open after the user disconnects to flash the keyboard.
  useEffect(() => {
    if (showConnectedBoard && connected.board) {
      navigate(
        getFirmwareBoardPath(connected.maker?.id ?? null, connected.board.id),
        {replace: true},
      );
    }
  }, [showConnectedBoard, connected.board?.id, connected.maker?.id]);
  if (route.view === 'board') {
    return (
      <BoardView
        data={data}
        boardId={route.board}
        maker={route.maker}
        makers={route.makers}
      />
    );
  }
  if (route.maker) {
    return <ListView data={data} makers={makers} maker={route.maker} />;
  }
  if (showConnectedBoard && connected.board) {
    return (
      <BoardView
        data={data}
        boardId={connected.board.id}
        maker={connected.maker}
        makers={makers.filter((maker) => connected.makerIds.includes(maker.id))}
      />
    );
  }
  return <MakersView makers={makers} />;
};
