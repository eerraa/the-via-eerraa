import {useMemo, type ReactNode} from 'react';
import styled, {css} from 'styled-components';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedTheme} from 'src/store/settingsSlice';
import {getDarkenedColor} from 'src/utils/color-math';
import {fitKeycapLegend} from 'src/utils/keycode-palette';
import {accentText} from './palette-parts';

// Keycaps are drawn like the 2D keyboard above them: the theme's cap colour on a
// darker skirt, legend in the top-left corner. They read as keys, not as buttons.
// Every keycap in the palette, pickable or not, has the same 1u shape. Hover answers
// the way the 2D keyboard does: it presses inward and brightens without changing
// the theme's keycap or skirt colours.

export const KEY_UNIT = 52;
export const KEY_GAP = 6;
const KEY_HEIGHT = KEY_UNIT + 2;

export const keyWidth = (units: number, unit = KEY_UNIT) =>
  Math.round(units * unit + (units - 1) * KEY_GAP);

export type KeycapTone = 'alpha' | 'mod' | 'accent';

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
    transform: perspective(100px) translateZ(-8px);
    animation: 0.5s 1 forwards select-glow;
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
  $glow: boolean;
}>`
  ${skirtShape}
  display: block;
  outline: ${(props) =>
    props.$dashed ? '1.5px dashed var(--color_accent)' : 'none'};
  outline-offset: 3px;
  box-shadow: ${(props) =>
    props.$glow
      ? '0 0 10px 2px color-mix(in srgb, var(--color_accent) 55%, transparent)'
      : 'none'};
`;

const Cap = styled.span<{
  $cap: string;
  $legend: string;
  $size: number;
  $condensed?: boolean;
}>`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  box-sizing: border-box;
  padding: 3px 3px;
  border-radius: 4px;
  background: ${(props) => props.$cap};
  box-shadow: var(--box-shadow-keycap);
  color: ${(props) => props.$legend};
  ${(props) =>
    props.$condensed
      ? "font-family: 'Fira Sans Condensed', 'Fira Sans', Helvetica, Arial, sans-serif;"
      : ''}
  font-size: ${(props) => props.$size}px;
  font-weight: 700;
  line-height: 1.05;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;

  > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

type KeycapProps = {
  top: string;
  bottom: string;
  width: number;
  height?: number;
  colors: KeycapColors;
  /** Legend size in px; by default the largest size at which the legend fits. */
  fontSize?: number;
  /** With `fontSize`: the legend was fitted in the condensed face. */
  condensed?: boolean;
  /** What the target holds now: ringed, and aria-current, with no word on it. */
  current?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  onPick: () => void;
  onHover?: () => void;
};

export const Keycap = ({
  top,
  bottom,
  width,
  height = KEY_HEIGHT,
  colors,
  fontSize,
  condensed,
  current = false,
  disabled,
  ariaLabel,
  title,
  onPick,
  onHover,
}: KeycapProps) => {
  const fitted =
    fontSize === undefined
      ? fitKeycapLegend(top, bottom)
      : {size: fontSize, condensed: !!condensed};
  return (
    <Skirt
      type="button"
      $width={width}
      $height={height}
      $skirt={colors.skirt}
      disabled={disabled}
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
      <Cap
        $cap={colors.cap}
        $legend={colors.legend}
        $size={fitted.size}
        $condensed={fitted.condensed}
      >
        <span>{top}</span>
        <span>{bottom}</span>
      </Cap>
    </Skirt>
  );
};

/** A 1u keycap that only shows a value: the target, a Tap Dance action, a result. */
export const KeycapView = ({
  top,
  bottom,
  colors,
  dashed = false,
  glow = false,
  children,
}: {
  top: string;
  bottom: string;
  colors: KeycapColors;
  dashed?: boolean;
  glow?: boolean;
  children?: ReactNode;
}) => {
  const fitted = fitKeycapLegend(top, bottom);
  return (
    <ViewSkirt
      aria-hidden="true"
      $width={keyWidth(1)}
      $height={KEY_HEIGHT}
      $skirt={glow ? 'var(--color_accent)' : colors.skirt}
      $dashed={dashed}
      $glow={glow}
    >
      <Cap
        $cap={colors.cap}
        $legend={colors.legend}
        $size={fitted.size}
        $condensed={fitted.condensed}
      >
        <span>{top}</span>
        <span>{bottom}</span>
      </Cap>
      {children}
    </ViewSkirt>
  );
};

/** The 1u place a key goes before one is chosen. */
export const EmptyKeycap = styled.span`
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
  font-size: 22px;
  font-weight: 700;
`;
