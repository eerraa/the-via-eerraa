import {createSlice, type PayloadAction} from '@reduxjs/toolkit';
import {getSelectedConnectedDevice, selectDevice} from './devicesSlice';
import type {RootState} from './index';

// Where the user is in Configure on each keyboard model: the menu open on the rail
// and the sub-tab last open in each menu, both by name. Configure is built anew
// whenever it is shown again, after another page or after a reconnect such as the
// restart a polling change causes, and it opens here rather than on KEYMAP. It is
// kept by vendor and product id, not HID path: a keyboard that restarts can come
// back on another path. Only for this session: a fresh app load opens KEYMAP.

/**
 * KEYMAP as the hold's TAPPING link left it, for the way back from the menu it
 * opened: the selected key and layer. It ends once used, when the keyboard
 * changes or when another menu is opened.
 */
type LtmtReturn = {
  /** KEYMAP's menu and the menu the link opened, by their names from `menuKeys`. */
  keymap: string;
  menu: string;
  /** The sub-tab the link opened in that menu. */
  submenu: string;
  selectedKey: number | null;
  layer: number;
  /** Set by "To Keymap": KEYMAP, opened by it, takes all of this back. */
  back?: true;
};

/**
 * KEYMAP as the Macro tab's "Macros settings" left it, for the way back from the
 * Macros menu: the selected key and layer. The Macros menu also starts one when
 * it sends a macro to KEYMAP opened another way, with no key to go back to. It
 * ends as the LT·MT way back does.
 */
type MacroReturn = {
  /** KEYMAP's menu and the Macros menu, by their names from `menuKeys`. */
  keymap: string;
  menu: string;
  selectedKey: number | null;
  layer: number | null;
  /** Set on the way back: the macro KEYMAP focuses. */
  back?: {macro: number};
};

type ConfigurePlace = {
  /** The menu open on the rail, by its name from `menuKeys`. */
  menu?: string;
  /** The label of the sub-tab last open in each menu, by the menu's Title. */
  submenus: Record<string, string>;
  ltmt?: LtmtReturn;
  macro?: MacroReturn;
};

type ConfigurePlaceState = Record<string, ConfigurePlace>;

const initialState: ConfigurePlaceState = {};

const configurePlaceSlice = createSlice({
  name: 'configurePlace',
  initialState,
  reducers: {
    openConfigureMenu: (
      state,
      action: PayloadAction<{board: number; menu: string}>,
    ) => {
      const {board, menu} = action.payload;
      const place = (state[board] ??= {submenus: {}});
      place.menu = menu;
      // Any other menu opened ends the way back to the builder or the Macro tab.
      if (place.ltmt && menu !== place.ltmt.menu) {
        delete place.ltmt;
      }
      if (place.macro && menu !== place.macro.menu) {
        delete place.macro;
      }
    },
    openConfigureSubmenu: (
      state,
      action: PayloadAction<{board: number; menu: string; submenu: string}>,
    ) => {
      const {board, menu, submenu} = action.payload;
      (state[board] ??= {submenus: {}}).submenus[menu] = submenu;
    },
    keepLtmtReturn: (
      state,
      action: PayloadAction<{board: number; ltmt: LtmtReturn}>,
    ) => {
      const {board, ltmt} = action.payload;
      (state[board] ??= {submenus: {}}).ltmt = ltmt;
    },
    /** "To Keymap": opens KEYMAP, which takes the selection back and opens the hold. */
    returnToLtmt: (state, action: PayloadAction<{board: number}>) => {
      const place = state[action.payload.board];
      if (place?.ltmt) {
        place.ltmt.back = true;
        place.menu = place.ltmt.keymap;
      }
    },
    clearLtmtReturn: (state, action: PayloadAction<{board: number}>) => {
      delete state[action.payload.board]?.ltmt;
    },
    keepMacroReturn: (
      state,
      action: PayloadAction<{board: number; macro: MacroReturn}>,
    ) => {
      const {board, macro} = action.payload;
      (state[board] ??= {submenus: {}}).macro = macro;
    },
    /**
     * The Macros menu's "To Keymap": opens KEYMAP, which takes back the key the
     * Macro tab left, if any, and focuses the macro.
     */
    returnFromMacros: (
      state,
      action: PayloadAction<{
        board: number;
        keymap: string;
        menu: string;
        macro: number;
      }>,
    ) => {
      const {board, keymap, menu, macro} = action.payload;
      const place = (state[board] ??= {submenus: {}});
      place.macro = {
        ...(place.macro ?? {
          keymap,
          menu,
          selectedKey: null,
          layer: null,
        }),
        back: {macro},
      };
      place.menu = place.macro.keymap;
    },
    clearMacroReturn: (state, action: PayloadAction<{board: number}>) => {
      delete state[action.payload.board]?.macro;
    },
  },
  extraReducers: (builder) => {
    // The way back belongs to the keyboard it was left on.
    builder.addCase(selectDevice, (state) => {
      Object.values(state).forEach((place) => {
        delete place.ltmt;
        delete place.macro;
      });
    });
  },
});

export const {
  openConfigureMenu,
  openConfigureSubmenu,
  keepLtmtReturn,
  returnToLtmt,
  clearLtmtReturn,
  keepMacroReturn,
  returnFromMacros,
  clearMacroReturn,
} = configurePlaceSlice.actions;

export default configurePlaceSlice.reducer;

const getSelectedPlace = (state: RootState): ConfigurePlace | undefined => {
  const device = getSelectedConnectedDevice(state);
  return device ? state.configurePlace[device.vendorProductId] : undefined;
};

export const getOpenConfigureMenu = (state: RootState) =>
  getSelectedPlace(state)?.menu;

export const getOpenConfigureSubmenu = (state: RootState, menu: string) =>
  getSelectedPlace(state)?.submenus[menu];

export const getLtmtReturn = (state: RootState) =>
  getSelectedPlace(state)?.ltmt;

export const getMacroReturn = (state: RootState) =>
  getSelectedPlace(state)?.macro;
