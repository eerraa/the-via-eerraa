import {
  expressionToSequence,
  mapMacroExpressionOrigins,
  projectSavedMacroSequenceTracked,
  transformMacroSequenceTracked,
  type IMacroAPI,
  type MacroExpressionTrace,
  type MacroOrigins,
  type MacroTransformTrace,
} from 'src/utils/macro-api/macro-api.common';
import {
  RawKeycodeSequenceAction,
  type OptimizedKeycodeSequence,
  type RawKeycodeSequence,
} from 'src/utils/macro-api/types';

export type MacroViewId = string;

/** Exact authoritative input to one mounted editor, not an additional draft. */
export type MacroEditSource = {
  devicePath: string | null;
  connectionGeneration: number | null;
  macroIndex: number;
  epoch: number;
  macroApi: IMacroAPI | undefined;
  draft: string | undefined;
  savedExpression: string;
  savedSequence: RawKeycodeSequence | undefined;
};

export type MacroEditFrame = {
  source: MacroEditSource;
  sequence: OptimizedKeycodeSequence;
  ids: readonly MacroViewId[];
  indexById: ReadonlyMap<MacroViewId, number>;
  revision: number;
};

/** Called only after the writer accepts the expected source, before publication. */
export type MacroEditRequest = {
  source: MacroEditSource;
  prepare: (nextSource: MacroEditSource) => boolean;
};

export type MacroEventEdit =
  | {type: 'wait'; value: number}
  | {type: 'delete'};

export type PreparedMacroEdit = {
  previous: MacroEditFrame;
  inputIds: readonly MacroViewId[];
  activeId: MacroViewId | undefined;
  trace: MacroTransformTrace;
};

export type MacroEditCompletion = {
  frame: MacroEditFrame;
  previousIds: readonly MacroViewId[];
  descendants: ReadonlyMap<MacroViewId, readonly MacroViewId[]>;
};

const EMPTY_SEQUENCE: RawKeycodeSequence = [];

export const sameMacroEditScope = (a: MacroEditSource, b: MacroEditSource) =>
  a.devicePath === b.devicePath &&
  a.connectionGeneration === b.connectionGeneration &&
  a.macroIndex === b.macroIndex &&
  a.epoch === b.epoch &&
  a.macroApi === b.macroApi;

export const sameMacroEditSource = (a: MacroEditSource, b: MacroEditSource) =>
  sameMacroEditScope(a, b) &&
  a.draft === b.draft &&
  a.savedExpression === b.savedExpression &&
  a.savedSequence === b.savedSequence;

const makeFrame = (
  source: MacroEditSource,
  sequence: OptimizedKeycodeSequence,
  ids: readonly MacroViewId[],
  revision: number,
): MacroEditFrame => ({
  source,
  sequence,
  ids,
  indexById: new Map(ids.map((id, index) => [id, index])),
  revision,
});

export function createMacroEditFrame(
  source: MacroEditSource,
  allocateId: () => MacroViewId,
  revision = 0,
): MacroEditFrame {
  const sequence = source.draft !== undefined
    ? expressionToSequence(source.draft)
    : source.savedSequence ?? EMPTY_SEQUENCE;
  return makeFrame(source, sequence, sequence.map(allocateId), revision);
}

export function rebaseMacroEditFrame(
  frame: MacroEditFrame,
  source: MacroEditSource,
  allocateId: () => MacroViewId,
): MacroEditFrame {
  if (sameMacroEditSource(frame.source, source)) return frame;
  const sameDisplay = sameMacroEditScope(frame.source, source) &&
    (source.draft !== undefined
      ? frame.source.draft === source.draft
      : frame.source.draft === undefined &&
        frame.source.savedSequence === source.savedSequence);
  if (sameDisplay) return {...frame, source};
  return createMacroEditFrame(source, allocateId, frame.revision + 1);
}

