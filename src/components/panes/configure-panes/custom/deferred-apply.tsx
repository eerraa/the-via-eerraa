import {useRef, useState, type ReactNode} from 'react';
import {createSelector} from '@reduxjs/toolkit';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {
  AccentButton,
  PrimaryAccentButton,
  handFocus,
} from '../../../inputs/accent-button';
import {Announcement} from '../../../inputs/keycode-palette/palette-parts';
import {isExactSecondCommand} from 'src/utils/era-exact-sec';
import {HELD_VALUES, isCustomMenuCommandContent} from 'src/utils/custom-menu';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import type {AppThunk} from 'src/store/index';
import {
  getSelectedDevicePath,
  getSelectionGeneration,
} from 'src/store/devicesSlice';
import {
  discardDrafts,
  draftKey,
  getSelectedDeviceDrafts,
  setDraft,
  settleWrittenDraft,
} from 'src/store/draftsSlice';
import {
  beginApply,
  endApply,
  getMenuStop,
  isApplying,
  setMenuStop,
  type MenuStop,
} from 'src/store/applyingSlice';

export const isDeferredApplyCommand = (name: string | undefined) =>
  typeof name === 'string' &&
  (name.startsWith('id_qmk_tapping_') ||
    name.startsWith('id_qmk_tapdance_') ||
    isExactSecondCommand(name));

/**
 * A value set on a deferred row and not written yet, in the terms its control
 * edits: a switch's state, a chosen option or key, a range position, or the text
 * typed into a whole-number field.
 */
export type MenuDraft = boolean | number | string;

export type DeferredItem = {
  type: string;
  content: [string, number, number, ...number[]];
  options?: unknown;
  /**
   * For a value the firmware holds until a switch puts it into effect: that switch,
   * and the labels it reports the value in effect and the value kept with, where
   * the definition has them.
   */
  held?: {action: DeferredItem; running?: DeferredItem; stored?: DeferredItem};
};

/** How a deferred row reads its stored value and writes a draft. */
export type DeferredRow = {
  command: string;
  /** The channel and value id that come before the value in a SET. */
  address: number[];
  /** A range goes through its constraints; every other row SETs its bytes. */
  write: 'value' | 'range';
  saved: MenuDraft;
  /** The value bytes a draft stands for, or null while the keyboard would not take it. */
  bytes: (draft: MenuDraft) => number[] | null;
  /** Whether Apply has something to write for the draft. */
  pending: (draft: MenuDraft) => boolean;
  /** A whole-number field's limits; its draft is the typed text. */
  bounds?: {min: number; max: number};
  /**
   * For a value the firmware holds until a switch puts it into effect: the switch's
   * SET, sent after the value, and the labels that report the value in effect and
   * the value kept, with the name a draft has there.
   */
  held?: {
    action: {command: string; address: number[]; bytes: number[]};
    labels: string[];
    name: (draft: MenuDraft) => string | undefined;
  };
};

const commandItems = (node: unknown): DeferredItem[] => {
  if (!node || typeof node !== 'object') {
    return [];
  }
  const {type, content} = node as {type?: unknown; content?: unknown};
  if (typeof type === 'string') {
    return isCustomMenuCommandContent(content) ? [node as DeferredItem] : [];
  }
  return Array.isArray(content) ? content.flatMap(commandItems) : [];
};

/**
 * Every deferred row under a menu or submenu, shown or not. A held value is one
 * only where its switch is there too.
 */
export const collectDeferredItems = (node: unknown): DeferredItem[] => {
  const items = commandItems(node);
  const byCommand = new Map(items.map((item) => [item.content[0], item]));
  return items.flatMap((item): DeferredItem[] => {
    const [command] = item.content;
    if (isDeferredApplyCommand(command)) {
      return [item];
    }
    const commands = HELD_VALUES.find(({value}) => value === command);
    const action = commands && byCommand.get(commands.action);
    if (!commands || !action) {
      return [];
    }
    const running = commands.running && byCommand.get(commands.running);
    const stored = commands.stored && byCommand.get(commands.stored);
    return [
      {
        ...item,
        held: {action, ...(running && {running}), ...(stored && {stored})},
      },
    ];
  });
};

const MENU_DRAFT_PREFIX = draftKey('menu', '');

export const getSelectedMenuDrafts = createSelector(
  getSelectedDeviceDrafts,
  (drafts) => {
    const menuDrafts: Record<string, MenuDraft> = {};
    Object.entries(drafts).forEach(([key, value]) => {
      if (key.startsWith(MENU_DRAFT_PREFIX)) {
        menuDrafts[key.slice(MENU_DRAFT_PREFIX.length)] = value as MenuDraft;
      }
    });
    return menuDrafts;
  },
);

