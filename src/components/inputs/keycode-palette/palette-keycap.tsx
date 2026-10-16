import {useMemo, type ReactNode} from 'react';
import styled, {css} from 'styled-components';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedTheme} from 'src/store/settingsSlice';
import {getDarkenedColor} from 'src/utils/color-math';
import {
  faceSize,
  LEGEND_FONT,
  legendBaseline,
  type KeycapLegend,
} from 'src/utils/keycap-legend';
import {accentText} from './palette-parts';

// Keycaps are drawn like the 2D keyboard above them: the theme's cap colour on a
// darker skirt, the same legend where the keyboard puts it. They read as keys, not
// as buttons.
// Every keycap in the palette, pickable or not, has the same 1u shape. Hover answers
// the way the 2D keyboard does: it presses inward and brightens without changing
// the theme's keycap or skirt colours.

const KEY_UNIT = 52;
export const KEY_GAP = 6;
const KEY_HEIGHT = KEY_UNIT + 2;

// A key under the pointer presses inward and brightens, as the 2D keyboard's keys
// do, without changing the theme's keycap or skirt colours. A chosen slot keeps the
// same look, so choosing reads as pointing does.
const keyPress = css`
  transform: perspective(100px) translateZ(-8px);
  animation: 0.5s 1 forwards select-glow;
`;

export const keyWidth = (units: number, unit = KEY_UNIT) =>
  Math.round(units * unit + (units - 1) * KEY_GAP);

type KeycapTone = 'alpha' | 'mod' | 'accent';

export type KeycapColors = {cap: string; legend: string; skirt: string};

export const useKeycapColors = (): Record<KeycapTone, KeycapColors> => {
  const theme = useAppSelector(getSelectedTheme);
  return useMemo(() => {
    const pick = (tone: KeycapTone) => ({
      cap: theme[tone].c,
      legend: theme[tone].t,
      skirt: getDarkenedColor(theme[tone].c, 0.8),
    });
    return {alpha: pick('alpha'), mod: pick('mod'), accent: pick('accent')};
  }, [theme]);
};

const skirtShape = css<{$width: number; $height: number; $skirt: string}>`
  position: relative;
  flex-shrink: 0;
  width: ${(props) => props.$width}px;
  height: ${(props) => props.$height}px;
  box-sizing: border-box;
  margin: 0;
  padding: 2px 6px 10px 6px;
  border: 0;
  border-radius: 5px;
  background: ${(props) => props.$skirt};
`;

const Skirt = styled.button<{
  $width: number;
  $height: number;
  $skirt: string;
}>`
  ${skirtShape}
  outline: none;
  font: inherit;
  cursor: pointer;
  transition:
    transform 0.2s ease-out,
    background-color 0.2s ease-out;

  &:hover:not(:disabled) {
    ${keyPress}
  }
  /* Keep the original hit area while the visible key presses inward. */
  &:hover:not(:disabled)::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    transform: scale(1.08);
  }
  /* The solid ring means "on the target now". It is drawn apart from the outline,
     which VIA's global *:focus rule clears, and takes the accent as the palette's
     accent text does: some keycap themes make the accent white, grey or black, and a
     ring of it vanished into the page. Keyboard focus is the dashed outline, 1px off
     the key, whose skirt many themes colour much like the dash. Keys sit as close as
     6px, and ring and outline each reach 3px into that gap, so they only meet. Only
     on the current key does the outline go outside the ring, so that a focused
     current key shows both. */
  &[aria-current='true']::before {
    content: '';
    position: absolute;
    inset: -3px;
    border: 2px solid ${accentText};
    border-radius: 8px;
    pointer-events: none;
  }
  &:focus-visible {
    outline: 2px dashed var(--color_label-highlighted);
    outline-offset: 1px;
  }
  &[aria-current='true']:focus-visible {
    outline-offset: 4px;
  }
  &:disabled {
    filter: brightness(0.55);
    cursor: not-allowed;
  }
`;

