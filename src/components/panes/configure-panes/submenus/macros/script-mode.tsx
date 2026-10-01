import React, {useCallback, useLayoutEffect, useMemo, useRef} from 'react';
import {ControlRow} from '../../../grid';
import ReactTextareaAutocomplete, {
  type TriggerType,
} from '@webscopeio/react-textarea-autocomplete';
import {
  AutocompleteItem,
  AutocompleteLoading,
  findKeycodes,
} from '../../../../../components/inputs/autocomplete-keycode';
import styled from 'styled-components';
import {isTypeableMacroCharacter} from 'src/utils/macro-api/macro-api.common';
import {errorColor} from './save-message';

const TextArea = styled.textarea`
  display: block;
  position: relative;
  box-sizing: border-box;
  background: transparent;
  padding: 5px 10px;
  border: 1px solid var(--border_color_icon);
  scrollbar-gutter: stable;
  color: var(--color_label);
  width: 100%;
  height: 200px;
  font-size: 16px;
  line-height: 18px;
  resize: none;
  font-family: 'Source Code Pro';
  font-weight: 500;
  &::placeholder {
    color: var(--color_label);
  }
  &:focus {
    color: var(--color_accent);
    outline-color: var(--color_accent);
  }
`;

const TextAreaFrame = styled.div`
  position: relative;
  background: var(--bg_control);
`;

// Laid out like the textarea over it, with its text invisible, so a mark sits under
// the character it flags.
const Backdrop = styled.div`
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  padding: 5px 10px;
  border: 1px solid transparent;
  overflow: hidden;
  scrollbar-gutter: stable;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  font-family: monospace;
  font-size: 16px;
  line-height: 18px;
  font-weight: 500;
  color: transparent;
  pointer-events: none;

  mark {
    color: transparent;
    background: color-mix(in srgb, ${errorColor} 55%, transparent);
  }
`;

const markUntypeable = (text: string) => {
  const parts: React.ReactNode[] = [];
  let plain = '';
  for (const character of text) {
    if (isTypeableMacroCharacter(character)) {
      plain += character;
    } else {
      parts.push(plain, <mark key={parts.length}>{character}</mark>);
      plain = '';
    }
  }
  if (!parts.length) {
    return null;
  }
  // A final line break still opens a line in the textarea.
  parts.push(plain.endsWith('\n') ? `${plain} ` : plain);
  return parts;
};

type MarkedTextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  innerRef?: (element: HTMLTextAreaElement | null) => void;
};

/** The script box, with each character the keyboard cannot type marked in place. */
const MarkedTextArea: React.FC<MarkedTextAreaProps> = ({
  innerRef,
  onScroll,
  value,
  ...props
}) => {
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const marks = useMemo(() => markUntypeable(String(value ?? '')), [value]);
  const syncScroll = () => {
    if (backdrop.current && textarea.current) {
      backdrop.current.scrollTop = textarea.current.scrollTop;
    }
  };
  useLayoutEffect(syncScroll);
  const setTextarea = useCallback(
    (element: HTMLTextAreaElement | null) => {
      textarea.current = element;
      innerRef?.(element);
    },
    [innerRef],
  );
  return (
    <TextAreaFrame>
      {marks ? (
        <Backdrop ref={backdrop} aria-hidden>
          {marks}
        </Backdrop>
      ) : null}
      <TextArea
        {...props}
        value={value}
        ref={setTextarea}
        onScroll={(event) => {
          onScroll?.(event);
          syncScroll();
        }}
      />
    </TextAreaFrame>
  );
};

const AutoHeightRow = styled(ControlRow)`
  height: auto;
`;

const Example = styled.div`
  display: flex;
  flex-wrap: wrap;
  column-gap: 16px;
  margin-right: auto;
  font-family: monospace;
  font-size: 16px;
  line-height: 20px;
  color: var(--color_label);
`;

const EXAMPLES = [
  'abc',
  '{KC_ENT}',
  '{KC_LCTL,KC_C}',
  '{+KC_LSFT}',
  '{-KC_LSFT}',
];

/** One of each thing a script can hold, for the line under the box. */
export const ScriptExample: React.FC<{isDelaySupported: boolean}> = ({
  isDelaySupported,
}) => (
  <Example>
    {(isDelaySupported ? [...EXAMPLES, '{100}'] : EXAMPLES).map((example) => (
      <span key={example}>{example}</span>
    ))}
  </Example>
);

// A keycode block runs from an unescaped "{" to the next "}" on its line, the way a
// save reads it. Only there does "{" or "," start a keycode; anywhere else it is
// text, and the Enter or Tab after it has to stay a line break or a tab.
const isInKeycodeBlock = (textBeforeCaret: string) => {
  for (let index = textBeforeCaret.length - 1; index >= 0; index--) {
    const character = textBeforeCaret[index];
    if (character === '}' || character === '\n') {
      return false;
    }
    if (character === '{' && textBeforeCaret[index - 1] !== '\\') {
      return true;
    }
  }
  return false;
};

export const ScriptMode: React.FC<{
  value: string;
  onChange: (value: string) => void;
  isModified: boolean;
  refused: boolean;
}> = ({value, onChange, isModified, refused}) => {
  // Read by the keycode list, which is asked for its items after the box has changed.
  const textBeforeCaret = useRef('');
  const trigger = useMemo((): TriggerType<string | object> => {
    const keycodesInBlock = (token: string) =>
      isInKeycodeBlock(textBeforeCaret.current) ? findKeycodes(token) : [];
    return {
      '{': {
        dataProvider: keycodesInBlock,
        component: AutocompleteItem,
        output: (item: any) => ({
          text: `{${item.code},`,
          caretPosition: 'end',
        }),
      },
      ',': {
        dataProvider: keycodesInBlock,
        component: AutocompleteItem,
        output: (item: any) => ({
          text: `,${item.code},`,
          caretPosition: 'end',
        }),
      },
    };
  }, []);
  return (
    <AutoHeightRow>
      <ReactTextareaAutocomplete
        value={value}
        onChange={(event) => {
          const {value: text, selectionEnd} = event.target;
          textBeforeCaret.current = text.slice(0, selectionEnd);
          onChange(text);
        }}
        loadingComponent={AutocompleteLoading}
        style={{
          fontSize: '16px',
          lineHeight: '18px',
          width: '100%',
          height: '140px',
          fontFamily: 'monospace',
          resize: 'none',
          borderColor: refused ? errorColor : 'var(--border_color_icon)',
          borderStyle: isModified ? 'dashed' : 'solid',
        }}
        containerStyle={{
          border: 'none',
          lineHeight: '20px',
        }}
        itemStyle={{
          borderColor: 'var(--border_color_cell)',
          backgroundColor: 'var(--bg_menu)',
        }}
        dropdownStyle={{
          zIndex: 999,
          backgroundColor: 'var(--bg_menu)',
        }}
        listStyle={{
          position: 'fixed',
          backgroundColor: 'var(--bg_menu)',
          maxHeight: '210px',
          overflow: 'auto',
          border: '1px solid var(--border_color_cell)',
        }}
        minChar={0}
        textAreaComponent={
          {component: MarkedTextArea, ref: 'innerRef'} as any
        }
        movePopupAsYouType={true}
        trigger={trigger}
      />
    </AutoHeightRow>
  );
};
