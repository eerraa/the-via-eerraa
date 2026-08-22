export type MillisecondAdapter = {
  minMs: number;
  maxMs: number;
  write(candidateMs: number): Promise<number>;
};

type MillisecondParseFailure = 'empty' | 'decimal' | 'nan' | 'out_of_range';

type MillisecondParseResult =
  {ok: true; valueMs: number} | {ok: false; reason: MillisecondParseFailure};

/** Official VIA + stock JSON range. Legacy GET/SET stay on this 20 ms grid. */
export const DEFAULT_TAPPING_TERM_BOUNDS = {
  minMs: 100,
  maxMs: 500,
} as const;

/**
 * Custom VIA JSON QMK exact-ms field. Existing 2-byte big-endian uint16 wire.
 * Stock JSON `options` stay [100, 500] for official VIA.
 */
export const QMK_EXACT_TAPPING_TERM_BOUNDS = {
  minMs: 1,
  maxMs: 65535,
} as const;

export function parseMillisecondDraft(
  draft: string,
  minMs: number,
  maxMs: number,
): MillisecondParseResult {
  const trimmed = draft.trim();
  if (trimmed === '') {
    return {ok: false, reason: 'empty'};
  }
  if (/[.,]/.test(trimmed)) {
    return {ok: false, reason: 'decimal'};
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return {ok: false, reason: 'nan'};
  }
  const valueMs = Number(trimmed);
  if (!Number.isInteger(valueMs) || !Number.isFinite(valueMs)) {
    return {ok: false, reason: 'nan'};
  }
  if (valueMs < minMs || valueMs > maxMs) {
    return {ok: false, reason: 'out_of_range'};
  }
  return {ok: true, valueMs};
}

export function canApplyMillisecondDraft(
  draft: string,
  authoritativeMs: number,
  adapter: Pick<MillisecondAdapter, 'minMs' | 'maxMs'>,
  inFlight: boolean,
): boolean {
  if (inFlight) {
    return false;
  }
  const parsed = parseMillisecondDraft(draft, adapter.minMs, adapter.maxMs);
  return parsed.ok && parsed.valueMs !== authoritativeMs;
}

export function parseFailureMessage(reason: MillisecondParseFailure): string {
  switch (reason) {
    case 'empty':
      return 'Enter an integer';
    case 'decimal':
      return 'Fractional milliseconds are not accepted.';
    case 'nan':
      return 'Value is not an integer.';
    case 'out_of_range':
      return 'Out of range';
  }
}

export type MillisecondCommitState = {
  authoritativeMs: number;
  draft: string;
  inFlight: boolean;
  error: string | null;
};

export async function commitMillisecondDraft(
  draft: string,
  state: MillisecondCommitState,
  adapter: MillisecondAdapter,
): Promise<{
  next: MillisecondCommitState;
  wrote: boolean;
}> {
  if (state.inFlight) {
    return {next: state, wrote: false};
  }

  const parsed = parseMillisecondDraft(draft, adapter.minMs, adapter.maxMs);
  if (!parsed.ok) {
    return {
      next: {
        ...state,
        error: parseFailureMessage(parsed.reason),
      },
      wrote: false,
    };
  }

  const nextState: MillisecondCommitState = {
    ...state,
    inFlight: true,
    error: null,
  };

  const authoritativeMs = await adapter.write(parsed.valueMs);
  return {
    next: {
      authoritativeMs,
      draft: String(authoritativeMs),
      inFlight: false,
      error: null,
    },
    wrote: true,
  };
}

export function revertMillisecondDraft(
  state: MillisecondCommitState,
): MillisecondCommitState {
  return {
    ...state,
    draft: String(state.authoritativeMs),
    error: null,
  };
}
