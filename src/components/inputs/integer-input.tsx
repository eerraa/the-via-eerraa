import {useId, useState} from 'react';
import styled, {css} from 'styled-components';
import {parseIntegerDraft} from '../../utils/integer-field';

const Root = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

export const Field = styled.span<{$invalid?: boolean}>`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid
    ${(props) =>
      props.$invalid ? 'var(--color_error)' : 'var(--color_accent-text)'};
  padding: 2px 0;
`;

export const NumberBox = styled.input`
  width: 88px;
  background: none;
  border: none;
  color: var(--color_label-highlighted);
  font-size: inherit;
  text-align: right;
  &:focus {
    outline: none;
  }
`;

export const Suffix = styled.span`
  color: var(--color_label-highlighted);
`;

// Whatever is wrong with a draft, the field only says the range it takes; the unit
// is the one beside the number.
const Range = styled.span<{$below: boolean}>`
  color: var(--color_label);
  font-size: 16px;
  white-space: nowrap;
  ${(props) =>
    props.$below &&
    css`
      position: absolute;
      top: 100%;
      right: 0;
      line-height: 20px;
    `}
`;

type Props = {
  /** The text in the field: the saved value until it is edited. */
  draft: string;
  savedValue: number;
  min: number;
  max: number;
  onDraftChange: (draft: string) => void;
  /** What Enter does: the page's Apply, while it has something to write. */
  onEnter?: () => void;
  id?: string;
  ariaLabel: string;
  suffix: string;
  /** Puts the range under the field, for a field in a line with no room beside it. */
  rangeBelow?: boolean;
};

// Edits a whole number whose text is kept by its owner, which also writes it:
// the field itself never sends anything to the keyboard.
export const IntegerInput = ({
  draft,
  savedValue,
  min,
  max,
  onDraftChange,
  onEnter,
  id,
  ariaLabel,
  suffix,
  rangeBelow = false,
}: Props) => {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const rangeId = `${fieldId}-range`;
  // A value the keyboard reports is its own, even outside the range. A field cleared
  // to type another number is not wrong yet either: an empty draft is marked once
  // the field is left or Enter is pressed, not on the way.
  const [typing, setTyping] = useState(false);
  const parsed = parseIntegerDraft(draft, min, max);
  const invalid =
    !parsed.ok &&
    draft !== String(savedValue) &&
    !(typing && parsed.reason === 'empty');
  const range = invalid ? (
    <Range id={rangeId} role="alert" $below={rangeBelow}>
      {`${min}–${max}`}
    </Range>
  ) : null;

  return (
    <Root>
      {rangeBelow ? null : range}
      <Field $invalid={invalid}>
        <NumberBox
          id={fieldId}
          inputMode="numeric"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? rangeId : undefined}
          value={draft}
          onChange={(event) => {
            setTyping(true);
            onDraftChange(event.target.value);
          }}
          onBlur={() => setTyping(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onDraftChange(String(savedValue));
            } else if (
              event.key === 'Enter' &&
              !event.nativeEvent?.isComposing
            ) {
              setTyping(false);
              onEnter?.();
            }
          }}
        />
        <Suffix>{suffix}</Suffix>
      </Field>
      {rangeBelow ? range : null}
    </Root>
  );
};
