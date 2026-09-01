import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import styled from 'styled-components';
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
import {
  exactTermBoundsFromOptions,
  isExactTermCommand,
} from 'src/utils/era-exact-ms';
import {getExactMsFamily} from 'src/utils/era-advanced-metadata';
import {MillisecondInput} from '../../../inputs/millisecond-input';
import {IntegerInput} from '../../../inputs/integer-input';
import {type IntegerAdapter} from 'src/utils/integer-field';
import {
  EXACT_SECOND_BOUNDS,
  isExactSecondCommand,
} from 'src/utils/era-exact-sec';
import {
  shouldDeferApplyCommand,
  useDeferredApplyMode,
  useDeferredApplyRegistration,
} from './deferred-apply';
import {type MillisecondAdapter} from 'src/utils/millisecond-field';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getSelectedConnectedDevice,
} from 'src/store/devicesSlice';
import {
  getSelectedCustomMenuAvailability,
  updateCustomMenuValue,
} from 'src/store/menusSlice';
import {ExplainBody, useExplainDisclosure} from 'src/components/inputs/explain';
import {findEraControlHelp} from 'src/utils/era-feature-help';
import {isCustomMenuCommandContent} from 'src/utils/custom-menu';

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

// A row that carries its own help wraps: the label and its ⓘ stay in the left column,
// the control stays in the right one, and the folded body gets a full-width line under
// both. Rows without help keep the original two-column row untouched.
const HelpfulControlRow = styled(ControlRow)`
  flex-wrap: wrap;
`;

const LabelGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

// The 50px line box above already leaves a gap, so the body only needs room beneath it.
const ControlExplainBody = styled(ExplainBody)`
  margin: 0 0 12px;
  white-space: pre-line;
`;

export const VIACustomItem = React.memo(
  (props: VIACustomControlProps & {_id: string}) => {
    const {t} = useTranslation();
    const label = t(props.label);
    // Matched on the firmware's own command name, so this never appears on an ordinary
    // VIA keyboard. Most controls get nothing: see the rule in `era-feature-help.ts`.
    const help = findEraControlHelp(
      isCustomMenuCommandContent(props.content) ? props.content[0] : null,
      props.label,
    );
    const {toggle, bodyProps} = useExplainDisclosure(
      t('What this means: {{name}}', {name: label}),
    );
    const detail = (
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
    );
    if (!help) {
      return (
        <ControlRow id={props._id}>
          <Label>{label}</Label>
          {detail}
        </ControlRow>
      );
    }
    return (
      <HelpfulControlRow id={props._id}>
        <LabelGroup>
          <Label>{label}</Label>
          {toggle}
        </LabelGroup>
        {detail}
        <ControlExplainBody {...bodyProps}>{t(help)}</ControlExplainBody>
      </HelpfulControlRow>
    );
  },
);

type ControlGetSet = {
  value: number[];
  updateValue: (
    name: string,
    ...command: number[]
  ) => void | Promise<void>;
  updateRangeValue: (name: string, value: number) => void | Promise<void>;
  updateContinuousValue: (
    name: string,
    ...command: number[]
  ) => void | Promise<void>;
  completeContinuousValue: (name: string) => void | Promise<void>;
  updateContinuousRangeValue: (
    name: string,
    value: number,
  ) => void | Promise<void>;
  completeContinuousRangeValue: (name: string) => void | Promise<void>;
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
  options,
}: {
  name: string;
  command: number[];
  value: number[];
  options?: number[];
}) => {
  const dispatch = useAppDispatch();
  const device = useAppSelector(getSelectedConnectedDevice);
  const menuAvailability = useAppSelector(
    getSelectedCustomMenuAvailability,
  );
  const channel = command[0];
  const id = command[1];
  const bounds = exactTermBoundsFromOptions(
    options,
    device ? getExactMsFamily(device.vendorProductId) : null,
  );
  const currentMs = getRangeValue(value ?? [0, 0], bounds.maxMs);
  const writeContext = useRef({
    name,
    dispatch,
    currentMs,
    menuAvailability,
  });
  writeContext.current = {
    name,
    dispatch,
    currentMs,
    menuAvailability,
  };
  const adapter: MillisecondAdapter = useMemo(
    () => ({
      minMs: bounds.minMs,
      maxMs: bounds.maxMs,
      async write(candidateMs: number) {
        const context = writeContext.current;
        if (context.menuAvailability !== 'available') {
          return context.currentMs;
        }
        const previousMs = context.currentMs;
        const accepted = await context.dispatch(
          updateCustomMenuValue(
            context.name,
            channel,
            id,
            ...shiftFrom16Bit(candidateMs),
          ),
        );
        return accepted ? candidateMs : previousMs;
      },
    }),
    [bounds.maxMs, bounds.minMs, channel, id],
  );
  return (
    <MillisecondInput
      adapter={adapter}
      ariaLabel={name}
      savedMs={currentMs}
    />
  );
};

