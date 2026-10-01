import {useEffect, useId, useRef, useState, type ReactNode, type Ref} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {
  TAP_DANCE_ACTION_ROLES,
  tapDanceVisibleRoles,
  tapDanceImmediate,
  type TapDanceActionRole,
  type TapDanceDraft,
  type TapDanceChanges,
  type TapDanceField,
  type TapDanceSlot,
} from 'src/utils/keycode-palette';
import {AccentButton, PrimaryAccentButton, handFocus} from '../accent-button';
import {DirtyDot} from '../dirty-dot';
import {IntegerInput, NumberBox} from '../integer-input';
import {useExplainDisclosure} from '../explain';
import {HelpBody, HelpContent, HelpParagraph} from '../../panes/configure-panes/custom/help-content';
import {Label} from '../../panes/grid';
import {
  Keycap,
  KeycapView,
  keyWidth,
  type KeycapColors,
} from './palette-keycap';
import {
  LinePanel,
  TextAction,
  accent,
  accentText,
  hairline,
  muted,
  panelWash,
  strong,
} from './palette-parts';

export const ROLE_LABEL: Record<TapDanceActionRole, string> = {
  tap: 'On Tap',
  hold: 'On Hold',
  dtap: 'On Double Tap',
  thold: 'Tap+Hold',
};

const ROLE_HINT: Record<TapDanceActionRole, string> = {
  tap: 'Tap once',
  hold: 'Press and hold',
  dtap: 'Tap twice',
  thold: 'Tap, then hold',
};

export type Legend = {top: string; bottom: string; name: string};

/** A slot as it is shown: the keyboard's values with unapplied changes in place. */
export type TapDanceSlotState = {
  draft: TapDanceDraft;
  /** The fields that hold a change not applied yet. */
  dirty: Set<TapDanceField>;
  /** The keyboard's values. */
  saved: TapDanceDraft;
  /** Whether the term lets Save go ahead: the keyboard's own, or one it takes. */
  termValid: boolean;
};

// ------------------------------------------------------------------ list

// Keep the list close to the category tabs; long action names wrap within a row.
const Rows = styled.section`
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
`;

const Row = styled.div<{$recent: boolean}>`
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 18px;
  min-height: 62px;
  padding: 4px 10px;
  box-sizing: border-box;
  border-bottom: 1px solid ${hairline};
  border-radius: 6px;
  background: ${(props) => (props.$recent ? panelWash : 'transparent')};
`;

// The list marks a changed slot beside its TD key; the editor marks each
// changed value directly. The list mark sits in the gap to keep summaries aligned.
const SlotKey = styled.span`
  position: relative;
  display: flex;
  flex-shrink: 0;
`;

const RowDirtyDot = styled(DirtyDot)`
  position: absolute;
  top: 4px;
  left: calc(100% + 4px);
`;

const Summary = styled.span<{$empty: boolean}>`
  flex-grow: 1;
  min-width: 0;
  font-size: inherit;
  color: ${(props) => (props.$empty ? muted : strong)};
  line-height: 1.5;
  overflow-wrap: anywhere;
`;

const SummaryAction = styled.span`
  display: inline-block;
  max-width: 100%;
`;

// The keys a Tap Dance sends read in the label colour; the dots between them and
// the unset actions step back and keep their distance, so the keys stand apart.
const Separator = styled.span`
  padding: 0 8px;
  color: ${muted};
`;

const Unset = styled.span`
  color: ${muted};
`;

const Note = styled.span<{$accent?: boolean}>`
  flex-shrink: 0;
  font-size: inherit;
  color: ${(props) => (props.$accent ? accentText : muted)};
  white-space: nowrap;
`;

