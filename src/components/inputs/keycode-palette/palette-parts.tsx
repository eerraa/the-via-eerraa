import styled, {css} from 'styled-components';
import type {InputHTMLAttributes} from 'react';
import {AccentButton} from '../accent-button';
import {DIRTY_DOT_GAP} from '../dirty-dot';

// Chrome for the palette. Colours come from the app's CSS variables so light and
// dark mode both hold; only keycaps use the keyboard theme.

export const muted = 'var(--color_label)';
export const strong = 'var(--color_label-highlighted)';
export const accent = 'var(--color_accent)';
// The theme accent is tuned for fills. As text it is mixed toward the label colour so
// it stays readable on a light surface too; fills keep the pure accent.
export const accentText = 'var(--color_accent-mix)';
export const hairline = 'var(--border_color_cell)';
// A panel is tinted, not boxed: the editor and the builder sit on a faint wash of
// the accent instead of inside another border.
export const panelWash =
  'color-mix(in srgb, var(--color_accent) 7%, transparent)';
// What the palette sits on, for a part that keys scroll under. KEYMAP shows the
// window's gradient, fixed to the window as #root draws it; the keycode dock sets
// --palette-surface to its own colour.
export const surface = 'var(--palette-surface, var(--bg_gradient) fixed)';

/** Words for a screen reader only, such as a live region's announcement. */
export const Announcement = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
`;

export const TabRow = styled.div<{$height: number}>`
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 2px;
  min-height: ${(props) => props.$height}px;
`;

// Tabs read at the size of VIA's own menu text: 20px at weight 400, as its setting
// labels and its old submenu list are, so a row of tabs sits level with the
// controls and buttons around it.
export const TAB_FONT = `
  font-size: 20px;
  font-weight: 400;
`;

// Shared by the button tab and the link tab a page uses when a tab is a place.
export const tabStyles = css<{$selected: boolean}>`
  display: flex;
  align-items: center;
  gap: ${DIRTY_DOT_GAP}px;
  margin: 0;
  padding: 0 12px;
  border: 0;
  border-bottom: 2px solid
    ${(props) => (props.$selected ? accent : 'transparent')};
  background: transparent;
  color: ${(props) => (props.$selected ? strong : muted)};
  font: inherit;
  ${TAB_FONT}
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: ${strong};
  }
  &:focus-visible {
    outline: 2px solid ${accent};
    outline-offset: -2px;
  }
  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
`;

export const Tab = styled.button<{$selected: boolean}>`
  ${tabStyles}
`;

export const TabDivider = styled.span`
  align-self: center;
  width: 1px;
  height: 22px;
  margin: 0 8px;
  background: ${hairline};
`;

/** A quiet word-button: "+ Combined key", "← Tap Dance", "Edit TD0 →". */
export const TextAction = styled.button<{$tone?: 'accent' | 'plain'}>`
  display: flex;
  align-items: center;
  margin: 0;
  padding: 0 8px;
  min-height: 36px;
  border: 0;
  background: transparent;
  color: ${(props) => (props.$tone === 'plain' ? strong : accentText)};
  font: inherit;
  font-size: 16px;
  white-space: nowrap;
  cursor: pointer;

  &[aria-pressed='true'] {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  &:hover:not(:disabled) {
    color: ${(props) => (props.$tone === 'plain' ? accentText : strong)};
  }
  &:focus-visible {
    outline: 2px solid ${accent};
    outline-offset: 1px;
  }
  &:disabled {
    color: ${muted};
    cursor: default;
  }
`;

export const Panel = styled.section`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 18px 18px;
  border-radius: 12px;
  background: ${panelWash};
`;

/** The editor and the builder: one line above the keys, which scroll under it. */
export const LinePanel = styled(Panel)`
  gap: 6px;
  padding: 6px 14px;
`;

/** VIA's layer picker (`layer-control.tsx`): plain numbers, the chosen one filled. */
export const LayerChoice = styled.button<{$on: boolean}>`
  min-width: 30px;
  height: 34px;
  margin: 0;
  padding: 0 8px;
  border: 0;
  border-radius: 0;
  background: ${(props) => (props.$on ? accent : 'transparent')};
  color: ${(props) => (props.$on ? 'var(--color_inside-accent)' : strong)};
  font: inherit;
  font-size: 20px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;

  &:hover {
    background: ${(props) => (props.$on ? accent : 'var(--bg_menu)')};
  }
  &:focus-visible {
    outline: 2px solid ${accent};
    outline-offset: 2px;
  }
`;

/** VIA's accent button as a toggle: filled like the primary button while it is on. */
export const ToggleButton = styled(AccentButton)<{$on: boolean}>`
  && {
    background-color: ${(props) =>
      props.$on ? accent : 'var(--bg_outside-accent)'};
    border-color: ${(props) =>
      props.$on ? accent : 'var(--color_accent-text)'};
    color: ${(props) =>
      props.$on ? 'var(--color_inside-accent)' : 'var(--color_accent-text)'};
  }
`;

export const Spacer = styled.div`
  flex-grow: 1;
`;

export const SectionLabel = styled.div`
  font-size: 15px;
  color: ${muted};
`;

export const Hint = styled.span`
  font-size: 15px;
  color: ${muted};
`;

export const Code = styled.code`
  font-family: 'Fira Mono', monospace;
  font-size: 15px;
`;

const SearchLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  border-bottom: 1px solid ${hairline};
  color: ${muted};

  &:focus-within {
    border-bottom-color: ${accent};
  }

  input {
    width: 220px;
    margin: 0;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: ${strong};
    font: inherit;
    font-size: 17px;
  }
`;

/** The search box. It also takes a keycode as typed, which its placeholder says. */
export const SearchField = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <SearchLabel>
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
    <input type="search" {...props} />
  </SearchLabel>
);
