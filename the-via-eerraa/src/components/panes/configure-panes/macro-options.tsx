import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {createSelector} from '@reduxjs/toolkit';
import {useTranslation} from 'react-i18next';
import styled from 'styled-components';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faAngleDown} from '@fortawesome/free-solid-svg-icons';
import {NumberBox} from '../../inputs/integer-input';
import {DirtyDot} from '../../inputs/dirty-dot';
import {AccentButton, focusRing} from '../../inputs/accent-button';
import {ExplainRow, useExplainDisclosure} from '../../inputs/explain';
import {parseIntegerDraft} from 'src/utils/integer-field';
import {TextAction} from '../../inputs/keycode-palette/palette-parts';
import {badgePopupBounds} from '../../inputs/badge-dropdown';
import {ControlRow, Label} from '../grid';
import {HelpBody, HelpParagraph} from './custom/help-content';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getSelectedConnectedDevice,
  getSelectedConnectionGeneration,
} from 'src/store/devicesSlice';
import {
  ensureMacroOptions,
  getMacroOptionsChannel,
  getSelectedMacroOptions,
  getSelectedMacroOptionsUnsaved,
  saveMacroOptionsToDevice,
} from 'src/store/macroOptionsSlice';
import {
  discardDrafts,
  draftKey,
  getSelectedDeviceDrafts,
  setDraft,
  settleWrittenDraft,
} from 'src/store/draftsSlice';
import {ERA_WIRE} from 'src/utils/era-wire.generated';
import {
  isUntilStoppedWithoutStop,
  MACRO_OPTIONS_DEFAULTS,
  MACRO_OPTIONS_HOLD_MS,
  MACRO_OPTIONS_REPEAT,
  MACRO_OPTIONS_STOPS,
  type MacroOptionValues,
} from 'src/utils/macro-api/era-macro-options';

// MACROS' Playback button: the playback options of the macro being edited, in a
// small form it opens. It shows only while the connected firmware reports
// macro-option support, each option only where the firmware's supported mask has
// it. Its draft is saved by the macro editor's own Apply, after the macro's
// content, and like the macro's text draft it belongs to the keyboard
// (draftsSlice), so closing the form or leaving the pane keeps it.

const FLAG = ERA_WIRE.MACRO_OPTIONS_FLAGS;

const Anchor = styled.div`
  position: relative;
`;
const PlayButton = styled(AccentButton)`
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  line-height: 32px;
  min-width: 0;
  font-size: 18px;
  box-sizing: border-box;
  padding: 0 12px;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  &:hover {
    border-color: var(--bg_icon-highlighted);
  }
  &[aria-expanded='true'] {
    border-color: var(--color_accent);
    color: var(--color_accent-text);
  }
  > svg {
    font-size: 12px;
  }
  ${focusRing}
`;
// Clicks outside the open form land here and only close it.
const ClickCover = styled.div`
  position: fixed;
  inset: 0;
  z-index: 10;
`;
const Popover = styled(ControlRow)<{$bounds: ReturnType<typeof badgePopupBounds>}>`
  display: block;
  min-height: 0;
  font-size: 18px;
  line-height: 1.35;
  position: fixed;
  left: ${(props) => props.$bounds.left}px;
  top: ${(props) => props.$bounds.top}px;
  z-index: 11;
  width: ${(props) => props.$bounds.width}px;
  max-width: calc(100vw - 16px);
  max-height: ${(props) => props.$bounds.maxHeight}px;
  overflow-y: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
  padding: 4px 14px 10px;
  background: var(--bg_menu);
  border: 1px solid var(--border_color_cell);
  border-radius: 6px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
  color: var(--color_label-highlighted);
  text-align: left;
`;
const Row = styled(ControlRow)`
  min-height: 0;
  font-size: inherit;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  line-height: 1.35;
  padding: 6px 4px;
  &:last-child {
    border-bottom: 0;
  }
`;
const RowLabel = styled(Label)`
  line-height: 34px;
`;
const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 12px;
  min-width: 0;
