import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {useAppSelector} from 'src/store/hooks';
import {getHostKeyboardLayout} from 'src/store/settingsSlice';
import type {IKeycode, IKeycodeMenu} from 'src/utils/key';
import {keymapExtras} from 'src/utils/keymap-extras';
import {
  clearKeycodeValue,
  formatKeycodeHex,
  formatKeycodeLabel,
  getComposeKeycodeDisabledReason,
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
  buildComposeResult,
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
  withTapDanceChanges,
  type PaletteItem,
  type PaletteKey,
  type TapDanceField,
  type TapDanceSlot,
} from 'src/utils/keycode-palette';
import {
  AccentButtonSmall,
  PrimaryAccentButton,
  handFocus,
} from '../accent-button';
import {DirtyDot} from '../dirty-dot';
import {
  KEY_GAP,
  Keycap,
  KeycapView,
  keyWidth,
  useKeycapColors,
} from './palette-keycap';
import {
  Announcement,
  Code,
  Hint,
  Panel,
  SearchField,
  SectionLabel,
  Spacer,
  Tab,
  TabDivider,
  TAB_FONT,
  TabRow,
  TextAction,
  accent,
  accentText,
  hairline,
  muted,
  strong,
  surface,
} from './palette-parts';
import {ComposePanel, type ComposeState} from './compose-panel';
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

// "+ Combined key" sits in the tab row, so it takes the tabs' size.
const TabAction = styled(TextAction)`
  ${TAB_FONT}
`;

const Root = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  color: ${strong};
`;

// The tabs sit in the middle of the header, over the centred column below; the
// selected key keeps the left end and search the right. Both ends grow from the
// same zero basis, so they stay equal and the tabs stay centred. When the three
// do not fit on one line (a window narrower than full screen on Full HD), the
// header takes two: the selected key and search share the first, and the tabs
// are centred on the second, rather than each taking a line of its own.
const HEADER_GAP = 22;

const Header = styled.header`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  column-gap: ${HEADER_GAP}px;
  min-height: 64px;
  /* Preserve Full HD spacing and keep the ends near the keys on wider windows. */
  padding: 0 max(26px, calc((100% - 1802px) / 2));
  box-sizing: border-box;
  border-bottom: 1px solid ${hairline};
`;

const HeaderEnd = styled.div<{$end?: boolean}>`
  flex: 1 1 0;
  min-width: max-content;
  display: flex;
  align-items: center;
  justify-content: ${(props) => (props.$end ? 'flex-end' : 'flex-start')};
`;

const HeaderMiddle = styled.div<{$compact: boolean}>`
  flex: none;
  max-width: 100%;
  margin: ${(props) => (props.$compact ? '0 auto' : '0')};

  /* Tabs that still wrap (longer labels, a narrower window) stay centred too. */
  > ${TabRow} {
    justify-content: ${(props) => (props.$compact ? 'center' : 'flex-start')};
  }
`;

const EndGroup = styled.div`
  display: flex;
  align-items: center;
  column-gap: ${HEADER_GAP}px;
`;

const TargetBlock = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 180px;
  min-height: 64px;
`;

const TargetText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;

  > span:first-child {
    font-size: 18px;
    color: ${strong};
    white-space: nowrap;
  }
  > span:last-child {
    font-size: 14px;
    color: ${muted};
    white-space: nowrap;
  }
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

// The editor and the builder stay above the keys they take from. The keys scroll
// under an opaque band, which also covers a key's hover lift. It sticks through
// Main's top padding, or keys would show above it.
const Pinned = styled.div`
  position: sticky;
  top: -20px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: -10px;
  padding-top: 10px;
  background: ${surface};
`;

const KeyRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

