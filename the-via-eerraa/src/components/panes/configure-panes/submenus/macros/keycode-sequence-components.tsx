import {faPlus} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import React, {ChangeEvent, PropsWithChildren, useRef} from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import {IKeycode} from 'src/utils/key';
import {
  OptimizedKeycodeSequenceItem,
  RawKeycodeSequenceAction,
} from 'src/utils/macro-api/types';
import {MAX_MACRO_DELAY_MS} from 'src/utils/macro-api/macro-api.common';
import styled from 'styled-components';
import {focusRing} from 'src/components/inputs/accent-button';

const CharacterStreamContainer = styled.div`
  border: 2px solid var(--bg_control);
  transition: border-color 0.2s ease-in-out;
  margin: 15px 0px;
  display: inline-block;
  &:focus-within {
    border-color: var(--color_accent);
  }
  border-radius: 4px;
  font-size: 16px;
`;

const KeycodeSequenceLabel = styled.div`
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  user-select: none;
  padding: 6px 6px;
  text-align: center;
  justify-content: center;
  align-items: center;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 16px;
  border: 2px solid var(--border_color_icon);
  background: var(--bg_control);
  color: var(--color_label-highlighted);
  margin: 0;
  box-shadow: none;
  position: relative;
  border-radius: 2px;
`;
const KeycodeStateContainer = styled(KeycodeSequenceLabel)<{
  $direction: 'down' | 'up';
}>`
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: stretch;
  padding: 0;
  border-top-color: ${(props) =>
    props.$direction === 'up'
      ? 'var(--color_accent)'
      : 'var(--border_color_icon)'};
  border-bottom-color: ${(props) =>
    props.$direction === 'down'
      ? 'var(--color_accent)'
      : 'var(--border_color_icon)'};
`;

const KeycodeStateLane = styled.span`
  display: flex;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  width: 20px;
  padding: 2px 0;
  background: color-mix(in srgb, var(--bg_menu) 45%, var(--bg_control));
  border-right: 1px solid
    color-mix(in srgb, var(--border_color_icon) 55%, transparent);
  color: var(--color_accent);
`;

const KeycodeStateGlyph = styled.svg`
  display: block;
  flex-shrink: 0;
  width: 10px;
  height: 12px;
`;

const KeycodeStateText = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 4px 5px;
  font-size: 16px;
  line-height: 1.2;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const KeycodeStateLabel: React.FC<
  PropsWithChildren<{direction: 'down' | 'up'}>
> = ({children, direction}) => (
  <KeycodeStateContainer $direction={direction}>
    <KeycodeStateLane aria-hidden="true">
      <KeycodeStateGlyph viewBox="0 0 10 12" focusable="false">
        <path
          d={
            direction === 'down'
              ? 'M1 2h8L5 7.5 1 2zm0 7.5h8v1.8H1V9.5z'
              : 'M1 .7h8v1.8H1V.7zm4 3.8L9 10H1l4-5.5z'
          }
          fill="currentColor"
        />
      </KeycodeStateGlyph>
    </KeycodeStateLane>
    <KeycodeStateText>{children}</KeycodeStateText>
  </KeycodeStateContainer>
);

const KeycodeDownLabel: React.FC<PropsWithChildren<{}>> = ({children}) => (
  <KeycodeStateLabel direction="down">{children}</KeycodeStateLabel>
);

const CharacterStreamLabel = styled(KeycodeSequenceLabel)`
  max-width: 100%;
  border-color: var(--border_color_cell);
  background: var(--bg_menu);
  min-height: 36px;
  letter-spacing: 2px;
`;

const KeycodePressLabel = styled(KeycodeSequenceLabel)`
  max-width: 100%;
  border-color: var(--color_accent);
`;

const KeycodeUpLabel: React.FC<PropsWithChildren<{}>> = ({children}) => (
  <KeycodeStateLabel direction="up">{children}</KeycodeStateLabel>
);

export const KeycodeSequenceWait = styled.div`
  display: flex;
  font-weight: bold;
  user-select: none;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  text-align: center;
  justify-content: center;
  align-items: center;
  font-size: 16px;
  color: var(--color_label-highlighted);
  background: var(--bg_menu);
  box-shadow: none;
  white-space: nowrap;
  position: relative;
  margin: 0;
  box-sizing: border-box;
  border: 2px solid;
  padding: 4px 4px;
  border-color: var(--color_accent);
  border-radius: 2px;
`;
export const NumberInput = styled.input.attrs({
  type: 'number',
  placeholder: 'XXXX',
})`
  appearance: none;
  background: none;
  border: none;
  border-bottom: 1px solid;
  color: var(--color_label);
  width: 45px;
  text-align: center;
  font-family: inherit;
  font-size: inherit;
  color: var(--color_label-highlighted);
  margin: 0 5px 0 0;
  &:focus {
    color: var(--color_accent);
  }
  ${focusRing}
  &::-webkit-inner-spin-button {
    appearance: none;
    display: none;
  }
  &:invalid {
    color: red;
  }
  &:placeholder-shown {
    color: red;
  }
`;

export const WaitInput: React.FC<{
  value: number | string;
  index: number;
  updateValue: (id: number, wait: number) => void;
  disabled?: boolean;
}> = (props) => {
  const inputRef = useRef(null);
  const onBeforeInput = (evt: InputEvent) => {
    if (!evt.data || !/^\d+$/.test(evt.data)) {
      evt.preventDefault();
    }
  };
  const onChange = (evt: ChangeEvent<HTMLInputElement>) => {
    if (Number.isInteger(+evt.target.value) && +evt.target.value > 0 && +evt.target.value <= MAX_MACRO_DELAY_MS) {
      // Update external value
      props.updateValue(props.index, +evt.target.value);
    }
  };

  return (
    <KeycodeSequenceWait>
      <NumberInput
        ref={inputRef}
        onBeforeInput={onBeforeInput as any}
        value={props.value}
        onChange={onChange}
        disabled={props.disabled}
      />
      ms
    </KeycodeSequenceWait>
  );
};

export const getSequenceItemComponent = (
  action: OptimizedKeycodeSequenceItem[0],
) =>
  action === RawKeycodeSequenceAction.Down
    ? KeycodeDownLabel
    : action === RawKeycodeSequenceAction.Up
    ? KeycodeUpLabel
    : action === RawKeycodeSequenceAction.CharacterStream
    ? CharacterStreamLabel
    : KeycodePressLabel;

function capitalize(string: string) {
  return string[0].toUpperCase() + string.slice(1);
}

export const getSequenceLabel = (keycode: IKeycode) => {
  const label = keycode?.keys ?? keycode?.shortName ?? keycode?.name ?? '';
  return label.length > 1 ? capitalize(label) : label;
};
