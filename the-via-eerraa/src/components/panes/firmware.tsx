import {faChevronDown, faDownload} from '@fortawesome/free-solid-svg-icons';
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
  formatFirmwareFileSize,
  getFirmwareBoardInfo,
  getFirmwareFileName,
  getFirmwareHistory,
  getMakerBoard,
  getStatusMaker,
  sortMakersForDisplay,
} from 'src/utils/era-firmware-catalog';
import {
  compareEraFirmwareVersions,
  formatEraFirmwareVersion,
  readEraFirmwareVersion,
} from 'src/utils/era-firmware-version';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedCurrentCustomMenuData} from 'src/store/menusSlice';
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
import {DirtyDot} from '../inputs/dirty-dot';
import {Announcement} from '../inputs/keycode-palette/palette-parts';
import {
  SAMPLE_CONNECTED_VERSION,
  SAMPLE_TEXT,
  withSampleHistory,
} from './firmware-history-demo';
import {FirmwareKeyboard, FirmwareStage} from './firmware-keyboard';
import {FirmwareVersionLine} from './firmware-version-line';
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
// state. Its device badge reuses Configure's connection flow; downloads also
// render without WebHID.

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

// Keep the common keyboard height in short windows; let the whole firmware page
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

const Prompt = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  box-sizing: border-box;
  text-align: center;

  &::before {
    content: '';
    width: 40px;
    height: 1px;
    margin-bottom: 12px;
    background: currentColor;
    opacity: 0.3;
  }
`;

const PromptTitle = styled.h1`
  margin: 0;
  max-width: 720px;
  font-size: clamp(20px, 2.2vw, 32px);
  font-weight: 400;
  line-height: 1.45;
  letter-spacing: -0.025em;
  text-wrap: balance;
`;

const FirmwarePlaceholder: FC = () => {
  const {t} = useTranslation();
  return (
    <FirmwareStage>
      <Prompt data-firmware-placeholder="true">
        <PromptTitle>{t('Find firmware')}</PromptTitle>
      </Prompt>
    </FirmwareStage>
  );
};

const MakerNavigation: FC<{
  makers: FirmwareMaker[];
  maker: FirmwareMaker | null;
  boardId?: string;
}> = ({makers, maker, boardId}) => {
  const {t} = useTranslation();
  const connected = useConnected();
  return (
    <MakerTabs
      data-firmware-maker-navigation={!maker && !boardId ? 'chooser' : 'true'}
    >
      <SubmenuTabBar links label={t('Keyboard maker')}>
        {makers.map((candidate) => {
          const keepBoard = !!(boardId && getMakerBoard(candidate, boardId));
          const selected = candidate.id === maker?.id;
          const isConnected = candidate.id === connected.maker?.id;
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
              title={isConnected
                ? t('Connected keyboard {{board}}', {board: connected.board?.name})
                : undefined}
              onClick={
                selected && !boardId
                  ? stayOnFirmwarePage
                  : followFirmwareLink(to, {
                      replace: !!maker || !!boardId,
                    })
              }
            >
              {candidate.name}
              {isConnected && (
                <DirtyDot
                  aria-hidden="true"
                  data-firmware-connected-maker={candidate.id}
                />
              )}
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

// A board page's name, bright when it is the connected keyboard's.
const BoardName = styled(Label)<{$connected: boolean}>`
  color: ${(props) =>
    props.$connected ? 'var(--color_label-highlighted)' : 'var(--color_label)'};
`;

// The connected keyboard's version leading into the file's: "Current 261005R1 →".
const VersionPair = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
`;

// A board's version, which unfolds its release line. Older versions are for the
// few who look for them, so the line stays folded until asked for.
const VersionToggle = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color_accent-text);
  font: inherit;
  font-variant-numeric: tabular-nums;
  cursor: pointer;

  > svg {
    color: var(--color_label);
    font-size: 12px;
    transition: transform 0.15s ease-out;
  }
  &[aria-expanded='true'] > svg {
    transform: rotate(180deg);
  }
  &:hover > svg {
    color: var(--color_label-highlighted);
  }
  ${focusRing}
