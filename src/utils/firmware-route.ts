import {navigate} from 'wouter/use-location';

// The firmware download routes (docs/adr/0004-firmware-distribution.md §4):
// `/firmware` and `/firmware/<maker>` list boards, `/firmware/<maker>/<board>`
// is a board's page, and `/firmware/<board>` is the short link to it. They are
// matched here rather than in `pane-config.ts` because the page is not a header
// tab and must render without WebHID. `public/_redirects` is hand-matched to
// this prefix; ZIP files live under `/firmware-files/`, outside it.

export const FIRMWARE_ROUTE = '/firmware';

export const isFirmwarePath = (location: string) =>
  location === FIRMWARE_ROUTE || location.startsWith(`${FIRMWARE_ROUTE}/`);

export type FirmwareRoute = {maker: string | null; board: string | null};

export const parseFirmwarePath = (location: string): FirmwareRoute | null => {
  if (!isFirmwarePath(location)) {
    return null;
  }
  const segments = location
    .slice(FIRMWARE_ROUTE.length)
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  return {maker: segments[0] ?? null, board: segments[1] ?? null};
};

type RoutableMaker = {id: string; boards: readonly {board: string}[]};

export type ResolvedFirmwareRoute<M extends RoutableMaker> =
  | {view: 'list'; maker: M | null}
  | {view: 'board'; board: string; maker: M | null; makers: M[]};

/**
 * What a firmware URL shows. Ids match without regard to case, so a link typed
 * by hand still lands. The short board link opens the board when one maker
 * distributes it, or the one this browser remembered; otherwise the board page
 * asks which maker sold it. Anything unknown falls back to the list.
 */
export const resolveFirmwareRoute = <M extends RoutableMaker>(
  route: FirmwareRoute,
  makers: readonly M[],
  rememberedMaker: (boardId: string) => string | null = () => null,
): ResolvedFirmwareRoute<M> => {
  const first = route.maker?.toLowerCase() ?? null;
  const second = route.board?.toLowerCase() ?? null;
  const maker = makers.find((candidate) => candidate.id === first) ?? null;
  if (maker) {
    return second && maker.boards.some((entry) => entry.board === second)
      ? {view: 'board', board: second, maker, makers: [maker]}
      : {view: 'list', maker};
  }
  if (first && !second) {
    const distributing = makers.filter((candidate) =>
      candidate.boards.some((entry) => entry.board === first),
    );
    if (distributing.length > 0) {
      const remembered = rememberedMaker(first);
      return {
        view: 'board',
        board: first,
        maker:
          distributing.length === 1
            ? distributing[0]
            : distributing.find((candidate) => candidate.id === remembered) ??
              null,
        makers: distributing,
      };
    }
  }
  return {view: 'list', maker: null};
};

export const getFirmwarePath = (
  maker?: string | null,
  board?: string | null,
) =>
  [FIRMWARE_ROUTE, maker, maker ? board : null]
    .filter((segment): segment is string => !!segment)
    .map((segment, index) =>
      index === 0 ? segment : encodeURIComponent(segment),
    )
    .join('/');

/** A board's page: under its maker, or the short link that asks for one. */
export const getFirmwareBoardPath = (maker: string | null, board: string) =>
  maker ? getFirmwarePath(maker, board) : getFirmwarePath(board);

/**
 * The browser tab's title stays generic for firmware routes. Canonical maker
 * links have maker-specific crawler titles in scripts/firmware-share-page.ts;
 * every other route keeps index.html's VIA.
 */
export const getPageTitle = (location: string) =>
  isFirmwarePath(location) ? 'Firmware' : 'VIA';

type LinkClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
};

// Modified clicks (new tab, download) stay with the browser.
const isPlainClick = (event: LinkClick) =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

/**
 * Click handler for a plain `<a href>` that navigates inside the SPA. It needs
 * no router context, so a VERSION row can link to the page from anywhere.
 * `replace` is for switching between views of one page, such as maker tabs, so
 * Back still leaves the page in one step.
 */
export const followFirmwareLink =
  (
    to: string,
    {
      onNavigate,
      replace = false,
    }: {onNavigate?: () => void; replace?: boolean} = {},
  ) =>
  (event: LinkClick) => {
    if (!isPlainClick(event)) {
      return;
    }
    event.preventDefault();
    onNavigate?.();
    navigate(to, {replace});
  };

/** A link to the page already open: a click stays, the address still copies. */
export const stayOnFirmwarePage = (event: LinkClick) => {
  if (isPlainClick(event)) {
    event.preventDefault();
  }
};
