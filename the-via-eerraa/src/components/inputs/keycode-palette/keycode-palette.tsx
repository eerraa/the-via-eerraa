import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {useAppSelector} from 'src/store/hooks';
import {
  getDisableFastRemap,
  getHostKeyboardLayout,
} from 'src/store/settingsSlice';
import type {IKeycode, IKeycodeMenu} from 'src/utils/key';
import {keymapExtras} from 'src/utils/keymap-extras';
import {
  formatKeycodeHex,
  formatKeycodeLabel,
  parseKeycodeInput,
  selectKeycodeFromMenuCode,
} from 'src/utils/keycode-picker';
import {
  KEYCODE_DISABLED_MESSAGES,
  type KeycodeDisabledReason,
} from 'src/utils/keycode-eligibility';
import {
  BASIC_LAYOUT,
  buildCategorySections,
  buildKeycodeIndex,
  describeKeycodeValue,
  keycodeTitleText,
  isValidTermDraft,
  looksLikeKeycode,
  menuForLayerCount,
  pendingTapDanceChanges,
  planTapDanceWrites,
  searchPalette,
  TAP_DANCE_ACTION_ROLES,
  tapDanceVisibleRoles,
  editTapDanceBehavior,
  withTapDanceChanges,
  type PaletteItem,
  type PaletteKey,
  type TapDanceField,
  type TapDanceSlot,
} from 'src/utils/keycode-palette';
import {PrimaryAccentButton} from '../accent-button';
import {DirtyDot} from '../dirty-dot';
import {
  KEY_GAP,
  Keycap,
  keyWidth,
  useKeycapColors,
} from './palette-keycap';
import {
  Announcement,
  Code,
  Hint,
  Panel,
  SearchField,
  Section,
  SectionLabel,
  Spacer,
  Tab,
  TabRow,
  TextAction,
  accent,
  accentText,
  hairline,
  muted,
  strong,
  surface,
} from './palette-parts';
import {HoldChoices, TappingFooter, readHeldKey} from './hold-control';
import {TapKeyPicker} from './tap-key-picker';
import {ConfigureStatusMessage} from '../../panes/configure-panes/status-message';
import {
  ROLE_LABEL,
  TapDanceEditor,
  TapDanceList,
  type Legend,
  type TapDanceEditorView,
  type TapDanceSlotState,
} from './tap-dance-panels';
import type {TapDanceBinding} from './use-tap-dance';

const TAP_DANCE_CATEGORY = 'tapdance';
const MACRO_CATEGORY = 'macro';
/** KEYMAP's LT·MT tab, before Tap Dance: not a menu of keys but a key's hold. */
export const LTMT_CATEGORY = 'ltmt';

const Root = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  color: ${strong};
`;

// The tabs and search sit together in the middle of the header, on the axis the
// keyboard above and the keys below are centred on; its ends stay empty, as the
// keyboard's sides do. A window too narrow for them on one line takes search to
// a second line, still centred, and tabs that still wrap stay centred too.
const Header = styled.header`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  column-gap: 28px;
  min-height: 64px;
  padding: 0 26px;
  box-sizing: border-box;
  border-bottom: 1px solid ${hairline};
`;

const HeaderTabs = styled(TabRow)`
  justify-content: center;
`;

const SearchSlot = styled.div`
  display: flex;
  align-items: center;
  min-height: 64px;
`;

const Main = styled.main`
  flex-grow: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  box-sizing: border-box;
  padding: 20px 26px 44px;
`;

// Every tab sits in one centred column as wide as Basic's widest row, as the
// feature panes centre theirs: the keys keep their keyboard order inside it, and
// switching tabs never moves the left edge.
const COLUMN_WIDTH = Math.max(
  ...BASIC_LAYOUT.flatMap(({rows}) => rows).map(
    (row) =>
      row.reduce<number>(
        (width, token) =>
          width + keyWidth(typeof token === 'string' ? 1 : token.gap),
        0,
      ) +
      KEY_GAP * (row.length - 1),
  ),
);

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  max-width: ${COLUMN_WIDTH}px;
  margin: 0 auto;
`;

const KeyRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

// The way from the Macro tab to the Macros menu, under its keys: one quiet word
// button, as the LT·MT tab's "TAPPING settings" reads.
const LinkLine = styled.div`
  display: flex;
  margin-top: -8px;

  > ${TextAction} {
    padding-left: 0;
    font-size: 15px;
  }
`;

// The key under the pointer, or the selected key's keycode, in the palette's
// bottom-right corner, however long the list: a short tab does not lift it up the
// screen. With no key selected it says to select one, since a pick then does
// nothing. It sits over the grid rather than in a band of its own, since on a Full
// HD screen every row counts; Main's 44px end padding keeps the last row clear of
// it. What was just put where is not repeated here, since the keyboard shows it;
// it is announced to screen readers through a hidden status line.
const Info = styled.div`
  position: absolute;
  right: 26px;
  bottom: 10px;
  z-index: 2;
  display: flex;
  align-items: baseline;
  gap: 12px;
  max-width: calc(100% - 52px);
  padding: 2px 6px;
  box-sizing: border-box;
  border-radius: 3px;
  background: ${surface};
  font-size: 15px;
  overflow: hidden;
  pointer-events: none;
`;

