import React from 'react';
import {PelpiKeycodeInput} from '../../../inputs/pelpi/keycode-input';
import {AccentButton} from '../../../inputs/accent-button';
import {AccentSlider} from '../../../inputs/accent-slider';
import {AccentSelect} from '../../../inputs/accent-select';
import {AccentRange, RangeValueDisplay} from '../../../inputs/accent-range';
import {ControlRow, Label, Detail} from '../../grid';
import type {VIADefinitionV2, VIADefinitionV3, VIAItem} from '@the-via/reader';
import type {LightingData} from '../../../../types/types';
import {ArrayColorPicker} from '../../../inputs/color-picker';
import {ConnectedColorPalettePicker} from 'src/components/inputs/color-palette-picker';
import {shiftFrom16Bit, shiftTo16Bit} from 'src/utils/keyboard-api';
import {useTranslation} from 'react-i18next';
import {
  decodeRangeValue,
  getRangeBounds,
  type RangeControlMap,
} from 'src/utils/range-constraints';
import {isExactTermCommand} from 'src/utils/era-exact-ms';
import {MillisecondInput} from '../../../inputs/millisecond-input';
import {
  DEFAULT_TAPPING_TERM_BOUNDS,
  type MillisecondAdapter,
} from 'src/utils/millisecond-field';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getSelectedKeyboardAPI,
  getSelectedDevicePath,
} from 'src/store/devicesSlice';
import {
  getCustomMenuDataMap,
  updateSelectedCustomMenuData,
} from 'src/store/menusSlice';
import {invalidateStateSyncDomain} from 'src/store/stateSyncCandidateActions';

type Props = {
  lightingData: LightingData;
  definition: VIADefinitionV2 | VIADefinitionV3;
};

type ControlMeta = [
  string | React.FC<AdvancedControlProps>,
  {type: string} & Partial<{
    min: number;
    max: number;
    getOptions: (d: VIADefinitionV2 | VIADefinitionV3) => string[];
  }>,
];

type AdvancedControlProps = Props & {meta: ControlMeta};

export const VIACustomItem = React.memo(
  (props: VIACustomControlProps & {_id: string}) => {
    const {t} = useTranslation();
    return (
      <ControlRow id={props._id}>
        <Label>{t(props.label)}</Label>
        <Detail>
          {'type' in props ? (
            <VIACustomControl
              {...props}
              value={props.value && Array.from(props.value)}
            />
          ) : (
            props.content
          )}
        </Detail>
      </ControlRow>
    );
  },
);

type ControlGetSet = {
  value: number[];
  updateValue: (name: string, ...command: number[]) => void;
  updateRangeValue: (name: string, value: number) => void;
  rangeControls: RangeControlMap;
  menuData: Record<string, number[] | number[][]>;
};

type VIACustomControlProps = VIAItem & ControlGetSet;

const boxOrArr = <N extends any>(elem: N | N[]) =>
  Array.isArray(elem) ? elem : [elem];

// we can compare value against option[1], that way corrupted values are false
const valueIsChecked = (option: number | number[], value: number[]) =>
  boxOrArr(option).every((o, i) => o == value[i]);

const getRangeValue = (value: number[], max: number) => {
  if (max > 255) {
    return shiftTo16Bit([value[0], value[1]]);
  } else {
    return value[0];
  }
};

const ExactMillisecondControl = ({
  name,
  command,
  value,
}: {
  name: string;
  command: number[];
  value: number[];
}) => {
  const dispatch = useAppDispatch();
  const api = useAppSelector(getSelectedKeyboardAPI);
  const devicePath = useAppSelector(getSelectedDevicePath);
  const menuData = useAppSelector(getCustomMenuDataMap);
  const channel = command[0];
  const id = command[1];
  const adapter: MillisecondAdapter = {
    capability: 'exact',
    minMs: DEFAULT_TAPPING_TERM_BOUNDS.minMs,
    maxMs: DEFAULT_TAPPING_TERM_BOUNDS.maxMs,
    async read() {
      return getRangeValue(value ?? [0, 0], 500);
    },
    async write(candidateMs: number) {
      if (!api || !devicePath) {
        return getRangeValue(value ?? [0, 0], 500);
      }
      const connectionGeneration = api.getConnectionGeneration();
      await api.setCustomMenuValue(channel, id, ...shiftFrom16Bit(candidateMs));
      await api.commitCustomMenu(channel);
      if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
        return candidateMs;
      }
      dispatch(
        invalidateStateSyncDomain({
          devicePath,
          connectionGeneration,
          domain: 'config',
        }),
      );
      const raw = await api.getCustomMenuValue([channel, id]);
      const bytes = raw.slice(1);
      if (!api.isConnectionGenerationCurrent(connectionGeneration)) {
        return candidateMs;
      }
      dispatch(
        updateSelectedCustomMenuData({
          devicePath,
          menuData: {
            ...(menuData[devicePath] || {}),
            [name]: bytes,
          },
        }),
      );
      return shiftTo16Bit([bytes[0] ?? 0, bytes[1] ?? 0]);
    },
  };
  return <MillisecondInput adapter={adapter} ariaLabel={name} />;
};