export const TapDanceList = ({
  slots,
  stateOf,
  slotValue,
  targetValue,
  colors,
  legendOf,
  recent,
  editRef,
  onAssign,
  onEdit,
  onHover,
}: {
  slots: TapDanceSlot[];
  /** Null until the keyboard has reported the slot. */
  stateOf: (slot: TapDanceSlot) => TapDanceSlotState | null;
  slotValue: (slot: TapDanceSlot) => number | null;
  targetValue: number | null;
  colors: KeycapColors;
  legendOf: (value: number) => Legend;
  recent: {index: number; tag: string} | null;
  /** A row's Edit button, which takes focus back when its editor closes. */
  editRef?: (slot: TapDanceSlot) => Ref<HTMLButtonElement>;
  onAssign: (slot: TapDanceSlot) => void;
  onEdit: (slot: TapDanceSlot) => void;
  onHover: (slot: TapDanceSlot) => void;
}) => {
  const {t} = useTranslation();
  // No instruction line: a keycap is picked like any other, and each row says Edit.
  return (
    <Rows>
      {slots.map((slot) => {
        const state = stateOf(slot);
        const values = state?.draft;
        const roles = values ? tapDanceVisibleRoles(values) : TAP_DANCE_ACTION_ROLES;
        const empty = !!values && roles.every((role) => values.actions[role] === 0);
        const isCurrent =
          targetValue !== null && slotValue(slot) === targetValue;
        const isRecent = recent?.index === slot.index;
        const summary: ReactNode = !values
          ? t('Waiting for the keyboard')
          : empty
            ? t('Empty')
            : roles.map((role, index) => (
                <SummaryAction key={role}>
                  {values.actions[role] === 0 ? (
                    <Unset>{values.mode !== undefined && values.mode !== 0 ? t('No input') : '—'}</Unset>
                  ) : (
                    legendOf(values.actions[role]).name
                  )}
                  {index < roles.length - 1 ? <Separator>·</Separator> : null}
                </SummaryAction>
              ));
        return (
          <Row key={slot.index} $recent={isRecent}>
            <SlotKey>
              <Keycap
                top={slot.name}
                bottom=""
                width={keyWidth(1)}
                colors={colors}
                current={isCurrent}
                ariaLabel={t('Put {{name}} on the selected key', {
                  name: slot.name,
                })}
                onPick={() => onAssign(slot)}
                onHover={() => onHover(slot)}
              />
              {state && state.dirty.size > 0 ? (
                <RowDirtyDot aria-hidden="true" />
              ) : null}
            </SlotKey>
            <Summary $empty={!values || empty}>{summary}</Summary>
            {/* A term Save could not write is not a setting yet, so the row
                keeps the keyboard's; its dot tells of the change. */}
            {state && slot.term ? (
              <Note>
                {state.termValid ? state.draft.term : state.saved.term} ms
              </Note>
            ) : null}
            {isRecent && recent?.tag ? <Note $accent>{recent.tag}</Note> : null}
            <AccentButton
              ref={editRef?.(slot)}
              type="button"
              disabled={!values}
              aria-label={t('Edit {{name}}', {name: slot.name})}
              onClick={() => onEdit(slot)}
            >
              {t('Edit')}
            </AccentButton>
          </Row>
        );
      })}
    </Rows>
  );
};

// ---------------------------------------------------------------- editor

// Keep each action together when the pinned editor wraps.
const SlotRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
`;

const SettingsRow = styled(SlotRow)`
  font-size: inherit;
`;

const TimingFields = styled(SlotRow)<{$split: boolean}>`
  gap: 6px 16px;
  ${NumberBox} { width: ${(props) => props.$split ? '6ch' : '88px'}; }
`;

const SaveActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;

`;

const EditorBody = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px 16px;
  @media (max-width: 900px) { grid-template-columns: minmax(0, 1fr); }
`;

const EditorFields = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;

const ButtonDivider = styled.div`
  width: 100%;
  height: 1px;
  background: ${hairline};
`;

const EditorButtons = styled.div`
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  @media (max-width: 900px) {
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    ${ButtonDivider} { width: 1px; height: 28px; }
    ${SaveActions} { margin-left: 0; }
  }
`;

const SettingsToggle = styled(TextAction)`
  gap: 6px;
`;

const PreviewToggle = styled(SettingsToggle)`
  flex-shrink: 0;
  margin-left: auto;
`;

const SettingsMarks = styled.span`
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 0 0 6px;
  width: 6px;
  height: 16px;
`;

const AdvancedSettings = styled.div`
  padding-top: 8px;
  &[hidden] { display: none; }
`;

const TimingGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: start;
  gap: 6px;
`;

const TimingOption = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  color: ${strong};
  cursor: pointer;
  input { flex: none; width: 16px; height: 16px; margin: 0; accent-color: ${accent}; }
`;

const InputSetting = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: inherit;
  color: ${muted};
  white-space: nowrap;
  margin-right: 12px;
`;

const TapDanceHelp = styled(HelpBody)`
  max-width: none;
  width: 100%;
`;

const ModeChoices = styled.div`
  display: inline-flex;
  gap: 2px;
`;

