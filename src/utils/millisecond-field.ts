export type MillisecondCapability = 'exact' | 'legacy' | 'unsupported';

export type MillisecondAdapter = {
  capability: MillisecondCapability;
  minMs: number;
  maxMs: number;
  /** Legacy dropdown step in milliseconds. Ignored for exact/unsupported. */
  legacyStepMs?: number;
  read(): Promise<number>;
  write(candidateMs: number): Promise<number>;
};

export type MillisecondParseFailure =
  | 'empty'
  | 'decimal'
  | 'nan'
  | 'out_of_range';

export type MillisecondParseResult =
  | {ok: true; valueMs: number}
  | {ok: false; reason: MillisecondParseFailure};

export const DEFAULT_TAPPING_TERM_BOUNDS = {
  minMs: 100,
  maxMs: 500,
} as const;

export const ERA_LEGACY_TAPPING_STEP_MS = 20;

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

export function parseFailureMessage(reason: MillisecondParseFailure): string {
  switch (reason) {
    case 'empty':
      return 'Enter an integer millisecond value.';
    case 'decimal':
      return 'Fractional milliseconds are not accepted.';
    case 'nan':
      return 'Value is not an integer.';
    case 'out_of_range':
      return 'Value is outside the allowed millisecond range.';
  }
}

/** Floor to the legacy dropdown grid without mutating an exact store. */
export function projectLegacyMs(
  valueMs: number,
  minMs: number,
  maxMs: number,
  stepMs: number,
): number {
  const clamped = Math.min(Math.max(valueMs, minMs), maxMs);
  return minMs + Math.floor((clamped - minMs) / stepMs) * stepMs;
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
  if (adapter.capability === 'unsupported') {
    return {
      next: {
        ...state,
        draft: String(state.authoritativeMs),
        error: 'This firmware does not support millisecond term edits.',
      },
      wrote: false,
    };
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

export async function refreshMillisecondValue(
  state: MillisecondCommitState,
  adapter: MillisecondAdapter,
): Promise<MillisecondCommitState> {
  const authoritativeMs = await adapter.read();
  return {
    ...state,
    authoritativeMs,
    draft: state.inFlight ? state.draft : String(authoritativeMs),
    error: null,
  };
}
