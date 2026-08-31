import {useCallback, useEffect, useId, useRef, useState} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {
  canApplyIntegerDraft,
  commitIntegerDraft,
  integerFailureMessage,
  parseIntegerDraft,
  revertIntegerDraft,
  type IntegerAdapter,
  type IntegerCommitState,
  type IntegerParseFailure,
} from '../../utils/integer-field';
import {useDeferredApplyRegistration} from '../panes/configure-panes/custom/deferred-apply';

const Root = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const Field = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--color_accent);
  padding: 2px 0;
`;

const NumberBox = styled.input`
  width: 88px;
  background: none;
  border: none;
  color: var(--color_label-highlighted);
  font-size: inherit;
  text-align: right;
  &:focus {
    outline: none;
  }
  &:disabled {
    opacity: 0.6;
  }
`;

const Suffix = styled.span`
  color: var(--color_label-highlighted);
`;

const ErrorText = styled.span`
  color: var(--color_error, #c44848);
  font-size: 16px;
  white-space: nowrap;
`;

type Props = {
  adapter: IntegerAdapter;
  id?: string;
  ariaLabel: string;
  failureMessage?: (reason: IntegerParseFailure) => string;
  savedValue: number;
  suffix: string;
};

export const IntegerInput = ({
  adapter,
  id,
  ariaLabel,
  failureMessage = integerFailureMessage,
  savedValue,
  suffix,
}: Props) => {
  const {t} = useTranslation();
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const [state, setState] = useState<IntegerCommitState>({
    authoritativeValue: savedValue,
    draft: String(savedValue),
    inFlight: false,
    error: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    setState((current) => {
      if (
        canApplyIntegerDraft(
          current.draft,
          current.authoritativeValue,
          adapter,
          current.inFlight,
        )
      ) {
        return current;
      }
      if (
        current.authoritativeValue === savedValue &&
        current.draft === String(savedValue)
      ) {
        return current;
      }
      return {
        authoritativeValue: savedValue,
        draft: String(savedValue),
        inFlight: false,
        error: null,
      };
    });
  }, [adapter, savedValue]);

  const parsed = parseIntegerDraft(state.draft, adapter.min, adapter.max);
  const canApply = canApplyIntegerDraft(
    state.draft,
    state.authoritativeValue,
    adapter,
    state.inFlight,
  );
  const validationMessage = state.error
    ? state.error
    : !parsed.ok && state.draft !== String(state.authoritativeValue)
      ? failureMessage(parsed.reason)
      : null;

  const apply = useCallback(async () => {
    const current = stateRef.current;
    const parsedDraft = parseIntegerDraft(
      current.draft,
      adapter.min,
      adapter.max,
    );
    if (!parsedDraft.ok) {
      setState({...current, error: failureMessage(parsedDraft.reason)});
      return;
    }
    const result = await commitIntegerDraft(
      current.draft,
      current,
      adapter,
    );
    setState(result.next);
  }, [adapter, failureMessage]);

  useDeferredApplyRegistration(fieldId, canApply, apply);

  return (
    <Root>
      {validationMessage ? (
        <ErrorText id={errorId} role="alert">
          {t(validationMessage)}
        </ErrorText>
      ) : null}
      <Field>
        <NumberBox
          id={fieldId}
          inputMode="numeric"
          aria-label={ariaLabel}
          aria-invalid={parsed.ok ? undefined : true}
          aria-describedby={validationMessage ? errorId : undefined}
          value={state.draft}
          disabled={state.inFlight}
          onChange={(event) =>
            setState((current) => ({
              ...current,
              draft: event.target.value,
              error: null,
            }))
          }
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setState((current) => revertIntegerDraft(current));
            }
          }}
        />
        <Suffix>{suffix}</Suffix>
      </Field>
    </Root>
  );
};