// The key under the pointer, or the selected key's keycode, described in the
// bottom-right corner over the grid rather than in a band of its own: on a Full HD
// screen every row counts. The grid's bottom padding keeps its last row clear of
// it. What was just put where is not repeated here, since the keyboard and the
// header show it; it is announced to screen readers through a hidden status line.
// The zero-height anchor uses Main's existing 44px end clearance. The text sits
// 34px below it, leaving 10px at the scrollport's bottom without adding a band.
const InfoAnchor = styled.div`
  position: sticky;
  bottom: 0;
  height: 0;
  width: 100%;
  max-width: ${COLUMN_WIDTH}px;
  margin: 0 auto;
  pointer-events: none;
`;

const Info = styled.div`
  position: absolute;
  right: 0;
  bottom: -34px;
  display: flex;
  align-items: baseline;
  gap: 12px;
  max-width: 100%;
  padding: 2px 6px;
  box-sizing: border-box;
  border-radius: 3px;
  background: ${surface};
  font-size: 15px;
  overflow: hidden;
  pointer-events: none;
`;

export type PaletteTarget = {
  /** What the header calls the target: "Selected key", a control label. */
  name: string;
  sub?: string;
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
  headerEnd?: ReactNode;
};

/**
 * The one keycode chooser. KEYMAP shows it in the pane under the keyboard and a
 * V3 `keycode` control shows it in a dock; both get the same categories, search
 * (which also takes a QMK code or hex) and combined keys. Tap Dance editing is
 * KEYMAP only.
 */
