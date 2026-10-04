import catalogSource from '../../config/firmware-catalog.json';
import manifestSource from '../../config/era-definitions.manifest.json';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {getSelectedCurrentCustomMenuData} from 'src/store/menusSlice';
import {
  type FirmwareCatalog,
  type FirmwareData,
  type FirmwareManifest,
  type FirmwareUpdateStatus,
  getFirmwareUpdateStatus,
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

/**
 * Update status of the selected keyboard. `version` is the VERSION value when
 * the caller already holds it; otherwise it is read from the loaded custom menu
 * data. Only reads state: nothing is sent to the keyboard.
 */
export const useSelectedFirmwareUpdate = (
  version?: string | null,
): FirmwareUpdateStatus | null => {
  const device = useAppSelector(getSelectedConnectedDevice);
  const menuData = useAppSelector(getSelectedCurrentCustomMenuData) as
    | Record<string, unknown>
    | null
    | undefined;
  if (!device) {
    return null;
  }
  const current =
    !menuData
      ? null
      : version !== undefined
      ? version
      : decodeEraFirmwareVersion(menuData?.[ERA_FIRMWARE_VERSION_COMMAND]);
  return getFirmwareUpdateStatus(getFirmwareData(), {
    vendorId: device.vendorId,
    productId: device.productId,
    version: current,
  });
};
