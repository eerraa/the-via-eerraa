import {createSlice, type PayloadAction} from '@reduxjs/toolkit';
import {getSelectedConnectedDevice} from './devicesSlice';
import type {RootState} from './index';

// Where the user is in Configure on each keyboard model: the menu open on the rail
// and the sub-tab last open in each menu, both by name. Configure is built anew
// whenever it is shown again, after another page or after a reconnect such as the
// restart a polling change causes, and it opens here rather than on KEYMAP. It is
// kept by vendor and product id, not HID path: a keyboard that restarts can come
// back on another path. Only for this session: a fresh app load opens KEYMAP.

type ConfigurePlace = {
  /** The menu open on the rail, by its name from `menuKeys`. */
  menu?: string;
  /** The label of the sub-tab last open in each menu, by the menu's Title. */
  submenus: Record<string, string>;
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
      (state[board] ??= {submenus: {}}).menu = menu;
    },
    openConfigureSubmenu: (
      state,
      action: PayloadAction<{board: number; menu: string; submenu: string}>,
    ) => {
      const {board, menu, submenu} = action.payload;
      (state[board] ??= {submenus: {}}).submenus[menu] = submenu;
    },
  },
});

export const {openConfigureMenu, openConfigureSubmenu} =
  configurePlaceSlice.actions;

export default configurePlaceSlice.reducer;

const getSelectedPlace = (state: RootState): ConfigurePlace | undefined => {
  const device = getSelectedConnectedDevice(state);
  return device ? state.configurePlace[device.vendorProductId] : undefined;
};

export const getOpenConfigureMenu = (state: RootState) =>
  getSelectedPlace(state)?.menu;

export const getOpenConfigureSubmenu = (state: RootState, menu: string) =>
  getSelectedPlace(state)?.submenus[menu];