export const KeycodePalette = ({
  menus,
  basicKeyToByte,
  byteToKey,
  target,
  onAssign,
  layerCount,
  tapDance = null,
  headerEnd,
}: KeycodePaletteProps) => {
  const {t} = useTranslation();
  const colors = useKeycapColors();
  const layout = useHostLayoutNames();
  const [category, setCategory] = useState(menus[0]?.id ?? 'basic');

  // One header line while the selected key, the tabs and search fit side by side,
  // two otherwise. Their own widths do not depend on the choice, so the measure
  // cannot flip back and forth; it follows window, language and editing changes.
  const headerRef = useRef<HTMLElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const middleRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [compactHeader, setCompactHeader] = useState(false);
  const keptFocus = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const header = headerRef.current;
    const parts = [targetRef.current, middleRef.current, endRef.current];
    if (
      !header ||
      parts.some((part) => !part) ||
      typeof ResizeObserver === 'undefined'
    ) {
      return;
    }
    const fit = () => {
      const style = getComputedStyle(header);
      const room =
        header.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const needed =
        parts.reduce((sum, part) => sum + (part?.offsetWidth ?? 0), 0) +
        HEADER_GAP * (parts.length - 1);
      keptFocus.current = document.activeElement;
      setCompactHeader(room < needed);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(header);
    parts.forEach((part) => part && observer.observe(part));
    return () => observer.disconnect();
  }, []);
  // The header's parts follow their visual order in the DOM, so a line change
  // moves one of them, and a moved element drops focus.
  useLayoutEffect(() => {
    const element = keptFocus.current;
    keptFocus.current = null;
    if (
      element &&
      element instanceof HTMLElement &&
      element !== document.activeElement &&
      headerRef.current?.contains(element)
    ) {
      element.focus({preventScroll: true});
    }
  }, [compactHeader]);
  const [query, setQuery] = useState('');
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pickCategory, setPickCategory] = useState('basic');
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

  // The editor and the builder take keyboard focus when they open. Once one has
  // closed, focus goes back to the control that opened it or, when that is gone,
  // to the list row or the tab it returned to. It moves only if it fell to the
  // page with the closed controls; focus the user has put elsewhere stays.
  const focusTargets = useRef(new Map<string, HTMLElement>());
  const focusTarget = (key: string) => (element: HTMLElement | null) => {
    if (element) {
      focusTargets.current.set(key, element);
    } else {
      focusTargets.current.delete(key);
    }
  };
  const refocus = useRef<{after: 'editor' | 'builder'; keys: string[]}>();
  useEffect(() => {
    const request = refocus.current;
    if (!request || (request.after === 'editor' ? editor : compose)) {
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
      dirty: new Set(Object.keys(changes) as TapDanceField[]),
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
      compose || editing
        ? menus
        : menus.map((menu) => menuForLayerCount(menu, layerCount)),
    [menus, layerCount, compose, editing],
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
  const focusRole = editor
    ? TAP_DANCE_ACTION_ROLES[editor.focus]
    : TAP_DANCE_ACTION_ROLES[0];
  const slotValue = (item: TapDanceSlot) =>
    selectKeycodeFromMenuCode(item.code, basicKeyToByte);

  const currentValue = compose
    ? compose.tap
      ? parseKeycodeInput(compose.tap.code, basicKeyToByte)
      : null
    : draft
      ? draft.actions[focusRole]
      : (target?.value ?? null);
  const pickerDisabledReason = (
    value: number | null,
  ): KeycodeDisabledReason | null =>
    value === null
      ? 'invalid-keycode'
      : compose
        ? getComposeKeycodeDisabledReason(value, basicKeyToByte)
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
          (slotShown.dirty.has(role)
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
      after: 'editor',
      keys: [
        editor.opener,
        `td:${editor.index}`,
        `tab:${editor.returnCategory}`,
      ],
    };
    setRecent({index: editor.index, tag});
    setCategory(editor.returnCategory);
    setEditor(null);
    setCompose(null);
    setQuery('');
    setFlash(tag && slot ? `${slot.name} · ${tag}` : '');
  };

  const openEditor = (item: TapDanceSlot, from: string, opener: string) => {
    if (!tapDance?.read(item)) {
      return;
    }
    setEditor({
      index: item.index,
      focus: 0,
      applying: false,
      error: null,
      returnCategory: from,
      opener,
    });
    setCompose(null);
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
      exitEditor(t('Applied'));
      return;
    }
    setEditor(
      (current) =>
        current && {
          ...current,
          applying: false,
          error: t(
            'The keyboard did not accept a change. Settings after it were not sent.',
          ),
        },
    );
  };

  // ------------------------------------------------------------- picking
  const destinationLabel =
    editing && slot
      ? `${slot.name} · ${t(ROLE_LABEL[focusRole])}`
      : target?.name;
  const targetLabel = compose
    ? `${t('Combined key')} · ${t('On tap')}`
    : destinationLabel;

  // `stay` keeps the selected key, or the slot being filled, where it is. Says
  // whether the value went anywhere: with no key selected outside the editor it
  // does not, and whatever was built or typed for it is kept.
  const put = (value: number, name: string, options?: {stay?: boolean}) => {
    if (editing && editor && slot && tapDance) {
      if (tapDance.getDisabledReason?.(value)) {
        return false;
      }
      const changes = {...tapDance.changes(slot)};
      changes[focusRole] = value & 0xffff;
      tapDance.setChanges(slot, changes);
      setEditor({
        ...editor,
        focus: options?.stay
          ? editor.focus
          : (editor.focus + 1) % TAP_DANCE_ACTION_ROLES.length,
        error: null,
      });
      setFlash(`${destinationLabel} ← ${name}`);
      return true;
    }
    if (!target) {
      setFlash(t('Select a key on the keyboard first'));
      return false;
    }
    onAssign(value & 0xffff, options);
    setFlash(`${target.name} ← ${name}`);
    return true;
  };
  // Every button that puts something in waits for a key to put it on.
  const canPut = editing || !!target;

  // Picking an operand changes the builder draft; only its Put in assigns it.
  const pickValue = (value: number | null, keycode?: IKeycode) => {
    if (value === null || pickerDisabledReason(value)) {
      return false;
    }
    if (compose) {
      const tap = keycode ?? index.get(value) ?? {
        code: formatKeycodeLabel(value, basicKeyToByte, byteToKey),
        name: legendOf(value).name,
      };
      setCompose({...compose, tap});
      setHover({keycode: tap});
      return true;
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

  const startCompose = () => {
    const from = editing ? pickCategory : category;
    setCompose({
      kind: 'LT',
      tap: null,
      modifiers: [],
      layer: Math.min(1, Math.max(0, layerCount - 1)),
      from,
    });
    setQuery('');
  };

  const closeCompose = () => {
    if (!compose) {
      return;
    }
    refocus.current = {after: 'builder', keys: ['compose']};
    if (editing) {
      setPickCategory(compose.from);
    } else {
      setCategory(compose.from);
    }
    setCompose(null);
  };

  const composeResult = compose
    ? buildComposeResult(
        compose.kind,
        compose.tap,
        compose.layer,
        compose.modifiers,
        basicKeyToByte,
      )
    : null;

  // Which category the grid shows: the pick bar's while editing, else the tab's.
  const shownCategory = editing ? pickCategory : category;
  const selectCategory = (id: string) => {
    if (editing) {
      setPickCategory(id);
    } else {
      setCategory(id);
    }
    setQuery('');
  };

  // The editor and the builder open at the top of the scrolling body, above the
  // keys; opened with the keys scrolled down, they would open out of sight.
  const mainRef = useRef<HTMLElement>(null);
  const composing = !!compose;
  const editingIndex = editing && editor ? editor.index : null;
  useEffect(() => {
    if (composing && mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  }, [composing]);
  useEffect(() => {
    if (editingIndex !== null && mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  }, [editingIndex]);
  // A key reached by keyboard must not scroll in under the pinned line.
  const pinnedRef = useRef<HTMLDivElement>(null);
  const [pinnedHeight, setPinnedHeight] = useState(0);
  const pinned = composing || editingIndex !== null;
  useEffect(() => {
    const node = pinnedRef.current;
    if (!pinned || !node || typeof ResizeObserver === 'undefined') {
      setPinnedHeight(0);
      return;
    }
    const measure = () => setPinnedHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pinned]);

  // The corner describes the key under the pointer only while it is there: another
  // selected key or value, or other keys on screen, bring the selected key back.
  const trimmedQuery = query.trim();
  useEffect(() => {
    setHover(null);
  }, [
    target?.name,
    target?.sub,
    currentValue,
    shownCategory,
    trimmedQuery,
    composing,
    editingIndex,
  ]);

  // ------------------------------------------------------------ rendering
  const renderKey = (key: PaletteKey) => {
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
        top={key.top}
        bottom={key.bottom}
        width={keyWidth(1)}
        fontSize={key.size}
        condensed={key.condensed}
        colors={colors[key.role]}
        current={isCurrent}
        disabled={disabled}
        ariaLabel={
          editing && !compose
            ? `${t(ROLE_LABEL[focusRole])}: ${name}`
            : name || keycode.code
        }
        title={
          disabledReason
            ? [title || name, reasonLabel(disabledReason)].filter(Boolean).join('\n')
            : title ??
              (`${key.top} ${key.bottom}`.trim() !== name ? name : undefined)
        }
        onPick={() => pickKey(keycode)}
        onHover={() => setHover({keycode})}
      />
    );
  };

  const renderRow = (row: PaletteItem[], rowIndex: number) => (
    <KeyRow key={rowIndex}>
      {row.map((item, itemIndex) =>
        item.kind === 'gap' ? (
          <span
            key={`gap-${itemIndex}`}
            aria-hidden="true"
            style={{width: keyWidth(item.units), flexShrink: 0}}
          />
        ) : (
          renderKey(item)
        ),
      )}
    </KeyRow>
  );

  const shownMenu =
    offered.find((menu) => menu.id === shownCategory) ?? offered[0] ?? null;
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

  let grid: ReactNode;
  if (trimmedQuery) {
    const typedLabel =
      typedCode === null
        ? ''
        : formatKeycodeLabel(typedCode, basicKeyToByte, byteToKey);
    const typedName = typedCode === null ? '' : legendOf(typedCode).name;
    grid = (
      <>
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
              disabled={!!typedDisabledReason || (!compose && !canPut)}
              aria-disabled={
                !!typedDisabledReason || (!compose && !canPut) || undefined
              }
              title={
                typedDisabledReason
                  ? reasonLabel(typedDisabledReason)
                  : !compose && !canPut
                    ? t('Select a key on the keyboard first')
                    : undefined
              }
              onClick={() => putTyped(typedCode)}
            >
              {t('Put in')}
            </PrimaryAccentButton>
          </Panel>
        ) : null}
        {hits.length === 0 && typedCode === null ? (
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
  } else if (!shownMenu) {
    grid = null;
  } else if (
    shownMenu.id === TAP_DANCE_CATEGORY &&
    tapDance &&
    !tapDance.unverified &&
    !tapDance.failed &&
    !editing &&
    !compose
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

  // Every enabled category stays available. Eligibility belongs to each key.
  const categoryTabs = (height: number) => (
    <TabRow
      $height={height}
      role="group"
      aria-label={t('Keycode categories')}
    >
      {menus.map((menu) => {
        const selected = menu.id === shownCategory && !trimmedQuery;
        return (
          <Tab
            key={menu.id}
            ref={focusTarget(`tab:${menu.id}`)}
            type="button"
            $selected={selected}
            aria-pressed={selected}
            onClick={() => selectCategory(menu.id)}
          >
            {t(menu.label)}
            {menu.id === TAP_DANCE_CATEGORY && tapDancePending ? (
              <DirtyDot aria-hidden="true" />
            ) : null}
          </Tab>
        );
      })}
      {!compose ? (
        <>
          <TabDivider aria-hidden="true" />
          <TabAction
            ref={focusTarget('compose')}
            type="button"
            onClick={startCompose}
          >
            + {t('Combined key')}
          </TabAction>
        </>
      ) : null}
    </TabRow>
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
        if (event.key === 'Enter' && (compose || canPut)) {
          putTyped(typedValue);
        }
      }}
    />
  );
  const blankValue = clearKeycodeValue(basicKeyToByte);

  // What the header's keycap shows: the slot being filled, or the target.
  const headerLegend =
    currentValue === null ? {top: '', bottom: ''} : legendOf(currentValue);
  // A slot the keyboard has not reported has nothing to edit yet.
  const targetTd =
    !editing && tapDance && target?.value != null
      ? tapDance.slots.find(
          (item) => slotValue(item) === target.value && !!tapDance.read(item),
        )
      : undefined;

  // A key under the pointer is described as it is, even one this keyboard cannot
  // take; a value is described as the palette names it.
  const hovered = hover && 'keycode' in hover ? hover.keycode : null;
  const infoValue = hovered
    ? selectKeycodeFromMenuCode(hovered.code, basicKeyToByte)
    : hover && 'value' in hover
      ? hover.value
      : currentValue;

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
          focus: editor.focus,
          termBounds,
          canApply:
            slotShown.dirty.size > 0 &&
            termValid &&
            !draftDisabledReason &&
            !!tapDance?.canWrite &&
            !editor.applying,
          applyBlockedReason: !tapDance?.canWrite
            ? t('Tap Dance settings cannot be written right now.')
            : reasonLabel(draftDisabledReason),
          applying: editor.applying,
          error: editor.error,
          placed: target?.value != null && target.value === slotValue(slot),
          canPlace: !!target,
        }
      : null;

  return (
    <Root>
      <Header ref={headerRef}>
        <HeaderEnd>
          {/* Clear turns itself off once used: focus waits on the block around
              it rather than falling to the page. */}
          <TargetBlock ref={targetRef} tabIndex={-1}>
            <KeycapView
              top={headerLegend.top}
              bottom={headerLegend.bottom}
              colors={colors.alpha}
              dashed={editing || !!compose}
            />
            <TargetText>
              {/* With nothing selected the header only says so, in a few muted words;
                the empty keycap and the keyboard above already say what to do. */}
              <span
                style={!editing && !compose && !target ? {color: muted} : undefined}
              >
                {targetLabel ?? t('No key selected')}
              </span>
              <span>
                {compose
                  ? (destinationLabel ?? t('No key selected'))
                  : editing
                    ? ''
                    : (target?.sub ?? '')}
              </span>
            </TargetText>
            {/* Blanking stays on the key it blanked, unlike a pick with fast remap,
                so a second click cannot blank the next key. */}
            <AccentButtonSmall
              ref={clearRef}
              type="button"
              style={{marginLeft: 8}}
              disabled={
                (!compose && !canPut) ||
                currentValue === null ||
                currentValue === blankValue
              }
              title={t('Sets it to blank (KC_NO): pressing it sends nothing.')}
              onClick={() => {
                handFocus(clearRef.current, targetRef.current);
                if (compose) {
                  pickValue(blankValue);
                } else {
                  put(blankValue, t('Blank'), {stay: true});
                }
              }}
            >
              {t('Clear', {context: 'key'})}
            </AccentButtonSmall>
            {targetTd && !compose ? (
              <TextAction
                ref={focusTarget('edit')}
                type="button"
                aria-label={t('Edit {{name}}', {name: targetTd.name})}
                title={t('Edit {{name}}', {name: targetTd.name})}
                onClick={() => openEditor(targetTd, category, 'edit')}
              >
                {t('Edit')} →
              </TextAction>
            ) : null}
          </TargetBlock>
        </HeaderEnd>
        {(() => {
          const middle = (
            <HeaderMiddle key="middle" ref={middleRef} $compact={compactHeader}>
              {categoryTabs(compactHeader ? 56 : 64)}
            </HeaderMiddle>
          );
          const end = (
            <HeaderEnd key="end" $end>
              <EndGroup ref={endRef}>
                {search}
                {headerEnd}
              </EndGroup>
            </HeaderEnd>
          );
          return compactHeader ? [end, middle] : [middle, end];
        })()}
      </Header>

      <Main
        ref={mainRef}
        style={pinnedHeight ? {scrollPaddingTop: pinnedHeight} : undefined}
      >
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
          {(view && editor) || (compose && composeResult) ? (
            <Pinned ref={pinnedRef}>
              {view && editor ? (
                <TapDanceEditor
                  view={view}
                  categoryLabel={menuLabel(TAP_DANCE_CATEGORY)}
                  colors={colors.alpha}
                  legendOf={legendOf}
                  onBack={() => exitEditor('')}
                  onPlace={() => {
                    const value = slotValue(view.slot);
                    if (value !== null && target) {
                      onAssign(value, {stay: true});
                      setFlash(`${target.name} ← ${view.slot.name}`);
                    }
                  }}
                  onFocusSlot={(focus) => setEditor({...editor, focus})}
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
              ) : null}
              {compose && composeResult ? (
                <ComposePanel
                  state={compose}
                  result={composeResult}
                  layerCount={Math.max(1, Math.min(16, layerCount))}
                  colors={colors}
                  canPut={canPut}
                  putBlockedReason={
                    editing && composeResult.value !== null
                      ? reasonLabel(
                          tapDance?.getDisabledReason?.(composeResult.value) ?? null,
                        )
                      : undefined
                  }
                  onTapSelect={() => {
                    setQuery('');
                    setHover(null);
                  }}
                  onChange={(next) => setCompose({...compose, ...next})}
                  onCancel={closeCompose}
                  onPut={() => {
                    if (
                      composeResult.value !== null &&
                      put(composeResult.value, composeResult.code)
                    ) {
                      closeCompose();
                    }
                  }}
                />
              ) : null}
            </Pinned>
          ) : null}

          {grid}
          {tapDanceNote ? (
            <ConfigureStatusMessage role="status" style={{alignSelf: 'center'}}>
              {tapDanceNote}
            </ConfigureStatusMessage>
          ) : null}
        </Column>
        {!editing &&
        (trimmedQuery || category !== TAP_DANCE_CATEGORY) &&
        info ? (
          <InfoAnchor>
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
          </InfoAnchor>
        ) : null}
      </Main>

      <Announcement role="status" aria-live="polite">
        {flash}
      </Announcement>
    </Root>
  );
};
