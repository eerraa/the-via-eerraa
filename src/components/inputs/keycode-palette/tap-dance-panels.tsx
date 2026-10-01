import {Fragment, useEffect, useRef, type ReactNode, type Ref} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {
  TAP_DANCE_ACTION_ROLES,
  type TapDanceActionRole,
  type TapDanceDraft,
  type TapDanceField,
  type TapDanceSlot,
} from 'src/utils/keycode-palette';
import {AccentButton, PrimaryAccentButton, handFocus} from '../accent-button';
import {DirtyDot} from '../dirty-dot';
import {IntegerInput} from '../integer-input';
import {Label} from '../../panes/grid';
import {
  Keycap,
  KeycapView,
  keyWidth,
  type KeycapColors,
} from './palette-keycap';
import {
  LinePanel,
  TabDivider,
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
  /** Whether the term lets Apply go ahead: the keyboard's own, or one it takes. */
  termValid: boolean;
};

// ------------------------------------------------------------------ list

// The list keeps to the width of a feature pane's rows, centred, so a slot's
// actions and its Edit button stay within reach of each other.
const Rows = styled.section`
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
`;

const Row = styled.div<{$recent: boolean}>`
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 62px;
  padding: 4px 10px;
  box-sizing: border-box;
  border-bottom: 1px solid ${hairline};
  border-radius: 6px;
  background: ${(props) => (props.$recent ? panelWash : 'transparent')};
`;

// A slot with changes not applied yet is marked at its key's corner, where the
// editor marks a changed action; it sits in the gap so the summaries stay in line.
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
  font-size: 17px;
  color: ${(props) => (props.$empty ? muted : strong)};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

// The keys a Tap Dance sends read in the label colour; the dots between them and
// the unset actions step back and keep their distance, so the keys stand apart.
const Separator = styled.span`
  padding: 0 12px;
  color: ${muted};
`;

const Unset = styled.span`
  color: ${muted};
`;

const Note = styled.span<{$accent?: boolean}>`
  font-size: 15px;
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
        const empty =
          !!values &&
          TAP_DANCE_ACTION_ROLES.every((role) => values.actions[role] === 0);
        const isCurrent =
          targetValue !== null && slotValue(slot) === targetValue;
        const isRecent = recent?.index === slot.index;
        const summary: ReactNode = !values
          ? t('Waiting for the keyboard')
          : empty
            ? t('Empty')
            : TAP_DANCE_ACTION_ROLES.map((role, index) => (
                <Fragment key={role}>
                  {index > 0 ? <Separator>·</Separator> : null}
                  {values.actions[role] === 0 ? (
                    <Unset>—</Unset>
                  ) : (
                    legendOf(values.actions[role]).name
                  )}
                </Fragment>
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
            {/* A term Apply could not write is not a setting yet, so the row
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

// The editor is one line pinned above the keys: the way back to the list leads it
// and the header names the slot. Where the line has no room it wraps, as a whole
// group per item.
const SlotRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
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

const SlotDirtyDot = styled(DirtyDot)`
  position: absolute;
  right: 6px;
  top: 6px;
`;

// The term is the same whole-number field the menus use for milliseconds,
// labelled as a menu row is. Its range goes under it: in some languages the row
// has no room to spare beside it, and the field must not move under the caret.
const TermLabel = styled(Label)`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 20px;
  white-space: nowrap;
`;

// Its mark sits beside the name without taking room, so the field under the
// caret does not move when the first digit changes it.
const TermName = styled.span`
  position: relative;
`;

const TermDirtyDot = styled(DirtyDot)`
  position: absolute;
  top: 4px;
  right: -9px;
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
  onBack,
  onPlace,
  onFocusSlot,
  onTerm,
  onCancel,
  onApply,
}: {
  view: TapDanceEditorView;
  categoryLabel: string;
  colors: KeycapColors;
  legendOf: (value: number) => Legend;
  onBack: () => void;
  onPlace: () => void;
  onFocusSlot: (index: number) => void;
  onTerm: (term: string) => void;
  onCancel: () => void;
  onApply: () => void;
}) => {
  const {t} = useTranslation();
  const {slot, draft, dirty, focus, termBounds} = view;
  // Opening takes keyboard focus to the slot the next key goes to. Put in and
  // Apply, which go away or turn off once used, hand it there too.
  const slotButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const putRef = useRef<HTMLButtonElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    slotButtons.current[focus]?.focus();
  }, []);
  return (
    <LinePanel aria-label={t('Edit {{name}}', {name: slot.name})}>
      <SlotRow role="group" aria-label={t('Tap Dance actions')}>
        <TextAction type="button" onClick={onBack}>
          ← {categoryLabel}
        </TextAction>
        {TAP_DANCE_ACTION_ROLES.map((role, index) => {
          const focused = index === focus;
          const legend = legendOf(draft.actions[role]);
          return (
            <PickerSlotButton
              key={role}
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
              <PickerSlotLabel $focused={focused}>
                {t(ROLE_LABEL[role])}
              </PickerSlotLabel>
              {dirty.has(role) ? <SlotDirtyDot aria-hidden="true" /> : null}
            </PickerSlotButton>
          );
        })}
        {slot.term ? (
          <TermLabel>
            <TermName>
              {t('Term')}
              {dirty.has('term') ? (
                <TermDirtyDot aria-hidden="true" />
              ) : null}
            </TermName>
            <IntegerInput
              draft={draft.term}
              savedValue={Number(view.saved.term)}
              min={termBounds.minMs}
              max={termBounds.maxMs}
              onDraftChange={(term) => onTerm(term.trim())}
              onEnter={view.canApply ? onApply : undefined}
              ariaLabel={t('Term')}
              suffix="ms"
              rangeBelow
            />
          </TermLabel>
        ) : null}
        {/* Putting the Tap Dance on the selected key sits with the other buttons,
            set apart from Cancel and Apply, which only concern its settings. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginLeft: 'auto',
          }}
        >
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
          <TabDivider aria-hidden="true" />
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
            {view.applying ? t('Applying…') : t('Apply')}
          </PrimaryAccentButton>
        </div>
      </SlotRow>
      {view.error ? <ErrorLine role="alert">{view.error}</ErrorLine> : null}
    </LinePanel>
  );
};