const ModeOption = styled.label`
  position: relative;
  cursor: pointer;

  input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  > span {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding: 0 8px;
    border-bottom: 2px solid transparent;
    font-size: inherit;
    color: ${muted};
  }
  input:checked + span {
    border-bottom-color: ${accent};
    color: ${strong};
  }
  &:hover input:not(:disabled) + span { color: ${strong}; }
  input:focus-visible + span {
    outline: 2px solid ${accent};
    outline-offset: 1px;
  }
  input:disabled + span {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const AddActions = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  margin-left: 6px;
`;

const AddAction = styled(TextAction)`
  min-height: 40px;
  gap: 6px;
  color: ${muted};
  &:hover:not(:disabled) { color: ${accentText}; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const AddSymbol = styled.span`
  font-size: 24px;
  line-height: 1;
`;

const ActionGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
`;

const RemoveAction = styled(TextAction)`
  justify-content: center;
  min-width: 40px;
  min-height: 40px;
  padding: 0;
  color: ${muted};
  font-size: 24px;
`;

const BehaviorPreview = styled.table`
  border-collapse: collapse;
  width: 100%;
  max-width: 760px;
  margin: 0 0 8px;
  caption { text-align: left; padding-bottom: 4px; color: ${strong}; }
  th, td { text-align: left; padding: 5px 12px 5px 0; font-weight: 400; border-bottom: 1px solid ${hairline}; }
  td { color: ${strong}; }
`;

export const PickerSlotLabel = styled.span<{$focused: boolean}>`
  font-size: 16px;
  color: ${(props) => (props.$focused ? strong : muted)};
  white-space: nowrap;
`;

// A slot is a tab like the category tabs: its keycap and name, underlined when
// the next picked key goes there, the name brightening under the pointer as a
// tab's does. Its keycap stays still; only the keys to pick lift.
export const PickerSlotButton = styled.button<{$focused: boolean}>`
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 4px 8px 6px 2px;
  box-sizing: border-box;
  border: 0;
  border-bottom: 2px solid
    ${(props) => (props.$focused ? accent : 'transparent')};
  border-radius: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled) ${PickerSlotLabel} {
    color: ${strong};
  }
  &:focus-visible {
    outline: 2px solid ${accent};
    outline-offset: 1px;
  }
`;

const ActionLabel = styled(PickerSlotLabel)`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

// Reserve the mark's space so saving a change never moves the label or field.
const MarkSpace = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 6px;
  width: 6px;
  height: 6px;
`;

// The term is the same whole-number field the menus use for milliseconds,
// labelled as a menu row is. Its range goes under it: in some languages the row
// has no room to spare beside it, and the field must not move under the caret.
const TermLabel = styled(Label)`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: inherit;
  white-space: nowrap;
`;

const TermValue = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

// Keep one text size across the editor without changing the shared palette.
const EditorFrame = styled.section`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 18px;

  ${TextAction}, ${PickerSlotLabel}, ${AccentButton}, ${PrimaryAccentButton} {
    font-size: inherit;
  }
  ${RemoveAction} { font-size: 24px; }
`;

const ErrorLine = styled.div`
  font-size: 16px;
  color: var(--color_error);
`;

export type TapDanceEditorView = TapDanceSlotState & {
  slot: TapDanceSlot;
  focus: number;
  termBounds: {minMs: number; maxMs: number};
  canApply: boolean;
  applyBlockedReason: string;
  applying: boolean;
  error: string | null;
  placed: boolean;
  canPlace: boolean;
};