const ExactSecondControl = ({
  name,
  command,
  value,
}: {
  name: string;
  command: number[];
  value: number[];
}) => {
  const dispatch = useAppDispatch();
  const menuAvailability = useAppSelector(getSelectedCustomMenuAvailability);
  const channel = command[0];
  const id = command[1];
  const currentSeconds = getRangeValue(
    value ?? [0, 0],
    EXACT_SECOND_BOUNDS.max,
  );
  const writeContext = useRef({
    name,
    dispatch,
    currentSeconds,
    menuAvailability,
  });
  writeContext.current = {
    name,
    dispatch,
    currentSeconds,
    menuAvailability,
  };
  const adapter: IntegerAdapter = useMemo(
    () => ({
      min: EXACT_SECOND_BOUNDS.min,
      max: EXACT_SECOND_BOUNDS.max,
      async write(candidateSeconds: number) {
        const context = writeContext.current;
        if (context.menuAvailability !== 'available') {
          return context.currentSeconds;
        }
        const previousSeconds = context.currentSeconds;
        const accepted = await context.dispatch(
          updateCustomMenuValue(
            context.name,
            channel,
            id,
            ...shiftFrom16Bit(candidateSeconds),
          ),
        );
        return accepted ? candidateSeconds : previousSeconds;
      },
    }),
    [channel, id],
  );
  return (
    <IntegerInput
      adapter={adapter}
      ariaLabel={name}
      savedValue={currentSeconds}
      suffix="s"
    />
  );
};

const DEFAULT_TOGGLE_OPTIONS = [0, 1];

const DeferredToggleControl = ({
  id,
  name,
  command,
  value,
  options,
  updateValue,
}: {
  id: string;
  name: string;
  command: number[];
  value: number[];
  options?: any;
  updateValue: ControlGetSet['updateValue'];
}) => {
  const toggleOptions = (options as number[] | undefined) || DEFAULT_TOGGLE_OPTIONS;
  const savedChecked = valueIsChecked(toggleOptions[1], value || [0]);
  const [checked, setChecked] = useState(savedChecked);
  const dirty = checked !== savedChecked;
  useEffect(() => {
    if (!dirty) {
      setChecked(savedChecked);
    }
  }, [dirty, savedChecked]);
  const latest = useRef({
    checked,
    name,
    command,
    toggleOptions,
    updateValue,
  });
  latest.current = {checked, name, command, toggleOptions, updateValue};
  const apply = useCallback(async () => {
    const current = latest.current;
    await current.updateValue(
      current.name,
      ...current.command,
      ...boxOrArr(current.toggleOptions[+current.checked]),
    );
  }, []);
  useDeferredApplyRegistration(id, dirty, apply);
  return <AccentSlider isChecked={checked} onChange={setChecked} />;
};

const DeferredKeycodeControl = ({
  id,
  name,
  command,
  value,
  updateValue,
}: {
  id: string;
  name: string;
  command: number[];
  value: number[];
  updateValue: ControlGetSet['updateValue'];
}) => {
  const savedCode = shiftTo16Bit([value?.[0] ?? 0, value?.[1] ?? 0]);
  const [code, setCode] = useState(savedCode);
  const dirty = code !== savedCode;
  useEffect(() => {
    if (!dirty) {
      setCode(savedCode);
    }
  }, [dirty, savedCode]);
  const latest = useRef({code, name, command, updateValue});
  latest.current = {code, name, command, updateValue};
  const apply = useCallback(async () => {
    const current = latest.current;
    await current.updateValue(
      current.name,
      ...current.command,
      ...shiftFrom16Bit(current.code),
    );
  }, []);
  useDeferredApplyRegistration(id, dirty, apply);
  return (
    <PelpiKeycodeInput value={code} meta={{}} setValue={setCode} />
  );
};

