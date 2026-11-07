import type {OptimizedKeycodeSequence} from './types';

/** Transaction-local identifiers, never identities stored in a macro. */
export type MacroOrigin = number;
export type MacroOrigins = readonly MacroOrigin[];

export type MacroSequenceTrace = {
  sequence: OptimizedKeycodeSequence;
  origins: MacroOrigins[];
};

/** Ordered, non-overlapping, half-open UTF-16 spans in the expression. */
export type MacroOriginRange = {
  start: number;
  end: number;
  origins: MacroOrigins;
};

export type MacroExpressionTrace = {
  expression: string;
  ranges: MacroOriginRange[];
};

export type MacroTransformTrace = MacroSequenceTrace & MacroExpressionTrace;

export type MacroExpressionToken = {
  value: string;
  start: number;
  end: number;
};

/** Supply one origin list per input event, or use its input index. */
export function traceMacroSequence(
  sequence: OptimizedKeycodeSequence,
  origins: MacroOrigins[] = sequence.map((_, index) => [index]),
): MacroSequenceTrace {
  return {sequence, origins};
}

export function unionMacroOrigins(groups: readonly MacroOrigins[]): MacroOrigin[] {
  const result = new Set<MacroOrigin>();
  for (const group of groups) {
    for (const origin of group) result.add(origin);
  }
  return [...result];
}

/** Both ranges and successive queries must be ordered and non-overlapping. */
export function createMacroOriginReader(ranges: readonly MacroOriginRange[]) {
  let first = 0;
  return (start: number, end: number): MacroOrigin[] => {
    while (first < ranges.length && ranges[first].end <= start) first++;
    const result = new Set<MacroOrigin>();
    for (let index = first; index < ranges.length && ranges[index].start < end; index++) {
      for (const origin of ranges[index].origins) result.add(origin);
    }
    return [...result];
  };
}

/**
 * Join an edit's origins onto target event indices (for example saved AST
 * indices). Equality is required: this is a span join, not a text diff.
 */
export function mapMacroExpressionOrigins(
  source: MacroExpressionTrace,
  target: MacroExpressionTrace,
  targetCount: number,
): MacroOrigins[] {
  if (source.expression !== target.expression) {
    throw new Error('Macro expressions must match');
  }
  const readOrigins = createMacroOriginReader(source.ranges);
  const result = Array.from({length: targetCount}, () => new Set<MacroOrigin>());
  for (const range of target.ranges) {
    const origins = readOrigins(range.start, range.end);
    for (const targetOrigin of range.origins) {
      for (const origin of origins) result[targetOrigin].add(origin);
    }
  }
  return result.map((origins) => [...origins]);
}