// A held value can still be pending at the value shown, as while the keyboard keeps
// another or cannot say.
export const isDraftDirty = (row: DeferredRow, draft: MenuDraft | undefined) =>
  draft !== undefined && (draft !== row.saved || row.pending(draft));

/**
 * The menu's values with each draft in place of the stored one, for `showIf`, so
 * a row that depends on a drafted setting shows or hides with the draft.
 */
export const withDraftValues = <T extends Record<string, unknown>>(
  menuData: T,
  rows: Map<string, DeferredRow>,
  drafts: Record<string, MenuDraft>,
): T => {
  let result = menuData;
  Object.entries(drafts).forEach(([command, draft]) => {
    const row = rows.get(command);
    const bytes = row && isDraftDirty(row, draft) ? row.bytes(draft) : null;
    if (bytes) {
      result = {...result, [command]: bytes};
    }
  });
  return result;
};

type Writers = {
  updateValue: (command: string, ...bytes: number[]) => Promise<boolean>;
  updateRangeValue: (command: string, value: number) => Promise<boolean>;
  /** Whether every label comes to read the text, and keeps reading it. */
  awaitLabels: (commands: string[], text: string) => Promise<boolean>;
};

/**
 * Writes one page's drafts in row order, each as it was when Apply was pressed. It
 * stops at the first write the keyboard refuses or held value that does not take
 * effect, keeping that draft and the ones after it, and records where for the
 * page, which may have been opened again meanwhile. It also stops once another
 * keyboard is chosen, as each write goes to the one chosen when it is sent, and at
 * a row whose draft has changed since, as after an edit. It resolves to whether
 * every draft the rows held was written and took effect.
 */
const applyDrafts =
  (
    devicePath: string,
    rows: DeferredRow[],
    {updateValue, updateRangeValue, awaitLabels}: Writers,
  ): AppThunk<Promise<boolean>> =>
  async (dispatch, getState) => {
    if (isApplying(getState(), devicePath, 'menu')) {
      return false;
    }
    const pressed = getState().drafts[devicePath] ?? {};
    const selection = getSelectionGeneration(getState());
    const chosen = () =>
      getSelectedDevicePath(getState()) === devicePath &&
      getSelectionGeneration(getState()) === selection;
    let stop: MenuStop | null = null;
    dispatch(beginApply({devicePath, scope: 'menu'}));
    try {
      for (const row of rows) {
        const key = draftKey('menu', row.command);
        const draft = pressed[key] as MenuDraft | undefined;
        if (draft === undefined || !row.pending(draft)) {
          continue;
        }
        const unchanged = () =>
          chosen() && getState().drafts[devicePath]?.[key] === draft;
        if (!unchanged()) {
          break;
        }
        const {held} = row;
        const bytes = row.bytes(draft) ?? [];
        const before = held
          ? (getState()
              .menus.customMenuDataMap[devicePath]?.[row.command]
              ?.slice(0, bytes.length) as number[] | undefined)
          : undefined;
        const written =
          row.write === 'range'
            ? await updateRangeValue(row.command, draft as number)
            : await updateValue(row.command, ...row.address, ...bytes);
        // A held value does nothing until its switch goes out after it, so a draft
        // changed meanwhile, as when set back, is not switched to, and the value
        // held before goes back: one left held reads as a change the keyboard has
        // not made.
        if (written && held && !unchanged()) {
          if (
            before?.length === bytes.length &&
            before.some((byte, index) => byte !== bytes[index]) &&
            chosen()
          ) {
            await updateValue(row.command, ...row.address, ...before);
          }
          break;
        }
        const accepted =
          written &&
          (!held ||
            (await updateValue(
              held.action.command,
              ...held.action.address,
              ...held.action.bytes,
            )));
        if (!accepted) {
          stop = {command: row.command, reason: 'refused'};
          break;
        }
        const name = held?.name(draft);
        if (
          held &&
          held.labels.length > 0 &&
          name !== undefined &&
          !(chosen() && (await awaitLabels(held.labels, name)))
        ) {
          stop = {command: row.command, reason: 'notApplied'};
          break;
        }
        dispatch(settleWrittenDraft({devicePath, key, value: draft}));
      }
    } finally {
      dispatch(endApply({devicePath, scope: 'menu'}));
    }
    // Only while the same keyboard is chosen: choosing another cuts a watch short,
    // which says nothing of whether this one took the value.
    if (stop && chosen()) {
      dispatch(setMenuStop({devicePath, stop}));
    }
    return (
      stop === null &&
      chosen() &&
      rows.every((row) => {
        const draft = getState().drafts[devicePath]?.[
          draftKey('menu', row.command)
        ] as MenuDraft | undefined;
        return draft === undefined || !row.pending(draft);
      })
    );
  };

