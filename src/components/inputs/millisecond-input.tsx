import {useEffect, useId, useRef, useState} from 'react';
import styled from 'styled-components';
import {
  commitMillisecondDraft,
  parseFailureMessage,
  parseMillisecondDraft,
  revertMillisecondDraft,
  type MillisecondAdapter,
  type MillisecondCommitState,
} from '../../utils/millisecond-field';

const Root = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const Field = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--color_accent);
  padding: 2px 0;
`;

const NumberBox = styled.input`
  width: 72px;
  background: none;
  border: none;
  color: var(--color_label-highlighted);
  font-size: 16px;
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
  font-size: 16px;
`;

const Hint = styled.span`
  color: var(--color_label);
  font-size: 12px;
`;

const ErrorText = styled.span`
  color: var(--color_error, #c44848);
  font-size: 12px;
`;

type Props = {
  adapter: MillisecondAdapter;
  id?: string;
  ariaLabel?: string;
};

export const MillisecondInput = ({adapter, id, ariaLabel}: Props) => {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const [state, setState] = useState<MillisecondCommitState>({
    authoritativeMs: adapter.minMs,
    draft: String(adapter.minMs),
    inFlight: false,
    error: null,
  });
  const cancelDraft = useRef(false);

  useEffect(() => {
    let cancelled = false;
    adapter.read().then((valueMs) => {
      if (!cancelled) {
        setState({
          authoritativeMs: valueMs,
          draft: String(valueMs),
          inFlight: false,
          error: null,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const parsed = parseMillisecondDraft(state.draft, adapter.minMs, adapter.maxMs);
  const commit = async () => {
    if (cancelDraft.current) {
      cancelDraft.current = false;
      setState((current) => revertMillisecondDraft(current));
      return;
    }
    const result = await commitMillisecondDraft(state.draft, state, adapter);
    setState(result.next);
  };

  const capabilityHint =
    adapter.capability === 'legacy'
      ? `Legacy step ${adapter.legacyStepMs ?? 20} ms`
      : adapter.capability === 'unsupported'
        ? 'Firmware update required for exact millisecond input'
        : 'Exact milliseconds';

  return (
    <Root>
      <Field>
        <NumberBox
          id={fieldId}
          inputMode="numeric"
          aria-label={ariaLabel ?? 'milliseconds'}
          aria-invalid={parsed.ok ? undefined : true}
          aria-describedby={`${hintId}${state.error ? ` ${errorId}` : ''}`}
          value={state.draft}
          disabled={state.inFlight || adapter.capability === 'unsupported'}
          onChange={(event) =>
            setState((current) => ({
              ...current,
              draft: event.target.value,
              error: null,
            }))
          }
          onBlur={() => {
            void commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              cancelDraft.current = true;
              event.currentTarget.blur();
            }
          }}
        />
        <Suffix>ms</Suffix>
      </Field>
      <Hint id={hintId}>{capabilityHint}</Hint>
      {state.error ? (
        <ErrorText id={errorId} role="alert">
          {state.error}
        </ErrorText>
      ) : !parsed.ok && state.draft !== String(state.authoritativeMs) ? (
        <ErrorText id={errorId} role="alert">
          {parseFailureMessage(parsed.reason)}
        </ErrorText>
      ) : null}
    </Root>
  );
};
