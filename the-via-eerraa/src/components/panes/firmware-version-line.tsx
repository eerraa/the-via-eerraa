import {
  type FC,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {useTranslation} from 'react-i18next';
import styled from 'styled-components';
import {
  type FirmwareHistoryEntry,
  isSameStorageFormat,
} from 'src/utils/era-firmware-catalog';
import {SAMPLE_TEXT} from './firmware-history-demo';

// Concept C (prototype): a board's release line. One tick per published
// version, oldest at the left. The line breaks between neighbours whose
// storage-format keys differ, because flashing across a break resets settings;
// a ring marks the connected keyboard's version.
//
// However many versions there are, the whole line fits its width: ticks sit up
// to MAX_STEP apart and close up as releases accumulate, so every break and the
// ring stay in view instead of scrolling away. The pointer picks the nearest
// tick anywhere along the line and a drag scrubs, so close ticks need no
// fingertip-wide targets of their own. The tick under the pointer, the focused
// tick or a tapped one shows its version and note. The note can itself be
// hovered and stays until the pointer or focus leaves; Escape dismisses it
// wherever focus is (WCAG 1.4.13). Arrow keys, Page Up/Down (ten at a time),
// Home and End move between ticks; Enter or Space, a click or a tap chooses,
// which swaps the file row.
//
// It sits under the board on the keyboard stage, in the stage's own colour, and
// unfolds from the board's version in the file row.

/** Widest tick spacing, so a short history never sprawls across the page. */
const MAX_STEP = 72;
/** Width a break adds to the line, down to MIN_GAP on a crowded line. */
const GAP = 16;
const MIN_GAP = 4;
/** Room past the end ticks for the ring. */
const END = 14;
/** Pointer reach around a tick where ticks are far apart, and past the ends. */
const REACH = 14;
/** On a line closer than this, a finger slides this far per version. */
const TOUCH_STEP = 8;
/** Ticks Page Up and Page Down move. */
const PAGE = 10;
/** Time the pointer has to cross from the line onto its note. */
const LINGER = 250;

type Geometry = {
  step: number;
  /** Width of each break. */
  gap: number;
  /** Tick centres from the track's left edge. */
  x: number[];
  /** Unbroken stretches of the line. */
  segments: {left: number; right: number}[];
  /** Break centres, by the index of the version after the break. */
  gaps: {index: number; x: number}[];
};

const layOut = (breaks: boolean[], width: number): Geometry => {
  const count = breaks.length;
  const breakCount = breaks.filter(Boolean).length;
  const room = Math.max(width - 2 * END, 0);
  // Breaks take at most a fifth of a crowded line, so versions keep the rest.
  const gap = breakCount
    ? Math.min(GAP, Math.max(MIN_GAP, (room * 0.2) / breakCount))
    : 0;
  const step =
    count > 1
      ? Math.min(MAX_STEP, Math.max(room - breakCount * gap, 0) / (count - 1))
      : 0;
  const span = Math.max(count - 1, 0) * step + breakCount * gap;
  const x: number[] = [];
  breaks.forEach((broken, index) => {
    x.push(
      index > 0 ? x[index - 1] + step + (broken ? gap : 0) : (width - span) / 2,
    );
  });
  const segments: Geometry['segments'] = [];
  const gaps: Geometry['gaps'] = [];
  let first = 0;
  for (let index = 1; index <= count; index++) {
    if (index < count && !breaks[index]) {
      continue;
    }
    // Either side of a break stops half a step short, leaving the gap between.
    segments.push({
      left: first === 0 ? x[0] : x[first] - step / 2,
      right: index === count ? x[index - 1] : x[index - 1] + step / 2,
    });
    if (index < count) {
      gaps.push({index, x: (x[index - 1] + x[index]) / 2});
    }
    first = index;
  }
  return {step, gap, x, segments, gaps};
};

const gapId = (version: string) => `gap:${version}`;
const isGap = (id: string) => id.startsWith('gap:');

const nearestTick = (geometry: Geometry, at: number) => {
  let nearest = -1;
  geometry.x.forEach((x, index) => {
    if (nearest < 0 || Math.abs(at - x) < Math.abs(at - geometry.x[nearest])) {
      nearest = index;
    }
  });
  return nearest;
};

/** The break or tick the pointer is at, `at` px from the track's left edge. */
const pick = (geometry: Geometry, versions: string[], at: number) => {
  const gap = geometry.gaps.find(
    (candidate) => Math.abs(at - candidate.x) <= geometry.gap / 2,
  );
  if (gap) {
    return gapId(versions[gap.index]);
  }
  const nearest = nearestTick(geometry, at);
  return nearest >= 0 &&
    Math.abs(at - geometry.x[nearest]) <= Math.max(geometry.step / 2, REACH)
    ? versions[nearest]
    : null;
};

/** Where a tick or break sits along the track. */
const anchorOf = (
  geometry: Geometry,
  versions: string[],
  id: string,
): number | undefined =>
  isGap(id)
    ? geometry.gaps.find((gap) => gapId(versions[gap.index]) === id)?.x
    : geometry.x[versions.indexOf(id)];

// Under the board on the keyboard stage, in the stage's own colour.
const Root = styled.div`
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 6px;
  box-sizing: border-box;
  max-width: 720px;
  margin: 0 auto;
`;

const Track = styled.div`
  position: relative;
  height: 44px;
  touch-action: pan-y;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
`;

const Segment = styled.span`
  position: absolute;
  top: 50%;
  height: 1px;
  background: currentColor;
  opacity: 0.55;
  pointer-events: none;
`;

// One pixel wide at a whole-pixel offset, so the marks centred in it stay sharp.
const Tick = styled.button<{$raised: boolean}>`
  position: absolute;
  top: 0;
  z-index: ${(props) => (props.$raised ? 1 : 'auto')};
  width: 1px;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  /* The track picks the nearest tick for the pointer. */
  pointer-events: none;

  &:focus-visible {
    outline: none;
  }
`;

const Mark = styled.span<{
  $selected: boolean;
  $lit: boolean;
  $height: number;
  $opacity: number;
}>`
  position: absolute;
  top: 50%;
  left: 50%;
  width: ${(props) => (props.$selected ? 3 : 1)}px;
  height: ${(props) =>
    props.$selected ? 20 : props.$lit ? 16 : props.$height}px;
  border-radius: 2px;
  background: currentColor;
  opacity: ${(props) => props.$opacity};
  transform: translate(-50%, -50%);
  transition: height 0.12s ease-out;

  ${Tick}:focus-visible > & {
    outline: 2px solid currentColor;
    outline-offset: 4px;
  }
`;

const Ring = styled.span`
  position: absolute;
  top: 50%;
  left: 50%;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  border: 2px solid currentColor;
  border-radius: 50%;
  transform: translate(-50%, -50%);
`;

// Above the line, over the board, where a finger scrubbing the line cannot
// hide it.
const Tip = styled.div`
  position: absolute;
  bottom: calc(100% + 4px);
  z-index: 3;
  box-sizing: border-box;
  width: max-content;
  max-width: min(320px, 100%);
  padding: 8px 12px;
  border: 1px solid var(--border_color_cell);
  border-radius: 6px;
  background: var(--bg_menu);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  color: var(--color_label-highlighted);
  font-size: 15px;
  line-height: 1.45;
  text-align: left;
`;

const TipHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 8px;
`;

const TipVersion = styled.span`
  color: var(--color_accent-text);
  font-variant-numeric: tabular-nums;
`;

const TipMuted = styled.div`
  color: var(--color_label);
  font-variant-numeric: tabular-nums;
`;

const TipTag = styled.span`
  padding: 0 6px;
  border: 1px solid currentColor;
  border-radius: 4px;
  color: var(--color_label);
  font-size: 12px;
  line-height: 18px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const TipAlert = styled.div`
  color: var(--color_accent-text);
`;

export const FirmwareVersionLine: FC<{
  /** The board's versions, oldest first. */
  history: FirmwareHistoryEntry[];
  selected: string;
  /** The connected keyboard's version, when it is this board. */
  connected: string | null;
  connectedLabel: string;
  onSelect: (version: string) => void;
}> = ({history, selected, connected, connectedLabel, onSelect}) => {
  const {t, i18n} = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const ticks = useRef(new Map<string, HTMLButtonElement>());
  const pointer = useRef('mouse');
  // Where a finger or pen went down: its x and the tick nearest it.
  const press = useRef<{x: number; index: number} | null>(null);
  const overTrack = useRef(false);
  const linger = useRef<number>();
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  // Escape keeps the note hidden until the pointer or focus reaches another.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(selected);
  const [tip, setTip] = useState<{left: number; shift: number} | null>(null);
  const candidate = hovered ?? focused ?? pinned;
  const shown = candidate === dismissed ? null : candidate;

  useEffect(() => setActive(selected), [selected]);

  const versions = history.map((entry) => entry.file.version);
  const breaks = history.map(
    (entry, index) =>
      index > 0 &&
      isSameStorageFormat(history[index - 1].storageKey, entry.storageKey) ===
        false,
  );
  const geometry = layOut(breaks, width);
  // Ticks closer than a few pixels merge into a soft band along the line.
  const dense = history.length > 1 && geometry.step < 4;
  const markHeight =
    dense ? 4 : history.length > 1 && geometry.step < 12 ? 8 : 10;
  const ring =
    history.find((entry) => entry.file.version === connected) ?? null;
  const language = i18n.resolvedLanguage ?? 'en';
  const noteOf = (entry: FirmwareHistoryEntry) =>
    entry.note ? entry.note[language] ?? entry.note.en : null;
  const resets = (entry: FirmwareHistoryEntry) =>
    ring !== null &&
    entry !== ring &&
    isSameStorageFormat(entry.storageKey, ring.storageKey) === false;
  const describe = (entry: FirmwareHistoryEntry, index: number) =>
    [
      entry.file.version,
      noteOf(entry),
      entry.draft ? t('Draft') : null,
      entry.sample ? SAMPLE_TEXT.tag : null,
      entry === ring ? connectedLabel : null,
      resets(entry) ? t('Resets settings') : null,
      breaks[index] ? t('Settings reset across this gap') : null,
    ]
      .filter(Boolean)
      .join(', ');

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) {
      return;
    }
    const measure = () => setWidth(track.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  // The note hangs from the line's frame (the row it sits in) and slides
  // along so it never leaves it.
  const anchor = shown === null ? undefined : anchorOf(geometry, versions, shown);
  useLayoutEffect(() => {
    const track = trackRef.current;
    const frame = tipRef.current?.offsetParent;
    if (!track || !(frame instanceof HTMLElement) || anchor === undefined) {
      setTip(null);
      return;
    }
    const box = frame.getBoundingClientRect();
    const span = frame.clientWidth;
    const left = Math.min(
      Math.max(
        track.getBoundingClientRect().left - box.left - frame.clientLeft + anchor,
        0,
      ),
      span,
    );
    setTip({left, shift: span > 0 ? (left / span) * 100 : 0});
  }, [shown, anchor, width]);

  // Leaving the line or its note hides the note after a moment, so the
  // pointer can cross the gap between them.
  const stay = () => window.clearTimeout(linger.current);
  const leave = () => {
    stay();
    linger.current = window.setTimeout(() => {
      setHovered(null);
      setDismissed(null);
    }, LINGER);
  };
  useEffect(() => () => window.clearTimeout(linger.current), []);

  useEffect(() => {
    if (shown === null) {
      return;
    }
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      setFocused(null);
      setPinned(null);
      if (overTrack.current) {
        // Hidden until the pointer reaches another tick or leaves the line.
        setDismissed(shown);
      } else {
        // The pointer was on the note itself, or nowhere near the line.
        stay();
        setHovered(null);
      }
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [shown]);

  // A tapped tick keeps its note until the next tap elsewhere.
  useEffect(() => {
    if (pinned === null) {
      return;
    }
    const release = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPinned(null);
      }
    };
    document.addEventListener('pointerdown', release);
    return () => document.removeEventListener('pointerdown', release);
  }, [pinned]);

  const trackX = (clientX: number) =>
    clientX - (trackRef.current?.getBoundingClientRect().left ?? 0);
  const pointAt = (clientX: number) => pick(geometry, versions, trackX(clientX));
  // A finger lands on the nearest tick. Where ticks are closer than a finger
  // can tell apart, sliding then steps one version per TOUCH_STEP, so any
  // version can be reached however long the line.
  const touchAt = (clientX: number) => {
    const start = press.current;
    if (!start || geometry.step >= TOUCH_STEP || start.index < 0) {
      return pointAt(clientX);
    }
    const index =
      start.index + Math.round((clientX - start.x) / TOUCH_STEP);
    return versions[Math.min(Math.max(index, 0), versions.length - 1)];
  };

  const choose = (version: string) => {
    setActive(version);
    onSelect(version);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = versions.indexOf(active);
    const next =
      event.key === 'ArrowRight'
        ? index + 1
        : event.key === 'ArrowLeft'
        ? index - 1
        : event.key === 'PageDown'
        ? index + PAGE
        : event.key === 'PageUp'
        ? index - PAGE
        : event.key === 'Home'
        ? 0
        : event.key === 'End'
        ? versions.length - 1
        : null;
    if (next === null) {
      return;
    }
    event.preventDefault();
    // The keyboard takes over from a pointer still resting on another tick.
    pointer.current = 'keyboard';
    setHovered(null);
    const target = versions[Math.min(Math.max(next, 0), versions.length - 1)];
    setActive(target);
    ticks.current.get(target)?.focus();
  };

  const shownIndex =
    shown === null || isGap(shown) ? -1 : versions.indexOf(shown);
  const shownEntry = shownIndex < 0 ? null : history[shownIndex];
  const shownNote = shownEntry && noteOf(shownEntry);

  return (
    <Root ref={rootRef} data-firmware-version-line="true">
      <Track
        ref={trackRef}
        role="toolbar"
        aria-label={t('Firmware versions')}
        style={{
          cursor:
            hovered === null ? undefined : isGap(hovered) ? 'help' : 'pointer',
        }}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
          if (event.pointerType !== 'mouse') {
            // A finger or pen scrubs: the note follows it, lifting chooses.
            event.currentTarget.setPointerCapture(event.pointerId);
            press.current = {
              x: event.clientX,
              index: nearestTick(geometry, trackX(event.clientX)),
            };
            setDismissed(null);
            setPinned(pointAt(event.clientX));
          }
        }}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse') {
            overTrack.current = true;
            const id = pointAt(event.clientX);
            if (id === null) {
              leave();
            } else {
              stay();
              if (id !== hovered) {
                setHovered(id);
                setDismissed(null);
              }
            }
          } else if (press.current) {
            const id = touchAt(event.clientX);
            if (id !== null) {
              setPinned(id);
            }
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') {
            overTrack.current = false;
            leave();
          }
        }}
        onPointerUp={(event) => {
          if (!press.current) {
            return;
          }
          const id = touchAt(event.clientX);
          press.current = null;
          setPinned(id);
          if (id !== null && !isGap(id)) {
            choose(id);
          }
        }}
        onPointerCancel={() => {
          press.current = null;
          setPinned(null);
        }}
        onClick={(event) => {
          // A key press clicks the focused tick itself; a mouse click lands
          // on the track and chooses the nearest tick.
          if (
            event.target !== event.currentTarget ||
            pointer.current !== 'mouse'
          ) {
            return;
          }
          const id = pointAt(event.clientX);
          if (id !== null && !isGap(id)) {
            choose(id);
            ticks.current.get(id)?.focus({preventScroll: true});
          }
        }}
      >
        {geometry.segments.map((segment, index) => (
          <Segment
            key={index}
            style={{
              left: Math.round(segment.left),
              width: Math.round(segment.right) - Math.round(segment.left) + 1,
            }}
          />
        ))}
        {history.map((entry, index) => {
          const {version} = entry.file;
          const isSelected = version === selected;
          const lit = version === shown;
          return (
            <Tick
              key={version}
              ref={(node) => {
                if (node) {
                  ticks.current.set(version, node);
                } else {
                  ticks.current.delete(version);
                }
              }}
              type="button"
              tabIndex={version === active ? 0 : -1}
              aria-pressed={isSelected}
              aria-label={describe(entry, index)}
              data-firmware-version={version}
              data-selected={isSelected ? 'true' : undefined}
              data-connected={entry === ring ? 'true' : undefined}
              $raised={isSelected || lit || entry === ring}
              style={{left: Math.round(geometry.x[index])}}
              onFocus={(event) => {
                setActive(version);
                if (event.currentTarget.matches(':focus-visible')) {
                  setFocused(version);
                  setDismissed(null);
                }
              }}
              onBlur={() => setFocused(null)}
              onClick={() => choose(version)}
            >
              <Mark
                $selected={isSelected}
                $lit={lit}
                $height={markHeight}
                $opacity={
                  isSelected || lit
                    ? 1
                    : (entry.sample ? 0.5 : 1) * (dense ? 0.6 : 1)
                }
              />
              {entry === ring && <Ring />}
            </Tick>
          );
        })}
      </Track>
      {shown !== null && (
        <Tip
          ref={tipRef}
          aria-hidden="true"
          data-firmware-version-tip={shown}
          style={{
            left: tip?.left ?? 0,
            transform: `translateX(-${tip?.shift ?? 0}%)`,
            visibility: tip ? undefined : 'hidden',
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') {
              stay();
            }
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') {
              leave();
            }
          }}
        >
          {shownEntry ? (
            <>
              <TipHead>
                <TipVersion>{shownEntry.file.version}</TipVersion>
                {shownEntry.draft && <TipTag>{t('Draft')}</TipTag>}
                {shownEntry.sample && <TipTag>{SAMPLE_TEXT.tag}</TipTag>}
              </TipHead>
              {shownNote && <div>{shownNote}</div>}
              {shownEntry === ring && <TipMuted>{connectedLabel}</TipMuted>}
              {resets(shownEntry) && (
                <TipAlert>{t('Resets settings')}</TipAlert>
              )}
            </>
          ) : (
            <div>{t('Settings reset across this gap')}</div>
          )}
        </Tip>
      )}
    </Root>
  );
};