type PaletteTarget = {
  /** What a pick's announcement calls the target: "Selected key", a setting's label. */
  name: string;
  /** Its keycode now; null when there is nothing to show. */
  value: number | null;
};

// Which slot is open and where the next key goes. What was set on the slot is not
// kept here but with the keyboard, so it outlives the editor.
type EditorState = {
  index: number;
  focus: number;
  applying: boolean;
  error: string | null;
  returnCategory: string;
  /** The control that opened it, which takes focus back when it closes. */
  opener: string;
};

type Hover = {keycode: IKeycode} | {value: number};

/** Keycode names in the OS layout picked in the layout badge, as the keyboard has them. */
export const useHostLayoutNames = () => {
  const layout = useAppSelector(getHostKeyboardLayout);
  return keymapExtras[layout]?.keycodeLUT;
};

/** How the keyboard tells a tap from a hold, as KEYMAP shows it under the hold. */
export type TappingSummary = {
  /** The tapping term as its menu shows it: "200 ms". */
  term: string;
  /** The options that are on, by the names their menu gives them. */
  options: string[];
  /** The name of the sub-tab that holds them. */
  menu: string;
  /** Opens that sub-tab, keeping the selected key to come back to. */
  open: () => void;
};

type KeycodePaletteProps = {
  menus: IKeycodeMenu[];
  basicKeyToByte: Record<string, number>;
  byteToKey: Record<number, string>;
  /** Null when nothing is selected yet; picks then only explain that. */
  target: PaletteTarget | null;
  /** `stay` keeps the target where it is instead of moving on (fast remap). */
  onAssign: (value: number, options?: {stay?: boolean}) => void;
  layerCount: number;
  /** KEYMAP only: Tap Dance slots edited in place. */
  tapDance?: TapDanceBinding | null;
  /** KEYMAP only: the TAPPING line under the LT·MT choices. */
  tapping?: TappingSummary | null;
  /** KEYMAP only: the category to open on, as the ways back from Macros and TAPPING have it. */
  initialCategory?: string;
  /** KEYMAP only: the key that takes focus first, by its menu code. */
  initialFocusCode?: string;
  /** KEYMAP only: the way from the Macro tab to the Macros menu. */
  macroLink?: {open: () => void} | null;
  /** KEYMAP only: the keycode of the keyboard key under the pointer, for the corner. */
  keyboardHover?: number | null;
  /**
   * A keycode setting's: its keys in a window over the page, as a Tap Dance
   * action's are, titled with the setting. A pick sets the value.
   */
  popup?: {
    title: string;
    onClose: () => void;
    returnFocus: RefObject<HTMLElement>;
  } | null;
};

/**
 * The one keycode chooser. KEYMAP shows it in the pane under the keyboard, with
 * search that also takes a QMK code or hex; a keycode setting (a V3 `keycode`
 * control, an encoder) shows its keys in a window over the page, as a Tap Dance
 * action does. All of them have the same categories and the LT·MT tab that makes
 * a key an LT·MT key. Tap Dance editing is KEYMAP only.
 */
