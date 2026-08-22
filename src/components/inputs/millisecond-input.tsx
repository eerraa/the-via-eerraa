import {useCallback, useEffect, useId, useRef, useState} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {
  canApplyMillisecondDraft,
  commitMillisecondDraft,
  parseFailureMessage,
  parseMillisecondDraft,
  revertMillisecondDraft,
  type MillisecondAdapter,
  type MillisecondCommitState,
} from '../../utils/millisecond-field';
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
  adapter: MillisecondAdapter;
  id?: string;
  ariaLabel?: string;
  savedMs: number;
};

export const MillisecondInput = ({adapter, id, ariaLabel, savedMs}: Props) => {
  const {t} = useTranslation();
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const [state, setState] = useState<MillisecondCommitState>({
    authoritativeMs: savedMs,
    draft: String(savedMs),
    inFlight: false,
    error: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    setState((current) => {
      if (
        canApplyMillisecondDraft(
          current.draft,
          current.authoritativeMs,
          adapter,
          current.inFlight,
        )
      ) {
        return current;
      }
      if (
        current.authoritativeMs === savedMs &&
        current.draft === String(savedMs)
      ) {
        return current;
      }
      return {
        authoritativeMs: savedMs,
        draft: String(savedMs),
        inFlight: false,
        error: null,
      };
    });
  }, [adapter, savedMs]);

  const parsed = parseMillisecondDraft(
    state.draft,
    adapter.minMs,
    adapter.maxMs,
  );
  const canApply = canApplyMillisecondDraft(
    state.draft,
    state.authoritativeMs,
    adapter,
    state.inFlight,
  );
  const validationMessage = state.error
    ? state.error
    : !parsed.ok && state.draft !== String(state.authoritativeMs)
      ? parseFailureMessage(parsed.reason)
      : null;

  const apply = useCallback(async () => {
    const result = await commitMillisecondDraft(
      stateRef.current.draft,
      stateRef.current,
      adapter,
    );
    setState(result.next);
  }, [adapter]);

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
          aria-label={ariaLabel ?? t('milliseconds')}
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
              setState((current) => revertMillisecondDraft(current));
            }
          }}
        />
        <Suffix>ms</Suffix>
      </Field>
    </Root>
  );
};