const ViewSkirt = styled.span<{
  $width: number;
  $height: number;
  $skirt: string;
  $dashed: boolean;
  $chosen: boolean;
}>`
  ${skirtShape}
  display: block;
  outline: ${(props) =>
    props.$dashed ? '1.5px dashed var(--color_accent)' : 'none'};
  outline-offset: 3px;
  transition: transform 0.2s ease-out;
  ${(props) => (props.$chosen ? keyPress : '')}
  /* A slot opens the window its key is picked in: under the pointer its keycap
     answers as a key does. */
  button:hover:not(:disabled) > & {
    ${keyPress}
  }
`;

const Cap = styled.span<{$cap: string; $legend: string}>`
  display: block;
  height: 100%;
  border-radius: 4px;
  background: ${(props) => props.$cap};
  box-shadow: var(--box-shadow-keycap);
  color: ${(props) => props.$legend};
  overflow: hidden;
`;

/** The cap's face is the 2D keyboard's 1u face: each line goes where it puts it. */
const CapFace = ({
  legend,
  ...colors
}: {legend: KeycapLegend; $cap: string; $legend: string}) => {
  const face = faceSize(1);
  return (
    <Cap {...colors}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${face.width} ${face.height}`}
        style={{display: 'block'}}
      >
        {legend.lines.map((line, index) => (
          <text
            key={index}
            x={line.x}
            y={legendBaseline(line, face.height)}
            fill="currentColor"
            fillOpacity={line.opacity}
            fontFamily={LEGEND_FONT}
            fontSize={line.size}
            fontWeight={700}
          >
            {line.text}
          </text>
        ))}
      </svg>
    </Cap>
  );
};

type KeycapProps = {
  legend: KeycapLegend;
  width: number;
  height?: number;
  colors: KeycapColors;
  /** What the target holds now: ringed, and aria-current, with no word on it. */
  current?: boolean;
  disabled?: boolean;
  /** Takes keyboard focus as it first shows: the key a way back points at. */
  autoFocus?: boolean;
  ariaLabel: string;
  title?: string;
  onPick: () => void;
  onHover?: () => void;
};

export const Keycap = ({
  legend,
  width,
  height = KEY_HEIGHT,
  colors,
  current = false,
  disabled,
  autoFocus,
  ariaLabel,
  title,
  onPick,
  onHover,
}: KeycapProps) => {
  return (
    <Skirt
      type="button"
      $width={width}
      $height={height}
      $skirt={colors.skirt}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-disabled={disabled || undefined}
      draggable={false}
      aria-label={ariaLabel}
      aria-current={current ? 'true' : undefined}
      title={title}
      onClick={() => {
        if (!disabled) onPick();
      }}
      onMouseEnter={() => {
        if (!disabled) onHover?.();
      }}
      onFocus={() => {
        if (!disabled) onHover?.();
      }}
      onDragStart={(event) => {
        if (disabled) event.preventDefault();
      }}
    >
      <CapFace legend={legend} $cap={colors.cap} $legend={colors.legend} />
    </Skirt>
  );
};

/** A 1u keycap that only shows a value: the target, a Tap Dance action, a result. */
export const KeycapView = ({
  legend,
  colors,
  dashed = false,
  chosen = false,
  children,
}: {
  legend: KeycapLegend;
  colors: KeycapColors;
  dashed?: boolean;
  /** The slot chosen: drawn as a key under the pointer is. */
  chosen?: boolean;
  children?: ReactNode;
}) => {
  return (
    <ViewSkirt
      aria-hidden="true"
      $width={keyWidth(1)}
      $height={KEY_HEIGHT}
      $skirt={colors.skirt}
      $dashed={dashed}
      $chosen={chosen}
    >
      <CapFace legend={legend} $cap={colors.cap} $legend={colors.legend} />
      {children}
    </ViewSkirt>
  );
};

/**
 * The 1u place of a key not chosen yet, an LT·MT tap key or a Tap Dance action:
 * wherever it shows, a ?. A chosen slot keeps the look of a key under the pointer.
 */
export const EmptyKeycap = styled.span<{$chosen?: boolean}>`
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: ${keyWidth(1)}px;
  height: ${KEY_HEIGHT}px;
  box-sizing: border-box;
  border: 1.5px dashed ${accentText};
  border-radius: 5px;
  color: ${accentText};
  font-size: 16px;
  font-weight: 700;
  transition: transform 0.2s ease-out;
  ${(props) => (props.$chosen ? keyPress : '')}
  button:hover:not(:disabled) > & {
    ${keyPress}
  }
`;
