import {useCallback} from 'react';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {
  getOpenConfigureMenu,
  getOpenConfigureSubmenu,
  openConfigureMenu,
  openConfigureSubmenu,
} from 'src/store/configurePlaceSlice';

const useSelectedBoard = () =>
  useAppSelector((state) => getSelectedConnectedDevice(state)?.vendorProductId);

/**
 * The name each rail menu is kept by: its Title, or `Title#n` for the nth menu of
 * a Title already on the rail. VIA's lighting menus are all titled Lighting, so a
 * definition with two of them has two Lighting rows.
 */
export const menuKeys = (titles: string[]) =>
  titles.reduce<string[]>((keys, title) => {
    let key = title;
    for (let n = 2; keys.includes(key); n++) {
      key = `${title}#${n}`;
    }
    return [...keys, key];
  }, []);

/**
 * The rail menu Configure shows, by its name from `menuKeys`: the one last opened
 * on this keyboard model while the rail still has it, else `fallback`, else the
 * first. Never the menu that moved into the index of one that is gone.
 */
export const useConfigureMenu = (keys: string[], fallback: string) => {
  const dispatch = useAppDispatch();
  const board = useSelectedBoard();
  const opened = useAppSelector(getOpenConfigureMenu);
  const open = useCallback(
    (menu: string) => {
      if (board !== undefined) {
        dispatch(openConfigureMenu({board, menu}));
      }
    },
    [board, dispatch],
  );
  const shown: string | undefined =
    [opened, fallback].find((key) => key !== undefined && keys.includes(key)) ??
    keys[0];
  return [shown, open] as const;
};

/**
 * The sub-tab a Configure menu shows, by label: the one last opened in it on this
 * keyboard model while the menu still has it, else the first.
 */
export const useSubmenuTab = (menu: string, labels: string[]) => {
  const dispatch = useAppDispatch();
  const board = useSelectedBoard();
  const opened = useAppSelector((state) =>
    getOpenConfigureSubmenu(state, menu),
  );
  const open = useCallback(
    (submenu: string) => {
      if (board !== undefined) {
        dispatch(openConfigureSubmenu({board, menu, submenu}));
      }
    },
    [board, dispatch, menu],
  );
  const shown: string | undefined =
    opened !== undefined && labels.includes(opened) ? opened : labels[0];
  return [shown, open] as const;
};
