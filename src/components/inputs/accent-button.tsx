import styled from 'styled-components';

type AccentButtonProps = {
  disabled?: boolean;
  onClick?: (...a: any[]) => void;
};

/**
 * Keyboard focus on an accent control: the accent outline the palette's own
 * controls draw. Only `:focus-visible`, so a click shows nothing new. Plain
 * objects, so object-styled components can spread them as well.
 */
export const focusOutline = {
  outline: '2px solid var(--color_accent)',
  outlineOffset: '2px',
};
export const focusRing = {'&:focus-visible': focusOutline};

/**
 * A button about to turn itself off or go away would drop keyboard focus to the
 * page; this hands it to a control that stays. Nothing moves unless the button
 * has focus, so a pointer that never focused it changes nothing.
 */
export const handFocus = (from: Element | null, to: HTMLElement | null) => {
  if (
    from &&
    to &&
    typeof document !== 'undefined' &&
    document.activeElement === from
  ) {
    to.focus();
  }
};

const AccentButtonBase = styled.button<AccentButtonProps>`
  height: 40px;
  padding: 0 15px;
  line-height: 40px;
  min-width: 100px;
  text-align: center;
  outline: none;
  font-size: 20px;
  border-radius: 5px;
  color: var(--color_accent);
  border: 1px solid var(--color_accent);
  display: inline-block;
  box-sizing: border-box;
  cursor: ${(props) => (props.disabled ? 'not-allowed' : 'pointer')};
  ${focusRing}
`;
export const AccentButton = styled(AccentButtonBase)`
  background-color: ${(props) =>
    props.disabled ? 'var(--bg_control-disabled)' : 'var(--bg_outside-accent)'};
  color: ${(props) =>
    props.disabled ? 'var(--bg_control)' : 'var(--color_accent-text)'};
  border-color: ${(props) =>
    props.disabled ? 'var(--bg_control)' : 'var(--color_accent-text)'};

  &:hover:not(:disabled) {
    filter: brightness(0.7);
  }
`;
export const AccentButtonLarge = styled(AccentButton)`
  font-size: 24px;
  line-height: 60px;
  height: 60px;
`;
/** The size the firmware pane uses for its row actions. */
export const AccentButtonSmall = styled(AccentButton)`
  height: 30px;
  line-height: 28px;
  min-width: 70px;
  font-size: 16px;
`;

export const PrimaryAccentButton = styled(AccentButtonBase)`
  color: ${(props) =>
    props.disabled ? 'var(--bg_control)' : 'var(--color_inside-accent)'};
  border-color: ${(props) =>
    props.disabled ? 'var(--bg_control)' : 'var(--color_accent)'};
  background-color: ${(props) =>
    props.disabled ? 'transparent' : 'var(--color_accent)'};
  &:hover:not(:disabled) {
    filter: brightness(0.7);
  }
`;