`;

const DemoCaption = styled.div`
  box-sizing: border-box;
  width: 100%;
  max-width: 960px;
  padding: 8px 5px 0;
  color: var(--color_label);
  font-size: 13px;
  text-align: right;
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
    t(
      'Settings may reset after updating. Export a backup first.',
    ),
    ...(board.id === 'may65-h7s' ? [t(
      'MAY65: backups from before Insert was added require manual keymap reconfiguration.',
    )] : []),
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
  const menuData = useAppSelector(getSelectedCurrentCustomMenuData);
  // The keyboard's own VERSION, whether or not its maker is resolved: a legacy
  // shared-board identity leaves the maker open but still reports it.
  const version = menuData ? readEraFirmwareVersion('ascii', menuData) : null;
  const status = useSelectedFirmwareUpdate(version);
  const board = status && 'board' in status ? status.board : null;
  const maker = getStatusMaker(status);
  const makerIds = maker
    ? [maker.id]
    : status && 'makers' in status
    ? status.makers.map((candidate) => candidate.id)
    : [];
  return {status, board, maker, makerIds, version};
};

const MakersView: FC<{makers: FirmwareMaker[]}> = ({makers}) => {
  return (
    <BoardPane data-firmware-page="true" data-firmware-view="makers">
      <FirmwarePlaceholder />
      <Panel>
        <FirmwareGrid>
          <FirmwareRail />
          <TabbedCell>
            <MakerNavigation makers={makers} maker={null} />
          </TabbedCell>
        </FirmwareGrid>
      </Panel>
    </BoardPane>
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
    <BoardPane data-firmware-page="true" data-firmware-view="list">
      <FirmwarePlaceholder />
      <Panel>
        <FirmwareGrid>
          <FirmwareRail />
          <TabbedCell>
            <MakerNavigation makers={makers} maker={maker} />
            <TabbedBody>
              <Column>
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
    </BoardPane>
  );
};