const DeferredDropdownControl = ({
  id,
  name,
  command,
  value,
  selectOptions,
  updateValue,
}: {
  id: string;
  name: string;
  command: number[];
  value: number[];
  selectOptions: {value: number; label: string}[];
  updateValue: ControlGetSet['updateValue'];
}) => {
  const saved = value?.[0] ?? 0;
  const [draft, setDraft] = useState(saved);
  const dirty = draft !== saved;
  useEffect(() => {
    if (!dirty) {
      setDraft(saved);
    }
  }, [dirty, saved]);
  const latest = useRef({draft, name, command, updateValue});
  latest.current = {draft, name, command, updateValue};
  const apply = useCallback(async () => {
    const current = latest.current;
    await current.updateValue(current.name, ...current.command, current.draft);
  }, []);
  useDeferredApplyRegistration(id, dirty, apply);
  return (
    <AccentSelect
      onChange={(option: any) => option && setDraft(+option.value)}
      options={selectOptions}
      value={selectOptions.find((option) => draft === option.value)}
    />
  );
};

const DeferredRangeControl = ({
  id,
  name,
  min,
  max,
  value,
  updateRangeValue,
}: {
  id: string;
  name: string;
  min: number;
  max: number;
  value: number;
  updateRangeValue: ControlGetSet['updateRangeValue'];
}) => {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;
  useEffect(() => {
    if (!dirty) {
      setDraft(value);
    }
  }, [dirty, value]);
  const latest = useRef({draft, name, updateRangeValue});
  latest.current = {draft, name, updateRangeValue};
  const apply = useCallback(async () => {
    const current = latest.current;
    await current.updateRangeValue(current.name, current.draft);
  }, []);
  useDeferredApplyRegistration(id, dirty, apply);
  return (
    <AccentRange
      min={min}
      max={max}
      value={draft}
      onChange={setDraft}
    />
  );
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
  const submenuHasDeferredApply = useDeferredApplyMode();
  const {content, type, options, value} = props as any;
  const [name, ...command] = content;
  const deferApply = shouldDeferApplyCommand(submenuHasDeferredApply, name);
  const controlId = `${(props as {_id?: string})._id ?? name}:${type}`;
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
            options={options}
          />
        );
      }
      if (isExactSecondCommand(name)) {
        return (
          <ExactSecondControl
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
      const rangeValue = getRangeValue(props.value, options[1]);
      if (deferApply) {
        return (
          <DeferredRangeControl
            id={controlId}
            name={name}
            min={bounds.min}
            max={bounds.max}
            value={rangeValue}
            updateRangeValue={props.updateRangeValue}
          />
        );
      }
      return (
        <AccentRange
          min={bounds.min}
          max={bounds.max}
          value={rangeValue}
          onChange={(val: number) =>
            props.updateContinuousRangeValue(name, val)
          }
          onInteractionComplete={() =>
            props.completeContinuousRangeValue(name)
          }
          onInteractionCancel={() =>
            props.completeContinuousRangeValue(name)
          }
        />
      );
    }
    case 'keycode': {
      if (deferApply) {
        return (
          <DeferredKeycodeControl
            id={controlId}
            name={name}
            command={command}
            value={props.value}
            updateValue={props.updateValue}
          />
        );
      }
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
      const toggleOptions: any[] = options || DEFAULT_TOGGLE_OPTIONS;
      if (deferApply) {
        return (
          <DeferredToggleControl
            id={controlId}
            name={name}
            command={command}
            value={props.value}
            options={toggleOptions}
            updateValue={props.updateValue}
          />
        );
      }
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
          const [label, optionValue] =
            typeof option === 'string' ? [option, idx] : option;
          return {
            value: optionValue || idx,
            label: t(label),
          };
        },
      );
      if (deferApply) {
        return (
          <DeferredDropdownControl
            id={controlId}
            name={name}
            command={command}
            value={value}
            selectOptions={selectOptions}
            updateValue={props.updateValue}
          />
        );
      }
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
          setColor={(hue, sat) =>
            props.updateContinuousValue(name, ...command, hue, sat)
          }
          onInteractionComplete={() => props.completeContinuousValue(name)}
          onInteractionCancel={() => props.completeContinuousValue(name)}
        />
      );
    }
    case 'color-palette': {
      return <ConnectedColorPalettePicker />;
    }
  }
  return null;
};
