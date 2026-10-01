import {useSyncExternalStore} from 'react';
import catalogSource from '../../config/firmware-catalog.json';
import manifestSource from '../../config/era-definitions.manifest.json';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {getSelectedCustomMenuData} from 'src/store/menusSlice';
import {
  type FirmwareCatalog,
  type FirmwareData,
  type FirmwareManifest,
  type FirmwareUpdateStatus,
  getFirmwareUpdateStatus,
  getRememberedMakerRevision,
  readRememberedMaker,
  subscribeRememberedMakers,
} from './era-firmware-catalog';
import {
  decodeEraFirmwareVersion,
  ERA_FIRMWARE_VERSION_COMMAND,
} from './era-firmware-version';

// The catalog is bundled with the app, so the firmware page and the update check
// need no runtime service and deploy atomically with the release they describe.
const bundledFirmwareData: FirmwareData = {
  catalog: catalogSource as FirmwareCatalog,
  manifest: manifestSource as FirmwareManifest,
};

let firmwareDataOverride: FirmwareData | null = null;

export const setFirmwareDataForTesting = (data: FirmwareData | null) => {
  firmwareDataOverride = data;
};

export const getFirmwareData = (): FirmwareData =>
  firmwareDataOverride ?? bundledFirmwareData;

/** Re-render when a maker choice for a legacy shared board changes. */
export const useRememberedMakerRevision = () =>
  useSyncExternalStore(
    subscribeRememberedMakers,
    getRememberedMakerRevision,
    getRememberedMakerRevision,
  );

/**
 * Update status of the selected keyboard. `version` is the VERSION value when
 * the caller already holds it; otherwise it is read from the loaded custom menu
 * data. Only reads state: nothing is sent to the keyboard.
 */
export const useSelectedFirmwareUpdate = (
  version?: string | null,
): FirmwareUpdateStatus | null => {
  const device = useAppSelector(getSelectedConnectedDevice);
  const menuData = useAppSelector(getSelectedCustomMenuData) as
    | Record<string, unknown>
    | null
    | undefined;
  useRememberedMakerRevision();
  if (!device) {
    return null;
  }
  const current =
    version !== undefined
      ? version
      : decodeEraFirmwareVersion(menuData?.[ERA_FIRMWARE_VERSION_COMMAND]);
  return getFirmwareUpdateStatus(getFirmwareData(), {
    vendorId: device.vendorId,
    productId: device.productId,
    version: current,
    rememberedMaker: readRememberedMaker,
  });
};