export const TapDanceEditor = ({
  view,
  categoryLabel,
  colors,
  legendOf,
  onPlace,
  onFocusSlot,
  onTerm,
  onMode,
  onAddAction,
  onRemoveAction,
  onTiming,
  onCancel,
  onApply,
}: {
  view: TapDanceEditorView;
  categoryLabel: string;
  colors: KeycapColors;
  legendOf: (value: number) => Legend;
  onPlace: () => void;
  onFocusSlot: (index: number) => void;
  onTerm: (term: string) => void;
  onMode?: (mode: number) => void;
  onAddAction?: (role: TapDanceActionRole) => void;
  onRemoveAction?: (role: TapDanceActionRole) => void;
  onTiming?: (changes: Pick<TapDanceChanges, 'holdTerm' | 'holdOnOther'>) => void;
  onCancel: () => void;
  onApply: () => void;
}) => {
  const {t} = useTranslation();
  const {slot, draft, dirty, focus, termBounds} = view;
  const modeGroup = useId();
  const timingId = useId();
  const [timingOpen, setTimingOpen] = useState(false);
  const advanced = draft.holdTerm !== undefined;
  const separateHold = advanced && draft.holdTerm !== '0';
  const previewId = useId();
  const [previewOpen, setPreviewOpen] = useState(false);
  const {toggle: timeHelpToggle, bodyProps: timeHelpBodyProps} = useExplainDisclosure(
    t('What this means: {{name}}', {name: `${categoryLabel} · ${slot.name} · ${t('Decision time')}`}),
  );
  const {toggle: inputHelpToggle, bodyProps: inputHelpBodyProps} = useExplainDisclosure(
    t('What this means: {{name}}', {name: `${categoryLabel} · ${slot.name} · ${t('Input start')}`}),
  );
  const changeMark = (field: TapDanceField) => (
    <MarkSpace aria-hidden="true" title={dirty.has(field) ? t('Not saved yet') : undefined}>
      {dirty.has(field) ? <DirtyDot /> : null}
    </MarkSpace>
  );
  const modern = draft.mode !== undefined;
  const roles = tapDanceVisibleRoles(draft);
  const immediate = tapDanceImmediate(draft);
  const hasHold = roles.includes('hold');
  const hasExtras = roles.length > 1;
  const showTiming = !modern || draft.mode === 0 || hasExtras;
  // Keep a way to leave On press before adding Hold to a base-only slot.
  const showInputStart = modern && (showTiming || draft.mode === 2);
  const baseName = draft.actions.tap <= 1 ? t('No input') : legendOf(draft.actions.tap).name;
  const actionName = (role: TapDanceActionRole) => role === 'tap' && modern ? t('Base key') : t(ROLE_LABEL[role]);
  const outputName = (value: number) => value < 0 ? t('Select a key') : value <= 1 ? t('No input') : legendOf(value).name;
  const resultFor = (role: TapDanceActionRole) => {
    if (role === 'tap') return baseName;
    const own = roles.includes(role);
    if (role === 'hold') return own ? outputName(draft.actions.hold) : baseName;
    if (immediate) return `${baseName} → ${own ? outputName(draft.actions[role]) : baseName}`;
    if (own) return outputName(draft.actions[role]);
    return `${baseName} → ${role === 'thold' && hasHold ? outputName(draft.actions.hold) : baseName}`;
  };
  // Opening takes keyboard focus to the slot the next key goes to. Put in and
  // Save, which go away or turn off once used, hand it there too.
  const slotButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const putRef = useRef<HTMLButtonElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const previewButton = modern ? (
    <PreviewToggle type="button" aria-expanded={previewOpen} aria-controls={previewId}
      aria-label={`${t('Preview actions')}: ${slot.name}`}
      onClick={() => setPreviewOpen(!previewOpen)}>
      {t('Preview')}
      <span aria-hidden="true">{previewOpen ? '▴' : '▾'}</span>
    </PreviewToggle>
  ) : null;
  const previewBody = modern ? (
    <TapDanceHelp id={previewId} hidden={!previewOpen}>
      <BehaviorPreview>
        <caption>{t('Preview actions')}</caption>
        <tbody>{TAP_DANCE_ACTION_ROLES.map((role) => (
          <tr key={role}><th scope="row">{t(ROLE_LABEL[role])}</th><td>{resultFor(role)}</td></tr>
        ))}</tbody>
      </BehaviorPreview>
      <HelpParagraph>{t('Removing an action uses the base key. No input suppresses that action; an immediate first input remains.')}</HelpParagraph>
    </TapDanceHelp>
  ) : null;
  useEffect(() => {
    slotButtons.current[focus]?.focus();
  }, [focus, roles.join('|')]);
  return (
    <EditorFrame aria-label={t('Edit {{name}}', {name: slot.name})}>
      <LinePanel as="div">
        <EditorBody>
        <EditorFields>
        <SlotRow role="group" aria-label={t('Tap Dance actions')}>
          {roles.map((role) => {
            const index = TAP_DANCE_ACTION_ROLES.indexOf(role);
            const focused = index === focus;
            const legend = modern && draft.actions[role] < 0
              ? {top: t('Select'), bottom: '', name: t('Select a key')}
              : modern && draft.actions[role] === 0
                ? {top: t('No input'), bottom: '', name: t('No input')}
                : legendOf(draft.actions[role]);
            return (
              <ActionGroup key={role}>
              <PickerSlotButton
                ref={(element) => {
                  slotButtons.current[index] = element;
                }}
                type="button"
                $focused={focused}
                aria-pressed={focused}
                title={t(ROLE_HINT[role])}
                onClick={() => onFocusSlot(index)}
              >
                <KeycapView
                  top={legend.top}
                  bottom={legend.bottom}
                  colors={colors}
                  glow={focused}
                />
                <ActionLabel $focused={focused}>
                  {actionName(role)}
                  {changeMark(role)}
                </ActionLabel>
              </PickerSlotButton>
              {modern && role !== 'tap' ? (
                <RemoveAction type="button" disabled={view.applying}
                  aria-label={t('Remove {{action}}', {action: actionName(role)})}
                  title={t('Remove this action to use the base key.')}
                  onClick={() => onRemoveAction?.(role)}>×</RemoveAction>
              ) : null}
              </ActionGroup>
            );
          })}
          {modern && roles.length < 4 ? (
            <AddActions role="group" aria-label={t('Add action')}>
              {TAP_DANCE_ACTION_ROLES.filter((role) => !roles.includes(role)).map((role) => (
                <AddAction
                  key={role}
                  type="button"
                  aria-label={`${t('Add action')}: ${actionName(role)}`}
                  disabled={view.applying || (role === 'hold' && draft.mode === 2)}
                  title={role === 'hold' && draft.mode === 2 ? t('Requires After decision') : undefined}
                  onClick={() => onAddAction?.(role)}
                >
                  <AddSymbol aria-hidden="true">+</AddSymbol>
                  {actionName(role)}
                </AddAction>
              ))}
            </AddActions>
          ) : null}
        </SlotRow>
        {previewBody}
        {slot.term && showTiming ? (
          <TimingFields $split={separateHold}>
            <TermLabel>
              <span>{modern ? t(separateHold ? 'Tap interval' : 'Decision time') : t('Term')}</span>
              <TermValue>
              <IntegerInput
                draft={draft.term}
                savedValue={Number(view.saved.term)}
                min={termBounds.minMs}
                max={termBounds.maxMs}
                onDraftChange={(term) => onTerm(term.trim())}
                onEnter={view.canApply ? onApply : undefined}
                ariaLabel={modern ? t(separateHold ? 'Tap interval' : 'Decision time') : t('Term')}
                suffix="ms"
                rangeBelow
              />
              {changeMark('term')}
              </TermValue>
            </TermLabel>
            {separateHold ? (
              <TermLabel>
                <span>{t('Hold decision')}</span>
                <TermValue>
                  <IntegerInput draft={draft.holdTerm!} savedValue={Number(view.saved.holdTerm) > 0 ? Number(view.saved.holdTerm) : Number(view.saved.term)}
                    min={1} max={65535} onDraftChange={(holdTerm) => onTiming?.({holdTerm: holdTerm.trim()})}
                    onEnter={view.canApply ? onApply : undefined} ariaLabel={t('Hold decision')} suffix="ms" rangeBelow />
                  {changeMark('holdTerm')}
                </TermValue>
              </TermLabel>
            ) : null}
            {modern && hasExtras ? (
              <SettingsToggle type="button" aria-expanded={advanced ? timingOpen : undefined} aria-controls={advanced ? timingId : undefined}
                disabled={!advanced} title={!advanced ? t('Update firmware to use advanced timing.') : undefined}
                onClick={() => setTimingOpen(!timingOpen)}>
                {t('Advanced settings')}
                <span aria-hidden="true">{timingOpen ? '▴' : '▾'}</span>
                <SettingsMarks aria-hidden="true">
                  {changeMark('holdTerm')}
                  {changeMark('holdOnOther')}
                </SettingsMarks>
              </SettingsToggle>
            ) : null}
            {timeHelpToggle}
          </TimingFields>
        ) : null}
        {advanced && hasExtras ? (
          <AdvancedSettings id={timingId} hidden={!timingOpen}>
            <TimingGrid>
              <TimingOption>
                <input type="checkbox" checked={separateHold} disabled={view.applying}
                  onChange={(event) => onTiming?.({holdTerm: event.target.checked ? draft.term : '0'})} />
                {t('Separate hold decision time')}{changeMark('holdTerm')}
              </TimingOption>
              <TimingOption>
                <input type="checkbox" checked={draft.holdOnOther === 1} disabled={view.applying}
                  onChange={(event) => onTiming?.({holdOnOther: event.target.checked ? 1 : 0})} />
                {t('Hold when another key is pressed')}{changeMark('holdOnOther')}
              </TimingOption>
            </TimingGrid>
          </AdvancedSettings>
        ) : null}
        {slot.term && showTiming ? (
          <TapDanceHelp {...timeHelpBodyProps}>
            {separateHold ? (
              <HelpContent content={{choices: [
                {name: t('Tap interval'), text: 'Tap interval is the time allowed from one press to the next.'},
                {name: t('Hold decision'), text: 'Hold decision is how long a key must stay pressed to count as Hold.'},
              ]}} />
            ) : (
              <HelpParagraph>{t('A longer decision time allows slower consecutive presses and takes longer to confirm Hold.')}</HelpParagraph>
            )}
            {modern && !advanced ? <HelpParagraph>{t('Update firmware to use advanced timing.')}</HelpParagraph> : null}
          </TapDanceHelp>
        ) : null}
        <SettingsRow>
          {showInputStart ? (
            <InputSetting role="radiogroup" aria-label={t('Input start')}
              aria-describedby={!inputHelpBodyProps.hidden ? inputHelpBodyProps.id : undefined}>
              <span aria-hidden="true">{t('Input start')}</span>
              <ModeChoices>
                {([1, 2] as const).map((mode) => (
                  <ModeOption
                    key={mode}
                    title={mode === 2 && hasHold
                      ? t('A separate Hold action requires After decision.')
                      : undefined}
                  >
                    <input
                      type="radio"
                      name={modeGroup}
                      value={mode}
                      checked={mode === (draft.mode === 2 ? 2 : 1)}
                      disabled={view.applying || (mode === 2 && hasHold)}
                      aria-label={t(mode === 1 ? 'After decision' : 'On press')}
                      onChange={() => onMode?.(mode)}
                    />
                    <span>
                      {t(mode === 1 ? 'After decision' : 'On press')}
                      {mode === (draft.mode === 2 ? 2 : 1) ? changeMark('mode') : <MarkSpace aria-hidden="true" />}
                    </span>
                  </ModeOption>
                ))}
              </ModeChoices>
            </InputSetting>
          ) : null}
          {modern || slot.mode ? (
            <>
              {!showInputStart ? <span>{t('Input start')}</span> : null}
              {inputHelpToggle}
            </>
          ) : null}
        </SettingsRow>
        {modern || slot.mode ? (
          <TapDanceHelp {...inputHelpBodyProps}>
            {modern ? (
              hasExtras ? (
                <HelpContent current={t(draft.mode === 2 ? 'On press' : 'After decision')} content={{choices: [
                  {name: t('After decision'), text: 'Waits for the decision before sending the selected action.'},
                  {name: t('On press'), text: 'The first press sends the base key immediately; only the second press waits.'},
                ]}} />
              ) : <HelpParagraph>{t('{{key}} responds on press and releases with the key.', {key: baseName})}</HelpParagraph>
            ) : <HelpParagraph>{t('Update firmware to use additional actions and immediate input.')}</HelpParagraph>}
          </TapDanceHelp>
        ) : null}
        </EditorFields>
        <EditorButtons>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexShrink: 0}}>
            {previewButton}
            {view.placed ? (
              <Note
                $accent
                role="status"
                title={t('Already on the selected key')}
                style={{minWidth: 100, textAlign: 'center'}}
              >
                ✓ {t('Placed')}
              </Note>
            ) : (
              <AccentButton
                ref={putRef}
                type="button"
                disabled={!view.canPlace}
                aria-label={t('Put {{name}} on the selected key', {
                  name: slot.name,
                })}
                title={t('Put {{name}} on the selected key', {name: slot.name})}
                onClick={() => {
                  handFocus(putRef.current, slotButtons.current[focus]);
                  onPlace();
                }}
              >
                {t('Put in')}
              </AccentButton>
            )}
          </div>
          <ButtonDivider aria-hidden="true" />
          <SaveActions>
            <AccentButton
              type="button"
              disabled={view.applying}
              onClick={onCancel}
            >
              {t('Cancel')}
            </AccentButton>
            <PrimaryAccentButton
              ref={applyRef}
              type="button"
              disabled={!view.canApply}
              title={view.applyBlockedReason}
              onClick={() => {
                handFocus(applyRef.current, slotButtons.current[focus]);
                return onApply();
              }}
            >
              {view.applying ? t('Saving…') : t('Save')}
            </PrimaryAccentButton>
          </SaveActions>
        </EditorButtons>
        </EditorBody>
        {view.error ? <ErrorLine role="alert">{view.error}</ErrorLine> : null}
      </LinePanel>
    </EditorFrame>
  );
};
