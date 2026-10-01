import styled from 'styled-components';
import {focusOutline} from './accent-button';

export const HiddenInput = styled.input`
  opacity: 0;
  width: 0;
  height: 0;
`;

const Switch = styled.label`
  position: relative;
  display: inline-block;
  width: 60px;
  height: 34px;
`;
const Slider = styled.span<{$ischecked?: boolean; $disabled?: boolean}>`
  position: absolute;
  cursor: ${(props) => (props.$disabled ? 'not-allowed' : 'pointer')};
  opacity: ${(props) => (props.$disabled ? 0.5 : 1)};
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: ${(props) =>
    props.$ischecked ? 'var(--color_accent)' : 'var(--bg_control)'};
  -webkit-transition: 0.4s;
  transition: 0.4s;
  border-radius: 4px;
  &:before {
    position: absolute;
    content: '';
    height: 26px;
    width: 26px;
    left: 4px;
    bottom: 4px;
    border-radius: 4px;
    background-color: ${(props) =>
      !props.$ischecked ? 'var(--bg_icon)' : 'var(--color_inside-accent)'};
    -webkit-transition: 0.4s;
    transition: 0.4s;
    ${(props) => (props.$ischecked ? 'transform: translateX(26px)' : '')};
  }
  /* The checkbox that takes focus is not drawn, so the switch shows it. */
  ${HiddenInput}:focus-visible + & {
    ${focusOutline}
  }
`;

type Props = {
  isChecked: boolean;
  disabled?: boolean;
  onChange: (val: boolean) => void;
  /** The id of the row label that names the switch. */
  labelledBy?: string;
};

// The switch shows only what its owner holds. A write the keyboard never took
// must not leave it looking flipped, so it keeps no state of its own.
export function AccentSlider(props: Props) {
  const {isChecked, disabled, onChange, labelledBy} = props;
  return (
    <Switch>
      <HiddenInput
        type="checkbox"
        aria-labelledby={labelledBy}
        checked={isChecked}
        disabled={disabled}
        onChange={() => {
          if (!disabled) {
            onChange(!isChecked);
          }
        }}
      />
      <Slider $ischecked={isChecked} $disabled={disabled} />
    </Switch>
  );
}