`;
const StopList = styled.div`
  flex: 0 0 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: start;
  row-gap: 2px;
  min-width: 0;
`;
const HoldRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  min-height: 34px;
  width: 100%;
`;
const HoldField = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;
const Inline = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 34px;
`;
const Check = styled.label<{$disabled?: boolean}>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  color: ${(props) =>
    props.$disabled ? 'var(--color_label)' : 'var(--color_label-highlighted)'};
  cursor: ${(props) => (props.$disabled ? 'default' : 'pointer')};
  input {
    flex: none;
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--color_accent);
    cursor: inherit;
  }
`;
const Select = styled.select`
  font: inherit;
  height: 34px;
  padding: 0 8px;
  color: var(--color_accent-text);
  background: var(--bg_menu);
  border: 1px solid var(--color_accent);
  border-radius: 4px;
  ${focusRing}
`;
const NumberField = styled(NumberBox)<{$invalid: boolean}>`
  width: 72px;
  height: 34px;
  box-sizing: border-box;
  padding: 2px 0;
  background: none;
  border: none;
  border-bottom: 1px solid
    ${(props) =>
      props.$invalid ? 'var(--color_error)' : 'var(--border_color_icon)'};
  &:disabled {
    color: var(--color_label);
    border-color: var(--border_color_cell);
  }
  &:focus-visible {
    outline: 2px solid var(--color_accent);
    outline-offset: 2px;
  }
`;
const Unit = styled.span<{$disabled?: boolean}>`
  color: ${(props) =>
    props.$disabled ? 'var(--color_label)' : 'var(--color_label-highlighted)'};
`;
const Segmented = styled.div`
  display: inline-flex;
  gap: 4px;
  box-sizing: border-box;
`;
const SegmentOption = styled.label<{$checked: boolean}>`
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 10px;
  border-bottom: 2px solid
    ${(props) => (props.$checked ? 'var(--color_accent)' : 'transparent')};
  cursor: pointer;
  background: transparent;
  color: ${(props) =>
    props.$checked ? 'var(--color_label-highlighted)' : 'var(--color_label)'};
  input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    opacity: 0;
  }
  &:focus-within {
    outline: 2px solid var(--color_accent);
    outline-offset: -3px;
  }
`;
const Refusal = styled(HelpBody)`
  margin: 6px 0 0;
  word-break: keep-all;
  color: var(--color_error);
`;
const Note = styled.span`
  display: block;
  max-width: 320px;
  text-align: right;
  font-size: 14px;
  color: var(--color_label);
`;

const OptionGroup = ({
  label, labelId, stacked = false, children, help,
}: {
  label: string;
  labelId?: string;
  stacked?: boolean;
  children: ReactNode;
  help: ReactNode;
}) => {
  const {toggle, bodyProps} = useExplainDisclosure(label);
  const Body = stacked ? StopList : Controls;
  return (
    <Row>
      <ExplainRow>
        <RowLabel id={labelId}>{label}</RowLabel>
        {help ? toggle : null}
      </ExplainRow>
      <Body>{children}</Body>
      <HelpBody {...bodyProps}>{help}</HelpBody>
    </Row>
  );
};

type RepeatMode = 'once' | 'times' | 'until';
/** A macro's options as its form holds them, the numbers as typed. */
type Draft = {flags: number; hold: string; repeat: RepeatMode; count: string};
/** What keeps a draft from being written, in the order the form names it. */
type Problem = 'count' | 'until' | 'hold';

const DRAFT_PREFIX = draftKey('macroOptions', '');
export const macroOptionsDraftKey = (macroIndex: number) =>
  draftKey('macroOptions', macroIndex);

const parseHold = (hold: string) =>
  parseIntegerDraft(hold, MACRO_OPTIONS_HOLD_MS.min, MACRO_OPTIONS_HOLD_MS.max);