export function prepareMacroEventEdit(
  frame: MacroEditFrame,
  targetId: MacroViewId,
  edit: MacroEventEdit,
): PreparedMacroEdit | undefined {
  const index = frame.indexById.get(targetId);
  if (index === undefined) return;
  const sequence = [...frame.sequence];
  const inputIds = [...frame.ids];
  if (edit.type === 'wait') {
    if (sequence[index][0] !== RawKeycodeSequenceAction.Delay) return;
    sequence[index] = [RawKeycodeSequenceAction.Delay, edit.value];
  } else {
    sequence.splice(index, 1);
    inputIds.splice(index, 1);
  }
  return {
    previous: frame,
    inputIds,
    activeId: edit.type === 'wait' ? targetId : undefined,
    trace: transformMacroSequenceTracked(sequence),
  };
}

export function completeMacroEventEdit(
  edit: PreparedMacroEdit,
  source: MacroEditSource,
  allocateId: () => MacroViewId,
  projectSaved: (sequence: RawKeycodeSequence) => MacroExpressionTrace =
    projectSavedMacroSequenceTracked,
): MacroEditCompletion | undefined {
  if (!sameMacroEditScope(edit.previous.source, source) ||
      edit.previous.source.savedSequence !== source.savedSequence ||
      edit.previous.source.savedExpression !== source.savedExpression ||
      (source.draft ?? source.savedExpression) !== edit.trace.expression) return;

  let sequence = edit.trace.sequence;
  let origins: MacroOrigins[] = edit.trace.origins;
  if (source.draft === undefined) {
    const saved = source.savedSequence ?? EMPTY_SEQUENCE;
    const projection = projectSaved(saved);
    if (projection.expression !== edit.trace.expression) return;
    sequence = saved;
    origins = mapMacroExpressionOrigins(edit.trace, projection, saved.length);
  }

  const ids: (MacroViewId | undefined)[] = new Array(sequence.length);
  const used = new Set<MacroViewId>();
  if (edit.activeId !== undefined) {
    const activeOrigin = edit.inputIds.indexOf(edit.activeId);
    const target = origins.findIndex((group, index) =>
      sequence[index][0] === RawKeycodeSequenceAction.Delay &&
      group.includes(activeOrigin));
    if (target >= 0) {
      ids[target] = edit.activeId;
      used.add(edit.activeId);
    }
  }

  const descendants = new Map<MacroViewId, MacroViewId[]>();
  origins.forEach((group, index) => {
    if (ids[index] === undefined) {
      let earliest = Infinity;
      for (const origin of group) {
        const candidate = edit.inputIds[origin];
        if (candidate === undefined) throw new Error('Unknown macro edit origin');
        if (!used.has(candidate)) earliest = Math.min(earliest, origin);
      }
      ids[index] = earliest < Infinity ? edit.inputIds[earliest] : allocateId();
      used.add(ids[index]!);
    }
    for (const origin of group) {
      const inputId = edit.inputIds[origin];
      if (inputId === undefined) throw new Error('Unknown macro edit origin');
      const targets = descendants.get(inputId) ?? [];
      targets.push(ids[index]!);
      descendants.set(inputId, targets);
    }
  });

  return {
    frame: makeFrame(
      source,
      sequence,
      ids as MacroViewId[],
      edit.previous.revision + 1,
    ),
    previousIds: edit.previous.ids,
    descendants,
  };
}

export function remapMacroViewId(
  id: MacroViewId,
  edit: MacroEditCompletion,
): MacroViewId | undefined {
  const surviving = (candidate: MacroViewId) =>
    edit.frame.indexById.has(candidate)
      ? candidate
      : edit.descendants.get(candidate)?.[0];
  const direct = surviving(id);
  if (direct !== undefined) return direct;
  const previousIndex = edit.previousIds.indexOf(id);
  if (previousIndex < 0) return;
  for (let index = previousIndex + 1; index < edit.previousIds.length; index++) {
    const next = surviving(edit.previousIds[index]);
    if (next !== undefined) return next;
  }
  for (let index = previousIndex - 1; index >= 0; index--) {
    const previous = surviving(edit.previousIds[index]);
    if (previous !== undefined) return previous;
  }
}