export const KeycodePalette = ({
  menus,
  basicKeyToByte,
  byteToKey,
  target,
  onAssign,
  layerCount,
  tapDance = null,
  tapping = null,
  initialCategory,
  initialFocusCode,
  macroLink = null,
  keyboardHover = null,
  popup = null,
}: KeycodePaletteProps) => {
  const {t} = useTranslation();
  const colors = useKeycapColors();
  const layout = useHostLayoutNames();
  const [category, setCategory] = useState(
    initialCategory ?? menus[0]?.id ?? 'basic',
  );
  // The key the way back from Macros points at takes focus once, as it first shows.
  const [focusCode, setFocusCode] = useState(initialFocusCode);
  useEffect(() => setFocusCode(undefined), []);

  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  // A Tap Dance is edited in one window with its keys; focus goes back to the
  // control it was opened from.
  const editorReturn = useRef<HTMLElement | null>(null);
  // A key put in a Tap Dance action moves on to the next action, as a key put on
  // the keyboard moves on to the next key, unless fast remap is off.
  const disableFastRemap = useAppSelector(getDisableFastRemap);
  const [recent, setRecent] = useState<{index: number; tag: string} | null>(
    null,
  );
  const [hover, setHover] = useState<Hover | null>(null);
  const [flash, setFlashText] = useState('');
  const flashValue = useRef('');
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  // Repeated assignments need a separate empty render for a live region to speak.
  const setFlash = (text: string) => {
    clearTimeout(flashTimer.current);
    if (text && flashValue.current === text) {
      setFlashText('');
      flashTimer.current = setTimeout(() => setFlashText(text), 0);
    } else {
      setFlashText(text);
    }
    flashValue.current = text;
  };
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // The editor takes keyboard focus when it opens. Once it has closed, focus goes
  // back to the control that opened it or, when that is gone, to the list row or
  // the tab it returned to. It moves only if it fell to the page with the closed
  // controls; focus the user has put elsewhere stays.
  const focusTargets = useRef(new Map<string, HTMLElement>());
  const focusTarget = (key: string) => (element: HTMLElement | null) => {
    if (element) {
      focusTargets.current.set(key, element);
    } else {
      focusTargets.current.delete(key);
    }
  };
  const refocus = useRef<{keys: string[]}>();
  useEffect(() => {
    const request = refocus.current;
    if (!request || editor) {
      return;
    }
    refocus.current = undefined;
    if (
      typeof document === 'undefined' ||
      (document.activeElement && document.activeElement !== document.body)
    ) {
      return;
    }
    request.keys
      .map((key) => focusTargets.current.get(key))
      .find((element) => element && !(element as HTMLButtonElement).disabled)
      ?.focus();
  });

  const index = useMemo(
    () => buildKeycodeIndex(menus, basicKeyToByte),
    [menus, basicKeyToByte],
  );
  const menuLabel = (id: string) =>
    t(menus.find((menu) => menu.id === id)?.label ?? id);

  // The same fitted 1u legend the key has in the palette.
  const legendOf = useCallback(
    (value: number): Legend =>
      describeKeycodeValue(value, index, basicKeyToByte, byteToKey, layout),
    [index, basicKeyToByte, byteToKey, layout],
  );

  // ---------------------------------------------------------- Tap Dance
  // A slot as the list and the editor show it: what the keyboard holds, with the
  // changes not applied yet in place.
  const slotState = (item: TapDanceSlot): TapDanceSlotState | null => {
    const current = tapDance?.read(item);
    if (!tapDance || !current) {
      return null;
    }
    const changes = pendingTapDanceChanges(tapDance.changes(item), current);
    const draft = withTapDanceChanges(current, changes);
    const {minMs, maxMs} = tapDance.termBounds(item);
    return {
      draft,
      dirty: new Set(
        Object.keys(changes).filter((field) => field !== 'retry') as TapDanceField[],
      ),
      saved: current,
      // A term left as the keyboard reports it holds nothing up, as in a menu.
      termValid:
        !item.term ||
        draft.term === current.term ||
        isValidTermDraft(draft.term, minMs, maxMs),
    };
  };
  const tapDancePending =
    !!tapDance &&
    tapDance.slots.some((item) => (slotState(item)?.dirty.size ?? 0) > 0);

  const slot =
    editor && tapDance
      ? (tapDance.slots.find((item) => item.index === editor.index) ?? null)
      : null;
  const slotCurrent = slot && tapDance ? tapDance.read(slot) : null;
  const editing = !!(editor && slot && slotCurrent);
  // Ordinary remapping keeps VIA's available-layer list. Editors show the whole
  // enabled catalogue and explain unsupported values on each disabled key.
  const offered = useMemo(
    () =>
      editing
        ? menus
        : menus.map((menu) => menuForLayerCount(menu, layerCount)),
    [menus, layerCount, editing],
  );

  useEffect(() => {
    // The keyboard went away or stopped reporting: nothing left to edit.
    if (editor && !(slot && slotCurrent)) {
      setEditor(null);
    }
  }, [editor, slot, slotCurrent]);

  const slotShown = editing && slot ? slotState(slot) : null;
  const draft = slotShown?.draft ?? null;
  const termBounds =
    slot && tapDance ? tapDance.termBounds(slot) : {minMs: 1, maxMs: 65535};
  const termValid = slotShown?.termValid ?? true;
  const visibleRoles = draft ? tapDanceVisibleRoles(draft) : [...TAP_DANCE_ACTION_ROLES];
  const selectedFocus = editor?.focus ?? 0;
  const editorFocus = visibleRoles.includes(TAP_DANCE_ACTION_ROLES[selectedFocus]) ? selectedFocus : 0;
  const focusRole = TAP_DANCE_ACTION_ROLES[editorFocus];
  const focusRoleLabel = draft?.mode !== undefined && focusRole === 'tap' ? t('Base key') : t(ROLE_LABEL[focusRole]);
  const slotValue = (item: TapDanceSlot) =>
    selectKeycodeFromMenuCode(item.code, basicKeyToByte);

  const currentValue = draft
    ? draft.actions[focusRole]
    : (target?.value ?? null);
  const pickerDisabledReason = (
    value: number | null,
  ): KeycodeDisabledReason | null =>
    value === null
      ? 'invalid-keycode'
      : editing
        ? (tapDance?.getDisabledReason?.(value) ?? null)
        : null;
  const reasonLabel = (reason: KeycodeDisabledReason | null) =>
    reason ? t(KEYCODE_DISABLED_MESSAGES[reason]) : '';
  // Only changed actions are checked. A stored value we cannot name stays intact.
  const draftDisabledReason = slotShown
    ? TAP_DANCE_ACTION_ROLES.reduce<KeycodeDisabledReason | null>(
        (reason, role) =>
          reason ||
          (slotShown.dirty.has(role) && !(slotShown.draft.mode && role !== 'tap' && slotShown.draft.actions[role] === 1)
            ? (tapDance?.getDisabledReason?.(slotShown.draft.actions[role]) ?? null)
            : null),
        null,
      )
    : null;

  const exitEditor = (tag: string) => {
    if (!editor) {
      return;
    }
    refocus.current = {
      keys: [
        editor.opener,
        `td:${editor.index}`,
        `tab:${editor.returnCategory}`,
      ],
    };
    setRecent({index: editor.index, tag});
    setCategory(editor.returnCategory);
    setEditor(null);
    setQuery('');
    setFlash(tag && slot ? `${slot.name} · ${tag}` : '');
  };

  const openEditor = (item: TapDanceSlot, from: string, opener: string) => {
    if (!tapDance?.read(item)) {
      return;
    }
    editorReturn.current = focusTargets.current.get(opener) ?? null;
    setEditor({
      index: item.index,
      focus: 0,
      applying: false,
      error: null,
      returnCategory: from,
      opener,
    });
    setQuery('');
    setRecent(null);
    setFlash('');
  };

  // Cancel drops what was set on the slot; leaving any other way keeps it.
  const cancelEditor = () => {
    if (slot && tapDance) {
      tapDance.setChanges(slot, {});
    }
    exitEditor('');
  };

  const applyEditor = async () => {
    if (!editor || !slot || !draft || !slotCurrent || !tapDance) {
      return;
    }
    const writes = planTapDanceWrites(
      slot,
      draft,
      slotCurrent,
      termBounds,
      tapDance.getDisabledReason,
      tapDance.changes(slot).retry,
    );
    if (!writes || !tapDance.canWrite || editor.applying) {
      return;
    }
    setEditor({...editor, applying: true, error: null});
    const accepted = await tapDance.write(slot, writes);
    if (!mounted.current) {
      return;
    }
    if (accepted) {
      exitEditor(t('Saved'));
      return;
    }
    setEditor(
      (current) =>
        current && {
          ...current,
          applying: false,
          error: t(
            'Could not complete this change. Settings after it were not sent.',
          ),
        },
    );
  };

  // ------------------------------------------------------------- picking
  const destinationLabel =
    editing && slot
      ? `${slot.name} · ${focusRoleLabel}`
      : target?.name;

  // A key put where a hold is keeps the hold: the new key is what a tap sends, and
  // the hold stays bit for bit, a right-hand modifier included. Blank and
  // transparent clear the key, hold and all. A key a tap cannot send takes the
  // hold's place, and the line says so.
  const keepHold = (
    current: number | null,
    value: number,
    name: string,
  ): {value: number; name: string} => {
    const held = readHeldKey(current, index, basicKeyToByte);
    if (
      current === null ||
      value <= 1 ||
      !held ||
      (held.kind !== 'LT' && held.kind !== 'MT')
    ) {
      return {value, name};
    }
    const next = readHeldKey(value, index, basicKeyToByte);
    if (next && next.kind === null) {
      return {
        value: (current & 0xff00) | (value & 0xff),
        name: `${name} · ${t('Hold kept')}`,
      };
    }
    return next ? {value, name} : {value, name: `${name} · ${t('Hold removed')}`};
  };

  // `stay` keeps the selected key, or the Tap Dance action being filled, where it
  // is; `whole` puts the value as it is, hold and all: Clear, and the hold's own
  // choices. Says whether the value went anywhere: with no key selected outside
  // the editor it does not, and whatever was typed for it is kept.
  const put = (
    input: number,
    label: string,
    options?: {stay?: boolean; whole?: boolean},
  ) => {
    const {value, name} = options?.whole
      ? {value: input, name: label}
      : keepHold(currentValue, input, label);
    if (editing && editor && slot && tapDance) {
      if (tapDance.getDisabledReason?.(value)) {
        return false;
      }
      const changes = {...tapDance.changes(slot)};
      Object.assign(changes, draft ? editTapDanceBehavior(draft, {[focusRole]: value & 0xffff}) : {[focusRole]: value & 0xffff});
      tapDance.setChanges(slot, changes);
      const nextRole = visibleRoles[visibleRoles.indexOf(focusRole) + 1];
      const focus =
        options?.stay || disableFastRemap || !nextRole
          ? editorFocus
          : TAP_DANCE_ACTION_ROLES.indexOf(nextRole);
      setEditor({...editor, focus, error: null});
      setFlash(`${destinationLabel} ← ${name}`);
      return true;
    }
    if (!target) {
      setFlash(t('Select a key on the keyboard first'));
      return false;
    }
    onAssign(value & 0xffff, {stay: options?.stay});
    setFlash(`${target.name} ← ${name}`);
    return true;
  };
  // Every button that puts something in waits for a key to put it on.
  const canPut = editing || !!target;

  const pickValue = (value: number | null, keycode?: IKeycode) => {
    if (value === null || pickerDisabledReason(value)) {
      return false;
    }
    return put(
      value,
      keycode
        ? keycode.name.replace(/\n/g, ' ') || keycode.code
        : formatKeycodeLabel(value, basicKeyToByte, byteToKey),
    );
  };
  const pickKey = (keycode: IKeycode) =>
    pickValue(selectKeycodeFromMenuCode(keycode.code, basicKeyToByte), keycode);

  // The hold of the selected key, or of the Tap Dance action being filled: the key
  // a tap sends and what holding it does. Off, with the reason, where none can go.
  const held = readHeldKey(currentValue, index, basicKeyToByte);
  const holdReason =
    !editing && !target
      ? t('Select a key on the keyboard first')
      : currentValue === null || currentValue <= 1
        ? t('Choose a tap key first')
        : held
          ? ''
          : editing
            ? t('Modifiers go with basic keycodes only.')
            : t(KEYCODE_DISABLED_MESSAGES['requires-basic-keycode']);
  const putHold = (value: number) =>
    put(value, formatKeycodeLabel(value, basicKeyToByte, byteToKey), {
      stay: true,
      whole: true,
    });

  // While a Tap Dance is edited, its window holds the keys and the palette's tabs
  // are out of reach.
  const selectCategory = (id: string) => {
    setCategory(id);
    setQuery('');
  };

  const editingIndex = editing && editor ? editor.index : null;

  // The corner describes the key under the pointer only while it is there: another
  // selected key or value, or other keys on screen, bring the selected key back. A
  // key window opening or closing takes its keys away from under the pointer too.
  const trimmedQuery = query.trim();
  useEffect(() => {
    setHover(null);
  }, [
    target?.name,
    currentValue,
    category,
    trimmedQuery,
    editingIndex,
  ]);

  // ------------------------------------------------------------ rendering
  // `afterPick` follows a pick that took, as the tap key window closes on one.
  const renderKey = (key: PaletteKey, afterPick?: () => void) => {
    const {keycode} = key;
    const value = selectKeycodeFromMenuCode(keycode.code, basicKeyToByte);
    const disabledReason = pickerDisabledReason(value);
    const disabled = value === null || !!disabledReason;
    const isCurrent = value !== null && value === currentValue;
    const title = keycode.title ? keycodeTitleText(keycode.title, t) : undefined;
    const name = title || keycode.name.replace(/\n/g, ' ');
    return (
      <Keycap
        key={keycode.code}
        legend={key.legend}
        width={keyWidth(1)}
        colors={colors[key.role]}
        current={isCurrent}
        disabled={disabled}
        autoFocus={keycode.code === focusCode}
        ariaLabel={editing ? `${focusRoleLabel}: ${name}` : name || keycode.code}
        title={disabledReason ? reasonLabel(disabledReason) : undefined}
        onPick={() => {
          if (pickKey(keycode)) {
            afterPick?.();
          }
        }}
        onHover={() => setHover({keycode})}
      />
    );
  };

  const renderRow = (
    row: PaletteItem[],
    rowIndex: number,
    afterPick?: () => void,
  ) => (
    <KeyRow key={rowIndex}>
      {row.map((item, itemIndex) =>
        item.kind === 'gap' ? (
          <span
            key={`gap-${itemIndex}`}
            aria-hidden="true"
            style={{width: keyWidth(item.units), flexShrink: 0}}
          />
        ) : (
          renderKey(item, afterPick)
        ),
      )}
    </KeyRow>
  );

  const shownMenu =
    offered.find((menu) => menu.id === category) ?? offered[0] ?? null;
  const hits = trimmedQuery
    ? searchPalette(offered, trimmedQuery, layout)
    : [];
  // A search that reads as a keycode ("LT(1,KC_SPC)", "0x412C") can be put in as
  // typed. It is offered first, unless a key found by the search already is it.
  const typedValue =
    trimmedQuery && looksLikeKeycode(trimmedQuery)
      ? parseKeycodeInput(trimmedQuery, basicKeyToByte)
      : null;
  const typedCode =
    typedValue !== null &&
    !hits.some(({keys}) =>
      keys.some(
        (key) =>
          selectKeycodeFromMenuCode(key.keycode.code, basicKeyToByte) ===
          typedValue,
      ),
    )
      ? typedValue
      : null;
  const typedDisabledReason = pickerDisabledReason(typedCode);
  const putTyped = (value: number | null) => {
    if (pickValue(value)) {
      setQuery('');
    }
  };

  // Asked for by name, LT·MT comes first in the results: the way to its tab.
  const squash = (text: string) => text.toLowerCase().replace(/[\s-]+/g, '');
  const ltmtAsked = [
    'lt',
    'mt',
    'lt·mt',
    'layertap',
    'modtap',
    'hold',
    t('Layer-Tap'),
    t('Mod-Tap'),
    t('Hold'),
  ]
    .map(squash)
    .includes(squash(trimmedQuery));

  // How the keyboard tells a tap from a hold, at the foot of the LT·MT choices,
  // with the way to the menu that changes it.
  const tappingFooter = tapping ? (
    <TappingFooter>
      <span>{t('Tap-hold decision')}</span>
      <strong>{[`Term ${tapping.term}`, ...tapping.options].join(' · ')}</strong>
      <TextAction type="button" onClick={() => tapping.open()}>
        {t('{{menu}} settings', {menu: tapping.menu})}
      </TextAction>
    </TappingFooter>
  ) : null;
  // The LT·MT tab: what holding the selected key does, and the modifiers sent with
  // it. A Tap Dance action takes the modifiers alone, in a tab named for them: the
  // dance itself tells a tap from a hold.
  const ltmtChoices = (
    <HoldChoices
      held={held}
      reason={holdReason}
      layerCount={layerCount}
      holds={!editing}
      blocked={
        editing
          ? (value) =>
              reasonLabel(tapDance?.getDisabledReason?.(value) ?? null)
          : undefined
      }
      basicKeyToByte={basicKeyToByte}
      onChange={putHold}
      footer={tappingFooter}
    />
  );

  let grid: ReactNode;
  if (trimmedQuery) {
    const typedLabel =
      typedCode === null
        ? ''
        : formatKeycodeLabel(typedCode, basicKeyToByte, byteToKey);
    const typedName = typedCode === null ? '' : legendOf(typedCode).name;
    grid = (
      <>
        {ltmtAsked ? (
          <Section>
            <SectionLabel>{t('LT·MT')}</SectionLabel>
            <Panel
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                padding: '10px 14px',
              }}
            >
              <span style={{fontSize: 17}}>
                {t(
                  'A Layer-Tap (LT) or Mod-Tap (MT) is a hold put on the selected key.',
                )}
              </span>
              <Spacer />
              <PrimaryAccentButton
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory(LTMT_CATEGORY);
                }}
              >
                {t('Open LT·MT')}
              </PrimaryAccentButton>
            </Panel>
          </Section>
        ) : null}
        {typedCode !== null ? (
          <Panel
            aria-label={t('QMK code or hex')}
            style={{flexDirection: 'row', alignItems: 'center', gap: 14}}
          >
            <div style={{display: 'flex', flexDirection: 'column', gap: 3}}>
              <Code style={{fontSize: 17, color: strong}}>{typedLabel}</Code>
              <Code style={{color: muted}}>
                {typedName && typedName !== typedLabel
                  ? `${typedName} · ${formatKeycodeHex(typedCode)}`
                  : formatKeycodeHex(typedCode)}
              </Code>
            </div>
            {typedDisabledReason ? (
              <Hint>{reasonLabel(typedDisabledReason)}</Hint>
            ) : null}
            <Spacer />
            <PrimaryAccentButton
              type="button"
              disabled={!!typedDisabledReason || !canPut}
              aria-disabled={!!typedDisabledReason || !canPut || undefined}
              title={
                typedDisabledReason
                  ? reasonLabel(typedDisabledReason)
                  : !canPut
                    ? t('Select a key on the keyboard first')
                    : undefined
              }
              onClick={() => putTyped(typedCode)}
            >
              {t('Put in')}
            </PrimaryAccentButton>
          </Panel>
        ) : null}
        {hits.length === 0 && typedCode === null && !ltmtAsked ? (
          <Hint style={{padding: '24px 0'}}>{t('No matches')}</Hint>
        ) : (
          hits.map(({menu, keys}) => (
            <Section key={menu.id}>
              <SectionLabel>
                {t(menu.label).toUpperCase()} · {keys.length}
              </SectionLabel>
              {renderRow(keys, 0)}
            </Section>
          ))
        )}
      </>
    );
  } else if (category === LTMT_CATEGORY) {
    grid = ltmtChoices;
  } else if (!shownMenu) {
    grid = null;
  } else if (
    shownMenu.id === TAP_DANCE_CATEGORY &&
    tapDance &&
    !tapDance.unverified &&
    !tapDance.failed
  ) {
    grid = (
      <TapDanceList
        slots={tapDance.slots}
        stateOf={slotState}
        slotValue={slotValue}
        targetValue={target?.value ?? null}
        colors={colors.alpha}
        legendOf={legendOf}
        recent={recent}
        onAssign={(item) => {
          const value = slotValue(item);
          if (value !== null) {
            put(value, item.name);
          }
        }}
        editRef={(item) => focusTarget(`td:${item.index}`)}
        onEdit={(item) =>
          openEditor(item, TAP_DANCE_CATEGORY, `td:${item.index}`)
        }
        onHover={(item) => {
          const value = slotValue(item);
          if (value !== null) {
            setHover({value});
          }
        }}
      />
    );
  } else {
    grid = buildCategorySections(shownMenu, layout).map((section) => (
      <Section key={section.id}>
        {section.label ? (
          <SectionLabel>{t(section.label)}</SectionLabel>
        ) : null}
        {section.rows.map((row, rowIndex) =>
          renderRow(row, rowIndex),
        )}
      </Section>
    ));
  }
  // An unverified keyboard's TD keys stay on offer as plain keys, as do those of a
  // keyboard that refused its settings. In place of the settings it cannot read,
  // the words its feature tabs use for that state, once.
  const tapDanceNote =
    trimmedQuery || shownMenu?.id !== TAP_DANCE_CATEGORY
      ? null
      : tapDance?.unverified
        ? t(
            'Unable to verify feature support. Reconnect the keyboard. If the problem persists, update to the latest firmware.',
          )
        : tapDance?.failed
          ? t(
              'Unable to load feature settings. Reconnect the keyboard and try again.',
            )
          : null;

  // Every enabled category stays available. Eligibility belongs to each key. A Tap
  // Dance being edited belongs to its tab, and choosing a category closes the
  // editor as well. LT·MT is a tab of its own, before Tap Dance: the other way a
  // key does one thing tapped and another held.
  const tabs = menus.map((menu) => ({id: menu.id, label: t(menu.label)}));
  const tapDanceAt = tabs.findIndex((tab) => tab.id === TAP_DANCE_CATEGORY);
  tabs.splice(tapDanceAt < 0 ? tabs.length : tapDanceAt, 0, {
    id: LTMT_CATEGORY,
    label: t('LT·MT'),
  });
  const categoryTabs = (
    <HeaderTabs $height={64} role="group" aria-label={t('Keycode categories')}>
      {tabs.map((tab) => {
        const selected =
          tab.id === (editing ? TAP_DANCE_CATEGORY : category) &&
          !trimmedQuery;
        return (
          <Tab
            key={tab.id}
            ref={focusTarget(`tab:${tab.id}`)}
            type="button"
            $selected={selected}
            aria-pressed={selected}
            onClick={() => selectCategory(tab.id)}
          >
            {tab.label}
            {tab.id === TAP_DANCE_CATEGORY && tapDancePending ? (
              <DirtyDot aria-hidden="true" />
            ) : null}
          </Tab>
        );
      })}
    </HeaderTabs>
  );

  const search = (
    <SearchField
      aria-label={t('Search keycodes')}
      placeholder={t('Search or enter a keycode')}
      title={t(
        'You can also type a QMK code such as LT(1,KC_SPC) or a hex value such as 0x412C.',
      )}
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => {
        // Enter puts in whatever reads as a keycode, even a code the results also
        // show; only the Put in row keeps to codes they do not have.
        if (event.key === 'Enter' && canPut) {
          putTyped(typedValue);
        }
      }}
    />
  );

  // A key under the pointer is described as it is, even one this keyboard cannot
  // take; a value is described as the palette names it, and so is the keyboard
  // key under the pointer.
  const hovered = hover && 'keycode' in hover ? hover.keycode : null;
  const infoValue = hovered
    ? selectKeycodeFromMenuCode(hovered.code, basicKeyToByte)
    : hover && 'value' in hover
      ? hover.value
      : (keyboardHover ?? currentValue);

  // The footer line: an unknown value is shown once, not as name, code and hex.
  const info = hovered
    ? {
        name: hovered.name.replace(/\n/g, ' ') || hovered.code,
        code: hovered.code,
        hex: infoValue === null ? '' : formatKeycodeHex(infoValue),
        title: hovered.title ?? '',
      }
    : infoValue === null
      ? null
      : {
          ...describeKeycodeValue(
            infoValue,
            index,
            basicKeyToByte,
            byteToKey,
            layout,
          ),
          hex: formatKeycodeHex(infoValue),
        };

  const view: TapDanceEditorView | null =
    editing && editor && slot && slotShown
      ? {
          ...slotShown,
          slot,
          focus: editorFocus,
          termBounds,
          canApply:
            slotShown.dirty.size > 0 &&
            termValid &&
            planTapDanceWrites(
              slot,
              slotShown.draft,
              slotShown.saved,
              termBounds,
              tapDance?.getDisabledReason,
              tapDance?.changes(slot).retry,
            ) !== null &&
            !draftDisabledReason &&
            !!tapDance?.canWrite &&
            !editor.applying,
          applyBlockedReason: !tapDance?.canWrite
            ? t('Tap Dance settings cannot be written right now.')
            : reasonLabel(draftDisabledReason),
          applying: editor.applying,
          error: editor.error,
        }
      : null;

  // A keycode setting's keys come in a window of their own, as a Tap Dance
  // action's do; a pick there sets the value.
  if (popup) {
    return (
      <TapKeyPicker
        menus={offered}
        layout={layout}
        title={popup.title}
        searchLabel={t('Search keycodes')}
        isAllowed={() => true}
        renderRow={(row, rowIndex) => renderRow(row, rowIndex)}
        returnFocus={popup.returnFocus}
        onClose={popup.onClose}
        ltmt={{
          label: t('LT·MT'),
          content: ltmtChoices,
          before: TAP_DANCE_CATEGORY,
        }}
      />
    );
  }

  return (
    <Root>
      <Header>
        {categoryTabs}
        <SearchSlot>{search}</SearchSlot>
      </Header>

      <Main>
        {/* The pointer leaves the column, not each key, so the corner does not
            flicker back while it crosses the gaps between keys. */}
        <Column
          onMouseLeave={() => setHover(null)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setHover(null);
            }
          }}
        >
          {/* A Tap Dance is edited in one window over the keyboard and the palette,
              the editor over the keys it takes, with a Modifiers tab of its own
              for the action being filled. */}
          {view && editor ? (
            <TapKeyPicker
              wide
              menus={offered.filter((menu) => menu.id !== TAP_DANCE_CATEGORY)}
              layout={layout}
              title={t('Edit {{name}}', {name: view.slot.name})}
              searchLabel={t('Search keycodes')}
              isAllowed={() => true}
              renderRow={(row, rowIndex) => renderRow(row, rowIndex)}
              returnFocus={editorReturn}
              onClose={() => exitEditor('')}
              ltmt={{
                label: t('Modifiers'),
                content: ltmtChoices,
                before: TAP_DANCE_CATEGORY,
              }}
              head={
                <TapDanceEditor
                  view={view}
                  slotsOpenWindow={false}
                  followFocus={false}
                  categoryLabel={menuLabel(TAP_DANCE_CATEGORY)}
                  colors={colors.alpha}
                  legendOf={legendOf}
                  onPickSlot={(focus) =>
                    setEditor({...editor, focus, error: null})
                  }
                  onMode={(mode) => {
                    tapDance?.setChanges(view.slot, {...tapDance.changes(view.slot), ...editTapDanceBehavior(view.draft, {mode})});
                    setEditor({...editor, error: null});
                  }}
                  onAddAction={(role) => {
                    tapDance?.setChanges(view.slot, {...tapDance.changes(view.slot), ...editTapDanceBehavior(view.draft, {[role]: -1})});
                    setEditor({...editor, focus: TAP_DANCE_ACTION_ROLES.indexOf(role), error: null});
                  }}
                  onRemoveAction={(role) => {
                    tapDance?.setChanges(view.slot, {...tapDance.changes(view.slot), ...editTapDanceBehavior(view.draft, {[role]: 1})});
                    setEditor({...editor, focus: 0, error: null});
                  }}
                  onTiming={(changes) => {
                    tapDance?.setChanges(view.slot, {...tapDance.changes(view.slot), ...editTapDanceBehavior(view.draft, changes)});
                    setEditor({...editor, error: null});
                  }}
                  onTerm={(term) => {
                    tapDance?.setChanges(view.slot, {
                      ...tapDance.changes(view.slot),
                      term,
                    });
                    setEditor({...editor, error: null});
                  }}
                  onCancel={cancelEditor}
                  onApply={applyEditor}
                />
              }
            />
          ) : null}

          {grid}
          {macroLink &&
          !trimmedQuery &&
          !editing &&
          shownMenu?.id === MACRO_CATEGORY ? (
            <LinkLine>
              <TextAction type="button" onClick={macroLink.open}>
                {t('{{menu}} settings', {menu: t('Macros')})}
              </TextAction>
            </LinkLine>
          ) : null}
          {tapDanceNote ? (
            <ConfigureStatusMessage role="status" style={{alignSelf: 'center'}}>
              {tapDanceNote}
            </ConfigureStatusMessage>
          ) : null}
        </Column>
      </Main>
      {!editing &&
      (trimmedQuery || category !== TAP_DANCE_CATEGORY) &&
      info ? (
        <Info>
          {info.name !== info.code ? (
            <span style={{whiteSpace: 'nowrap'}}>{info.name}</span>
          ) : null}
          <Code style={{color: accentText, whiteSpace: 'nowrap'}}>
            {info.code}
          </Code>
          {info.hex !== info.code ? (
            <Code style={{color: muted}}>{info.hex}</Code>
          ) : null}
          <span
            style={{
              maxWidth: 360,
              color: muted,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {info.title && keycodeTitleText(info.title, t)}
          </span>
        </Info>
      ) : !editing && !target && !info && category !== LTMT_CATEGORY ? (
        <Info>
          <span style={{color: muted}}>
            {t('Select a key on the keyboard first')}
          </span>
        </Info>
      ) : null}

      <Announcement role="status" aria-live="polite">
        {flash}
      </Announcement>
    </Root>
  );
};