const decodeNullTerminatedUTF8 = (value?: number[]) => {
  if (!value || value.length === 0) {
    return '';
  }

  const terminatorIdx = value.indexOf(0);
  const bytes = value.slice(
    0,
    terminatorIdx === -1 ? undefined : terminatorIdx,
  );
  return new TextDecoder().decode(new Uint8Array(bytes));
};

const VIACustomControl = (props: VIACustomControlProps) => {
  const {t} = useTranslation();
  const {content, type, options, value} = props as any;
  const [name, ...command] = content;
  switch (type) {
    case 'label': {
      return (
        <RangeValueDisplay>
          {content.length === 1
            ? t(content[0])
            : decodeNullTerminatedUTF8(value)}
        </RangeValueDisplay>
      );
    }
    case 'button': {
      const buttonOption: any[] = options || [1];
      return (
        <AccentButton
          onClick={() => props.updateValue(name, ...command, buttonOption[0])}
        >
          {t('Click')}
        </AccentButton>
      );
    }
    case 'range': {
      if (isExactTermCommand(name)) {
        return (
          <ExactMillisecondControl
            name={name}
            command={command}
            value={props.value}
          />
        );
      }
      const logicalValues = Object.entries(props.rangeControls).reduce<
        Record<string, number>
      >((values, [id, range]) => {
        const rawValue = props.menuData[id];
        if (Array.isArray(rawValue) && typeof rawValue[0] === 'number') {
          values[id] = decodeRangeValue(rawValue as number[], range.options[1]);
        }
        return values;
      }, {});
      const bounds = getRangeBounds(
        name,
        props.rangeControls,
        logicalValues,
        true,
      );
      return (
        <AccentRange
          min={bounds.min}
          max={bounds.max}
          value={getRangeValue(props.value, options[1])}
          onChange={(val: number) => props.updateRangeValue(name, val)}
        />
      );
    }
    case 'keycode': {
      return (
        <PelpiKeycodeInput
          value={shiftTo16Bit([props.value[0], props.value[1]])}
          meta={{}}
          setValue={(val: number) =>
            props.updateValue(name, ...command, ...shiftFrom16Bit(val))
          }
        />
      );
    }
    case 'toggle': {
      const toggleOptions: any[] = options || [0, 1];
      return (
        <AccentSlider
          isChecked={valueIsChecked(toggleOptions[1], props.value)}
          onChange={(val) =>
            props.updateValue(
              name,
              ...command,
              ...boxOrArr(toggleOptions[+val]),
            )
          }
        />
      );
    }
    case 'dropdown': {
      const selectOptions = options.map(
        (option: [string, number] | string, idx: number) => {
          const [label, value] =
            typeof option === 'string' ? [option, idx] : option;
          return {
            value: value || idx,
            label: t(label),
          };
        },
      );
      return (
        <AccentSelect
          /*width={250}*/
          onChange={(option: any) =>
            option && props.updateValue(name, ...command, +option.value)
          }
          options={selectOptions}
          value={selectOptions.find((p: any) => value[0] === p.value)}
        />
      );
    }
    case 'color': {
      return (
        <ArrayColorPicker
          color={props.value as [number, number]}
          setColor={(hue, sat) => props.updateValue(name, ...command, hue, sat)}
        />
      );
    }
    case 'color-palette': {
      return <ConnectedColorPalettePicker />;
    }
  }
  return null;
};
