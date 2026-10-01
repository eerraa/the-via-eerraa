import {useAppSelector} from 'src/store/hooks';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {getDefinitionSourceForDevice} from 'src/store/definitionsSlice';

/**
 * Whether the selected keyboard is shown through the app's own ERA definition. ERA
 * help and ERA naming apply only then: the same keyboard opened with an official or
 * uploaded definition, like any ordinary VIA keyboard, reads as stock VIA.
 */
export const useIsEraDefinition = () =>
  useAppSelector((state) => {
    const device = getSelectedConnectedDevice(state);
    return !!device && getDefinitionSourceForDevice(state, device) === 'era';
  });
