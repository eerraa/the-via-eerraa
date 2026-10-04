import type {KeyboardDictionary} from '@the-via/reader';
import type {Device, VendorProductIdMap} from '../types/types';
import {canConnect} from './keyboard-api';
import {scanDevices} from './usb-hid';
import manifest from '../../config/era-definitions.manifest.json';

/** Known older firmware may offer downloads without a safe Custom definition. */
export const isDownloadOnlyFirmwareDevice = (
  {vendorId, productId}: Pick<Device, 'vendorId' | 'productId'>,
) => manifest.downloadOnlyIdentities.some((identity) =>
  Number.parseInt(identity.vendorId, 16) === vendorId &&
  Number.parseInt(identity.productId, 16) === productId,
);

export function getVendorProductId(vendorId: number, productId: number) {
  // JS bitwise operations is only 32-bit so we lose numbers if we shift too high
  return vendorId * 65536 + productId;
}

function definitionExists(
  {productId, vendorId}: Device,
  definitions: KeyboardDictionary,
) {
  const definition = definitions[getVendorProductId(vendorId, productId)];
  return definition && (definition.v2 || definition.v3);
}

const idExists = ({productId, vendorId}: Device, vpidMap: VendorProductIdMap) =>
  vpidMap[getVendorProductId(vendorId, productId)];

export const getRecognisedDevices = async (
  vpidMap: VendorProductIdMap,
  forceRequest = false,
) => {
  const usbDevices = await scanDevices(forceRequest);
  return usbDevices.filter((device) => {
    const validVendorProduct = idExists(device, vpidMap);
    // attempt connection
    return (validVendorProduct || isDownloadOnlyFirmwareDevice(device) || forceRequest) && canConnect(device);
  });
};
