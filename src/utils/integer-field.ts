export type IntegerAdapter = {
  min: number;
  max: number;
  write(candidate: number): Promise<number>;
};

export type IntegerParseFailure =
  | 'empty'
  | 'non_integer'
  | 'nan'
  | 'out_of_range';

export type IntegerParseResult =
  | {ok: true; value: number}
  | {ok: false; reason: IntegerParseFailure};

export function parseIntegerDraft(
  draft: string,
  min: number,
  max: number,
): IntegerParseResult {
  const trimmed = draft.trim();
  if (trimmed === '') {
    return {ok: false, reason: 'empty'};
  }
  if (/[.,]/.test(trimmed)) {
    return {ok: false, reason: 'non_integer'};
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return {ok: false, reason: 'nan'};
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    return {ok: false, reason: 'nan'};
  }
  if (value < min || value > max) {
    return {ok: false, reason: 'out_of_range'};
  }
  return {ok: true, value};
}

export function integerFailureMessage(reason: IntegerParseFailure): string {
  switch (reason) {
    case 'empty':
      return 'Enter an integer';
    case 'non_integer':
    case 'nan':
      return 'Value is not an integer.';
    case 'out_of_range':
      return 'Out of range';
  }
}

export type IntegerCommitState = {
  authoritativeValue: number;
  draft: string;
  inFlight: boolean;
  error: string | null;
};

export function canApplyIntegerDraft(
  draft: string,
  authoritativeValue: number,
  adapter: Pick<IntegerAdapter, 'min' | 'max'>,
  inFlight: boolean,
): boolean {
  if (inFlight) {
    return false;
  }
  const parsed = parseIntegerDraft(draft, adapter.min, adapter.max);
  return parsed.ok && parsed.value !== authoritativeValue;
}

export async function commitIntegerDraft(
  draft: string,
  state: IntegerCommitState,
  adapter: IntegerAdapter,
): Promise<{next: IntegerCommitState; wrote: boolean}> {
  if (state.inFlight) {
    return {next: state, wrote: false};
  }
  const parsed = parseIntegerDraft(draft, adapter.min, adapter.max);
  if (!parsed.ok) {
    return {
      next: {...state, error: integerFailureMessage(parsed.reason)},
      wrote: false,
    };
  }
  const authoritativeValue = await adapter.write(parsed.value);
  return {
    next: {
      authoritativeValue,
      draft: String(authoritativeValue),
      inFlight: false,
      error: null,
    },
    wrote: true,
  };
}

export function revertIntegerDraft(state: IntegerCommitState): IntegerCommitState {
  return {
    ...state,
    draft: String(state.authoritativeValue),
    error: null,
  };
}
