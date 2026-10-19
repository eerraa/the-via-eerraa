import {navigate} from 'wouter/use-location';
import {
  getFirmwareUpdateStatus,
  getStatusMaker,
} from 'src/utils/era-firmware-catalog';
import {getFirmwareBoardPath} from 'src/utils/firmware-route';
import {getFirmwareData} from 'src/utils/use-firmware-catalog';
import {Badge} from './configure-panes/badge';

/** Explicit device choices open its downloads; background scans keep the URL. */
export const FirmwareDevice = () => {
  if (typeof navigator === 'undefined' || !('hid' in navigator)) return null;

  return (
    <Badge
      allowAuthorize
      onDeviceSelected={(device) => {
        const status = getFirmwareUpdateStatus(getFirmwareData(), {
          ...device,
          version: null,
        });
        if ('board' in status) {
          navigate(
            getFirmwareBoardPath(
              getStatusMaker(status)?.id ?? null,
              status.board.id,
            ),
          );
        }
      }}
    />
  );
};