const BoardView: FC<{
  data: FirmwareData;
  boardId: string;
  maker: FirmwareMaker;
}> = ({data, boardId, maker}) => {
  const {t} = useTranslation();
  const connected = useConnected();
  const board = getFirmwareBoardInfo(data, boardId);
  const latest = getMakerBoard(maker, boardId)?.file ?? null;
  const search = useSyncExternalStore(
    subscribeFirmwareSearch,
    readFirmwareSearch,
    readFirmwareSearch,
  );
  const params = new URLSearchParams(search);
  // Prototype only: `?demo=history` puts sample versions on the release line,
  // `&count=` versions in all.
  const demo = params.get('demo') === 'history';
  const count = Number.parseInt(params.get('count') ?? '', 10);
  const published = getFirmwareHistory(data.catalog, maker.id, board);
  const history = demo
    ? withSampleHistory(published, Number.isNaN(count) ? undefined : count)
    : published;
  // `?version=` opens that version of the line; anything else opens the latest.
  const requested = formatEraFirmwareVersion(
    (params.get('version') ?? '').trim().toUpperCase(),
  );
  const selected =
    history.find((entry) => entry.file.version === requested) ??
    history.find((entry) => entry.file.version === latest?.version) ??
    null;
  const file = selected?.file ?? latest;
  const isLatest = !!file && file.version === latest?.version;
  // Folded until asked for, unless the page opens an older version or the
  // sample history.
  const [expanded, setExpanded] = useState(
    () => demo || (!!selected && selected.file.version !== latest?.version),
  );
  // On the connected keyboard's page its file row is the keyboard's row: the
  // version it reports, where that can be trusted, leads into the file's.
  const isConnected =
    connected.board?.id === boardId && connected.makerIds.includes(maker.id);
  const connectedVersion = isConnected ? connected.version : null;
  const status = isConnected ? connected.status : null;
  const current = status && 'current' in status ? status.current : null;
  const connectedLabel = t('Connected keyboard {{board}}', {board: board.name});
  const selectVersion = (version: string) => {
    const next = new URLSearchParams(readFirmwareSearch());
    next.set('version', version);
    navigate(`${window.location.pathname}?${next}`, {replace: true});
  };
  const line = expanded && selected && (
    <FirmwareVersionLine
      history={history}
      selected={selected.file.version}
      connected={connectedVersion ?? (demo ? SAMPLE_CONNECTED_VERSION : null)}
      connectedLabel={
        connectedVersion
          ? connectedLabel
          : `${connectedLabel} · ${SAMPLE_TEXT.tag}`
      }
      onSelect={selectVersion}
    />
  );
  return (
    <BoardPane data-firmware-page="true" data-firmware-view="board">
      <FirmwareKeyboard
        data={data}
        boardId={boardId}
        footer={line}
      />
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
                {demo && (
                  <DemoCaption>
                    {SAMPLE_TEXT.caption(history.length - published.length)}
                  </DemoCaption>
                )}
                <Line
                  $connected={isConnected}
                  data-firmware-file={file ? 'published' : 'none'}
                  data-firmware-file-version={file?.version}
                  data-firmware-connected={isConnected ? 'true' : undefined}
                >
                  <BoardName
                    $connected={isConnected}
                    title={isLatest ? t('Latest firmware') : undefined}
                    data-firmware-board-name="true"
                  >
                    {board.name}
                  </BoardName>
                  <Values>
                    {file ? (
                      <>
                        <VersionPair>
                          {current !== null && (
                            <Muted>
                              {compareEraFirmwareVersions(
                                current,
                                file.version,
                              ) === 0
                                ? t('Current')
                                : `${t('Current {{version}}', {version: current})} →`}
                            </Muted>
                          )}
                          {history.length > 1 ? (
                            <VersionToggle
                              type="button"
                              aria-expanded={expanded}
                              title={t('Firmware versions')}
                              onClick={() => setExpanded((open) => !open)}
                            >
                              {file.version}
                              <FontAwesomeIcon icon={faChevronDown} />
                            </VersionToggle>
                          ) : (
                            <VersionText>{file.version}</VersionText>
                          )}
                        </VersionPair>
                        <Muted>
                          {selected?.sample
                            ? SAMPLE_TEXT.tag
                            : formatFirmwareFileSize(file.size)}
                        </Muted>
                        {selected?.sample ? (
                          <AccentButton
                            type="button"
                            disabled
                            title={SAMPLE_TEXT.noFile}
                          >
                            {t('Download')}
                          </AccentButton>
                        ) : (
                          <DownloadLink
                            file={file}
                            primary={isLatest && status?.kind !== 'up-to-date'}
                          />
                        )}
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
                      {selected?.sample ? (
                        <Muted>{SAMPLE_TEXT.noFile}</Muted>
                      ) : (
                        <>
                          <HashValue>{file.sha256}</HashValue>
                          <CopyHash key={file.sha256} value={file.sha256} />
                        </>
                      )}
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
  );
  const rootEntry = location.replace(/\/+$/, '') === getFirmwarePath();
  const showConnectedBoard =
    rootEntry &&
    !!connected.board &&
    !!connected.maker &&
    !new URLSearchParams(search).has('makers');
  // Keep the file page open after the user disconnects to flash the keyboard.
  useEffect(() => {
    if (showConnectedBoard && connected.board && connected.maker) {
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
      />
    );
  }
  if (route.maker) {
    return <ListView data={data} makers={makers} maker={route.maker} />;
  }
  if (showConnectedBoard && connected.board && connected.maker) {
    return (
      <BoardView
        data={data}
        boardId={connected.board.id}
        maker={connected.maker}
      />
    );
  }
  return <MakersView makers={makers} />;
};
