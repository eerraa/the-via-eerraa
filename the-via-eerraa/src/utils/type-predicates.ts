import {KeyboardDictionary} from '@the-via/reader';
import {AuthorizedDevice, ConnectedDevice} from 'src/types/types';

export function isFulfilledPromise<A>(
  a: PromiseSettledResult<A>,
): a is PromiseFulfilledResult<A> {
  return a.status === 'fulfilled';
}

export function isAuthorizedDeviceConnected(
  device: AuthorizedDevice,
  definitions?: KeyboardDictionary,
) {
  return (
    definitions &&
    definitions[device.vendorProductId] &&
    definitions[device.vendorProductId][device.requiredDefinitionVersion]
  );
}
