import {type FC} from 'react';
import {useTranslation} from 'react-i18next';
import {RangeValueDisplay} from '../../../inputs/accent-range';
import {ControlRow, Detail, Label} from '../../grid';
import {
  type EraFirmwareVersionSource,
  readEraFirmwareVersion,
} from 'src/utils/era-firmware-version';

type Props = {
  source: EraFirmwareVersionSource;
  menuData: Record<string, unknown>;
};

/** One read-only presentation for both firmware-family wire adapters. */
export const FirmwareVersion: FC<Props> = ({source, menuData}) => {
  const {t} = useTranslation();
  const version = readEraFirmwareVersion(source, menuData);
  return (
    <ControlRow data-era-firmware-version="true">
      <Label>{t('Current Version')}</Label>
      <Detail>
        <RangeValueDisplay role="status">{version ?? '—'}</RangeValueDisplay>
      </Detail>
    </ControlRow>
  );
};
