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

/** Whether a draft is a value the field takes and differs from the stored one. */
export function canApplyIntegerDraft(
  draft: string,
  authoritativeValue: number,
  bounds: {min: number; max: number},
): boolean {
  const parsed = parseIntegerDraft(draft, bounds.min, bounds.max);
  return parsed.ok && parsed.value !== authoritativeValue;
}