const parseCount = (count: string) =>
  parseIntegerDraft(count, MACRO_OPTIONS_REPEAT.min, MACRO_OPTIONS_REPEAT.max);

// N times starts from the fewest it takes where the keyboard does not repeat.
const draftOf = ({flags, holdMs, repeatCount}: MacroOptionValues): Draft => ({
  flags,
  hold: String(holdMs),
  repeat:
    repeatCount === MACRO_OPTIONS_REPEAT.once
      ? 'once'
      : repeatCount === MACRO_OPTIONS_REPEAT.untilStopped
        ? 'until'
        : 'times',
  count: String(Math.max(repeatCount, MACRO_OPTIONS_REPEAT.min)),
});

/** A draft that only spells what the keyboard holds. */
const isStoredDraft = (draft: Draft, stored: MacroOptionValues) => {
  const base = draftOf(stored);
  return (
    draft.flags === base.flags &&
    draft.hold === base.hold &&
    draft.repeat === base.repeat &&
    (draft.repeat !== 'times' || draft.count === base.count)
  );
};

/**
 * The values a draft writes and what keeps it from being written. A field the
 * options in force do not use (the count away from N times, the hold time while
 * Stop on hold does not decide) blocks nothing, and one it cannot take keeps
 * the keyboard's value.
 */
const resolveDraft = (draft: Draft, stored: MacroOptionValues) => {
  const count = parseCount(draft.count);
  const hold = parseHold(draft.hold);
  const repeatCount =
    draft.repeat === 'once'
      ? MACRO_OPTIONS_REPEAT.once
      : draft.repeat === 'until'
        ? MACRO_OPTIONS_REPEAT.untilStopped
        : count.ok
          ? count.value
          : stored.repeatCount;
  const holdDecides =
    (draft.flags & FLAG.HOLD) !== 0 && (draft.flags & FLAG.RELEASE) === 0;
  const problems: Problem[] = [];
  if (draft.repeat === 'times' && !count.ok) problems.push('count');
  if (draft.repeat === 'until' && isUntilStoppedWithoutStop({flags: draft.flags, repeatCount})) {
    problems.push('until');
  }
  if (holdDecides && !hold.ok) problems.push('hold');
  return {
    values: {flags: draft.flags, holdMs: hold.ok ? hold.value : stored.holdMs, repeatCount},
    problems,
  };
};

/** The selected keyboard's macro option edits that are not written yet, by macro. */
const getSelectedMacroOptionDrafts = createSelector(getSelectedDeviceDrafts, (drafts) => {
  const optionDrafts: Record<number, Draft> = {};
  Object.entries(drafts).forEach(([key, value]) => {
    if (key.startsWith(DRAFT_PREFIX)) {
      optionDrafts[Number(key.slice(DRAFT_PREFIX.length))] = value as Draft;
    }
  });
  return optionDrafts;
});

const isDraftPending = (draft: Draft | undefined, stored: MacroOptionValues | undefined) => {
  if (!draft || !stored) return false;
  const {values, problems} = resolveDraft(draft, stored);
  return (
    problems.length > 0 ||
    values.flags !== stored.flags ||
    values.holdMs !== stored.holdMs ||
    values.repeatCount !== stored.repeatCount
  );
};

type PlaybackOptionsProps = {
  supported: number;
  draft: Draft;
  problems: Problem[];
  onEdit: (next: Partial<Draft>) => void;
};

/**
 * The Playback button and the form it opens. Escape or a click outside closes
 * the form and gives focus back to the button; closing keeps the draft, which
 * only the editor's Apply and Cancel write or discard.
 */