/**
 * One submenu's drafts: whether a shown row holds one, Cancel and Apply over them,
 * the row a write was last refused on, and whether a held value the keyboard took
 * did not take effect. While an Apply writes to the keyboard, Cancel and Apply stay
 * off, and where it stopped shows once it ends, also on a page left and opened
 * again meanwhile.
 */
export const useDeferredApply = (
  shownRows: DeferredRow[],
  allRows: DeferredRow[],
  drafts: Record<string, MenuDraft>,
  writers: Writers,
) => {
  const dispatch = useAppDispatch();
  const devicePath = useAppSelector(getSelectedDevicePath);
  const applying = useAppSelector(
    (state) => devicePath !== null && isApplying(state, devicePath, 'menu'),
  );
  const stop = useAppSelector((state) =>
    devicePath === null ? null : getMenuStop(state, devicePath),
  );
  // Until the next edit, Cancel or Apply.
  const [applied, setApplied] = useState(false);
  const clearFailure = () => {
    setApplied(false);
    if (devicePath) {
      dispatch(setMenuStop({devicePath, stop: null}));
    }
  };
  const isPending = (row: DeferredRow) => {
    const draft = drafts[row.command];
    return draft !== undefined && row.pending(draft);
  };
  const dirty = shownRows.some((row) => isDraftDirty(row, drafts[row.command]));
  const canApply = !applying && shownRows.some(isPending);
  // Only while that row still holds a value the keyboard has not put into effect.
  const notApplied =
    stop?.reason === 'notApplied' &&
    shownRows.some((row) => row.command === stop.command && isPending(row));

  const edit = (row: DeferredRow, draft: MenuDraft) => {
    if (!devicePath) {
      return;
    }
    clearFailure();
    const key = draftKey('menu', row.command);
    dispatch(
      isDraftDirty(row, draft)
        ? setDraft({devicePath, key, value: draft})
        : discardDrafts({devicePath, keys: [key]}),
    );
  };

  // Cancel also drops a draft whose row a drafted setting has hidden.
  const cancel = () => {
    clearFailure();
    if (devicePath) {
      dispatch(
        discardDrafts({
          devicePath,
          keys: allRows.map((row) => draftKey('menu', row.command)),
        }),
      );
    }
  };

  const apply = async () => {
    if (!devicePath) {
      return;
    }
    clearFailure();
    setApplied(await dispatch(applyDrafts(devicePath, shownRows, writers)));
  };

  // A row written at once reports a refusal on the same line.
  const write = async (command: string, ...rest: number[]) => {
    clearFailure();
    if (!(await writers.updateValue(command, ...rest)) && devicePath) {
      dispatch(setMenuStop({devicePath, stop: {command, reason: 'refused'}}));
    }
  };

  return {
    dirty,
    canApply,
    canCancel: dirty && !applying,
    failedCommand: stop?.reason === 'refused' ? stop.command : null,
    notApplied,
    applied,
    edit,
    cancel,
    apply,
    write,
  };
};

const ApplyRow = styled.div`
  width: 100%;
  max-width: 960px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  box-sizing: border-box;
  padding: 12px 5px 8px;
`;

/** A word before the pair, as quiet as the labels around it. */
export const ApplyNote = styled.span`
  font-size: 16px;
  line-height: 20px;
  color: var(--color_label);
`;

export const DeferredApplyButtons = ({
  canCancel,
  canApply,
  onCancel,
  onApply,
  status,
  children,
}: {
  canCancel: boolean;
  canApply: boolean;
  onCancel: () => void;
  onApply: () => void;
  /** Said to a screen reader when it changes, such as that Apply went through. */
  status?: string;
  /** What the page puts before the pair, such as why Apply did not go through. */
  children?: ReactNode;
}) => {
  const {t} = useTranslation();
  // Both turn themselves off once used: focus waits on their row rather than
  // falling to the page.
  const rowRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  return (
    <ApplyRow ref={rowRef} tabIndex={-1}>
      <Announcement role="status">{status}</Announcement>
      {children}
      <AccentButton
        ref={cancelRef}
        type="button"
        disabled={!canCancel}
        onClick={() => {
          handFocus(cancelRef.current, rowRef.current);
          onCancel();
        }}
      >
        {t('Cancel')}
      </AccentButton>
      <PrimaryAccentButton
        ref={applyRef}
        type="button"
        disabled={!canApply}
        onClick={() => {
          handFocus(applyRef.current, rowRef.current);
          return onApply();
        }}
      >
        {t('Apply')}
      </PrimaryAccentButton>
    </ApplyRow>
  );
};
