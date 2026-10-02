import type {AppThunk, RootState} from './index';
import {
  getDefinitionSourceForDevice,
  getDefinitionSyncIdentity,
  getSelectedDefinition,
} from './definitionsSlice';
import {
  getSelectedConnectedDevice,
  getSelectedConnectionGeneration,
  getSelectedConnectionNeedsReload,
  getSelectionGeneration,
} from './devicesSlice';
import {getCustomCommandsForDefinition, setMenuObservation} from './menusSlice';
import {KeyboardAPI} from '../utils/keyboard-api';
import {
  observationAddress,
  readMenuObservation,
  type MenuObservationValue,
} from '../utils/menu-observation';

export const menuObservationScope = (state: RootState) => {
  const device = getSelectedConnectedDevice(state);
  if (!device || getSelectedConnectionNeedsReload(state)) return null;
  const generation = getSelectedConnectionGeneration(state);
  const definition = getDefinitionSyncIdentity(state, device);
  return generation === null || definition === null
    ? null
    : JSON.stringify([
        device.path,
        generation,
        getSelectionGeneration(state),
        definition,
      ]);
};

export const getMenuObservation = (state: RootState, command: string) => {
  const observation = state.menus.observations?.[command];
  return observation?.scope === menuObservationScope(state)
    ? observation.value
    : undefined;
};

let requestSequence = 0;
export const refreshMenuObservation =
  (command: string): AppThunk<Promise<MenuObservationValue | null>> =>
  async (dispatch, getState) => {
    const state = getState();
    const device = getSelectedConnectedDevice(state);
    const scope = menuObservationScope(state);
    const address = observationAddress(command);
    const definition = getSelectedDefinition(state);
    const defined =
      definition && getCustomCommandsForDefinition(definition)[command];
    if (
      !device ||
      !scope ||
      !address ||
      getDefinitionSourceForDevice(state, device) !== 'era' ||
      !defined ||
      defined.length !== address.length ||
      !defined.every((byte, i) => byte === address[i])
    )
      return null;
    const api = new KeyboardAPI(device.path);
    const generation = getSelectedConnectionGeneration(state)!;
    const request = ++requestSequence;
    const current = () =>
      menuObservationScope(getState()) === scope &&
      api.isConnectionGenerationCurrent(generation);
    if (!current()) return null;
    dispatch(
      setMenuObservation({command, scope, request, value: {status: 'loading'}}),
    );
    const value = await readMenuObservation(api, command, current);
    if (
      !current() ||
      getState().menus.observations[command]?.request !== request
    )
      return null;
    dispatch(setMenuObservation({command, scope, request, value}));
    return value;
  };