const PlaybackOptions = ({supported, draft, problems, onEdit}: PlaybackOptionsProps) => {
  const {t} = useTranslation();
  const [open, setOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [bounds, setBounds] = useState<ReturnType<typeof badgePopupBounds>>({
    left: 8, top: 8, width: 440, maxHeight: 400,
  });
  const button = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const problemKey = problems.join('|');
  const id = useId();
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);
  useEffect(() => {
    if (typeof document !== 'undefined' && document.body?.nodeType === 1) {
      setPortalHost(document.body);
    }
  }, []);
  useLayoutEffect(() => {
    if (!open || !portalHost) return;
    const fit = () => {
      const anchor = button.current?.getBoundingClientRect();
      const panel = form.current;
      if (!anchor || !panel) return;
      const height = panel.scrollHeight + panel.offsetHeight - panel.clientHeight;
      setBounds(badgePopupBounds(
        anchor,
        {width: window.innerWidth, height: window.innerHeight},
        440,
        height,
        {maxHeight: window.innerHeight, minBelowHeight: height},
      ));
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (button.current) observer.observe(button.current);
    if (content.current) observer.observe(content.current);
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit, true);
    };
  }, [open, portalHost, draft.flags, draft.repeat, problemKey, t]);
  useLayoutEffect(() => {
    if (open && portalHost) {
      form.current?.querySelector<HTMLSelectElement>('select')?.focus();
    }
  }, [open, portalHost]);
  // On the window, so Escape closes the form wherever focus went, such as the
  // Script tab Shift+Tab reaches from the form.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);
  const has = (bits: number) => (supported & bits) !== 0;
  const on = (bit: number) => (draft.flags & bit) !== 0;
  const setFlag = (bit: number, value: boolean) =>
    onEdit({flags: value ? draft.flags | bit : draft.flags & ~bit});
  const count = parseCount(draft.count);
  const hold = parseHold(draft.hold);
  const summary =
    draft.repeat === 'once'
      ? t('Playback: once')
      : draft.repeat === 'until'
        ? t('Playback: until stopped')
        : t('Playback: {{times}} times', {times: count.ok ? count.value : 'N'});
  // Every option but Repeat, which the button spells out.
  const changed =
    draft.flags !== MACRO_OPTIONS_DEFAULTS.flags ||
    !hold.ok ||
    hold.value !== MACRO_OPTIONS_DEFAULTS.holdMs;
  const released = on(FLAG.RELEASE);
  const check = (bit: number, label: string, disabled = false) =>
    has(bit) && (
      <Check $disabled={disabled}>
        <input
          type="checkbox"
          checked={on(bit)}
          disabled={disabled}
          onChange={(event) => setFlag(bit, event.target.checked)}
        />
        {label}
      </Check>
    );
  const refusals: Record<Problem, string> = {
    count: t('Enter a repeat count of 2–255.'),
    until: t('To repeat until stopped, turn on a stop condition.'),
    hold: t('Enter a hold time of 1–65535 ms.'),
  };
  const layer = (children: ReactNode) =>
    portalHost ? createPortal(children, portalHost) : children;
  return (
    <Anchor data-macro-options="playback">
      <PlayButton
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-form` : undefined}
        title={changed ? t('Some options differ from their defaults.') : undefined}
        onClick={() => setOpen(!open)}
      >
        <span>{summary}</span>
        {changed ? <DirtyDot aria-hidden="true" /> : null}
        <FontAwesomeIcon icon={faAngleDown} />
      </PlayButton>
      {open ? layer(
        <>
          <ClickCover data-macro-options-cover onClick={close} />
          <Popover
            ref={form}
            $bounds={bounds}
            id={`${id}-form`}
            role="dialog"
            aria-label={t('Playback options')}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const fields = event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), select:not(:disabled), input:not(:disabled):not([type="radio"]), input[type="radio"]:checked:not(:disabled)',
              );
              const boundary = event.shiftKey ? fields[0] : fields[fields.length - 1];
              if (event.target === boundary) {
                event.preventDefault();
                close();
              }
            }}
          >
            <div ref={content}>
            <Row>
              <RowLabel id={`${id}-repeat`}>{t('Repeat')}</RowLabel>
              <Controls>
                <Inline>
                  <Select
                    aria-labelledby={`${id}-repeat`}
                    value={draft.repeat}
                    onChange={(event) => onEdit({repeat: event.target.value as RepeatMode})}
                  >
                    <option value="once">{t('Once')}</option>
                    <option value="times">{t('N times')}</option>
                    <option value="until">{t('Until stopped')}</option>
                  </Select>
                  {draft.repeat === 'times' ? (
                    <>
                      <NumberField
                        inputMode="numeric"
                        aria-label={t('Repeat count')}
                        aria-invalid={problems.includes('count') || undefined}
                        $invalid={problems.includes('count')}
                        value={draft.count}
                        onChange={(event) => onEdit({count: event.target.value})}
                      />
                      <Unit>{t('times')}</Unit>
                    </>
                  ) : null}
                </Inline>
              </Controls>
            </Row>
            {has(MACRO_OPTIONS_STOPS) ? (
              <OptionGroup
                label={t('Playback control')}
                stacked
                help={
                  has(FLAG.RETAP | FLAG.HOLD) ? <HelpParagraph>
                    {released
                      ? t('Play only while held takes priority over stopping with a new press of the same macro key.')
                      : t('Stopping with a re-press requires a new press of the same macro key during playback.')}
                  </HelpParagraph> : null
                }
              >
                  {check(FLAG.RELEASE, t('released'))}
                  {check(FLAG.RETAP, t('re-tapped'), released)}
                  {has(FLAG.HOLD) ? (
                    <HoldRow>
                      {check(FLAG.HOLD, t('held'), released)}
                      {on(FLAG.HOLD) ? (
                        <HoldField>
                          <NumberField
                            inputMode="numeric"
                            aria-label={t('Hold time')}
                            aria-invalid={problems.includes('hold') || undefined}
                            $invalid={problems.includes('hold')}
                            disabled={released}
                            value={draft.hold}
                            onChange={(event) => onEdit({hold: event.target.value})}
                          />
                          <Unit $disabled={released}>ms</Unit>
                        </HoldField>
                      ) : null}
                    </HoldRow>
                  ) : null}
                  {check(FLAG.OTHER, t('another key is pressed'))}
              </OptionGroup>
            ) : null}
            {has(FLAG.BLOCK_OTHERS) ? (
              <OptionGroup
                label={on(FLAG.OTHER) ? t('Stopping key input') : t('Other keys')}
                labelId={`${id}-keys`}
                help={
                  <>
                    <HelpParagraph>
                      {on(FLAG.BLOCK_OTHERS)
                        ? on(FLAG.OTHER)
                          ? t('Another key stops the macro, and its input is dropped.')
                          : t('Other keys pressed during playback are not entered.')
                        : on(FLAG.OTHER)
                          ? t("The macro stops, and the ordinary key's action still runs.")
                          : t('Playback continues, and new ordinary keys still work.')}
                    </HelpParagraph>
                    <HelpParagraph>{t('Other macro keys pressed during playback do not start or queue their macros.')}</HelpParagraph>
                  </>
                }
              >
                  <Segmented role="radiogroup" aria-labelledby={`${id}-keys`}>
                    {[false, true].map((block) => (
                      <SegmentOption key={String(block)} $checked={on(FLAG.BLOCK_OTHERS) === block}>
                        <input
                          type="radio"
                          name={`${id}-block`}
                          checked={on(FLAG.BLOCK_OTHERS) === block}
                          onChange={() => setFlag(FLAG.BLOCK_OTHERS, block)}
                        />
                        {block ? t('Block') : t('Allow')}
                      </SegmentOption>
                    ))}
                  </Segmented>
              </OptionGroup>
            ) : null}
            {has(FLAG.IGNORE_MODS) ? (
              <Row>
                <RowLabel>{t('Modifiers')}</RowLabel>
                <Controls>{check(FLAG.IGNORE_MODS, t('Ignore'))}</Controls>
              </Row>
            ) : null}
            {problems.map((problem) => (
              <Refusal key={problem} role="status" data-macro-options-refused={problem}>
                {refusals[problem]}
              </Refusal>
            ))}
            </div>
          </Popover>
        </>
      ) : null}
    </Anchor>
  );
};

/**
 * The macros whose options draft would change what the keyboard holds, or is
 * still owed the SAVE a refusal left it without, as its editor counts it.
 */
export const getSelectedPendingMacroOptions = createSelector(
  getSelectedMacroOptionDrafts,
  getSelectedMacroOptions,
  getSelectedMacroOptionsUnsaved,
  (drafts, read, unsaved) =>
    new Set(
      read?.kind === 'read'
        ? Object.keys(drafts)
            .map(Number)
            .filter(
              (index) =>
                (unsaved && !!read.options[index]) ||
                isDraftPending(drafts[index], read.options[index]),
            )
        : [],
    ),
);

/**
 * The options of the macro being edited, for MACROS' Save: null where they are
 * not asked for, are unsupported or are not read yet, which leaves the editor as
 * it was.
 */
export const useMacroOptions = (index: number) => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();
  const device = useAppSelector(getSelectedConnectedDevice);
  const generation = useAppSelector(getSelectedConnectionGeneration);
  const channel = useAppSelector((state) =>
    device ? getMacroOptionsChannel(state, device) : null,
  );
  const read = useAppSelector(getSelectedMacroOptions);
  const unsaved = useAppSelector(getSelectedMacroOptionsUnsaved);
  const drafts = useAppSelector(getSelectedMacroOptionDrafts);
  // Read when nothing is known: at first, and on a new connection.
  const missing = channel !== null && read === undefined;
  useEffect(() => {
    if (device && missing) void dispatch(ensureMacroOptions(device));
  }, [dispatch, device, generation, missing]);
  if (!device || channel === null || !read || read.kind === 'unsupported') {
    return null;
  }
  if (read.kind === 'failed') {
    return {
      pending: false,
      valid: true,
      save: async () => true,
      control: (
        <Note role="status" data-macro-options="failed">
          {t('Could not read this from the device ({{reason}}).', {reason: read.reason})}{' '}
          <TextAction
            type="button"
            style={{display: 'inline', minHeight: 0, padding: 0}}
            onClick={() => void dispatch(ensureMacroOptions(device))}
          >
            {t('Read again')}
          </TextAction>
        </Note>
      ),
    };
  }
  const stored = read.options[index];
  if (!stored) return null;
  const {supported} = read;
  const draft = drafts[index] ?? draftOf(stored);
  const {problems} = resolveDraft(draft, stored);
  const pending = unsaved || isDraftPending(drafts[index], stored);
  const {path} = device;
  // As for the macro's text: a draft that comes back to what the keyboard holds ends.
  const edit = (next: Partial<Draft>) => {
    const value = {...draft, ...next};
    const key = macroOptionsDraftKey(index);
    dispatch(
      isStoredDraft(value, stored)
        ? discardDrafts({devicePath: path, keys: [key]})
        : setDraft({devicePath: path, key, value}),
    );
  };
  return {
    pending,
    valid: problems.length === 0,
    /** False where the options were not saved; the draft then stays. */
    save: async (macro: number) => {
      const entry = drafts[macro] ?? (macro === index ? draft : undefined);
      const target = read.options[macro];
      if (!entry || !target) return false;
      const resolved = resolveDraft(entry, target);
      if (resolved.problems.length > 0) return false;
      const saved = await dispatch(saveMacroOptionsToDevice(device, macro, resolved.values));
      // One edited while the write was on its way is newer and stays.
      if (saved) {
        dispatch(settleWrittenDraft({devicePath: path, key: macroOptionsDraftKey(macro), value: entry}));
      }
      return saved;
    },
    control: (
      <PlaybackOptions supported={supported} draft={draft} problems={problems} onEdit={edit} />
    ),
  };
};
export type MacroOptionsControl = NonNullable<ReturnType<typeof useMacroOptions>>;
