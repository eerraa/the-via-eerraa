import React from 'react';
import styled from 'styled-components';
import {PelpiKeycodeInput} from '../../../inputs/pelpi/keycode-input';
import {AccentButton} from '../../../inputs/accent-button';
import {AccentSlider} from '../../../inputs/accent-slider';
import {AccentSelect} from '../../../inputs/accent-select';
import {AccentRange, RangeValueDisplay} from '../../../inputs/accent-range';
import {DirtyDot} from '../../../inputs/dirty-dot';
import {ControlRow, Label, Detail} from '../../grid';
import type {VIADefinitionV2, VIADefinitionV3, VIAItem} from '@the-via/reader';
import type {LightingData} from '../../../../types/types';
import {ArrayColorPicker} from '../../../inputs/color-picker';
import {ConnectedColorPalettePicker} from 'src/components/inputs/color-palette-picker';
import {shiftFrom16Bit, shiftTo16Bit} from 'src/utils/keyboard-api';
import {useTranslation} from 'react-i18next';
import {
  decodeRangeValue,
  encodeRangeValue,
  getRangeBounds,
  type RangeControlMap,
} from 'src/utils/range-constraints';
import {
  exactTermBoundsFromOptions,
  isExactTermCommand,
} from 'src/utils/era-exact-ms';
import {type ExactMsFamily} from 'src/utils/era-advanced-metadata';
import {IntegerInput} from '../../../inputs/integer-input';
import {
  canApplyIntegerDraft,
  parseIntegerDraft,
} from 'src/utils/integer-field';
import {
  EXACT_SECOND_BOUNDS,
  isExactSecondCommand,
} from 'src/utils/era-exact-sec';
import type {DeferredItem, DeferredRow, MenuDraft} from './deferred-apply';
import {useExplainDisclosure} from 'src/components/inputs/explain';
import {findEraControlHelp} from 'src/utils/era-feature-help';
import {useIsEraDefinition} from 'src/utils/use-is-era-definition';
import {HelpBody, HelpContent} from './help-content';
import {
  ACTION_SWITCHES,
  decodeCustomMenuText,
  isCustomMenuCommandContent,
} from 'src/utils/custom-menu';

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

// A row that carries its own help, or a write the keyboard refused, wraps: the label
// and its ⓘ stay in the left column, the control stays in the right one, and the
// folded body or the refusal gets a full-width line under both. Other rows keep the
// original two-column row.
const ItemRow = styled(ControlRow)<{$wrap: boolean}>`
  flex-wrap: ${(props) => (props.$wrap ? 'wrap' : 'nowrap')};
`;

const LabelGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const RowError = styled.div`
  flex-basis: 100%;
  padding-bottom: 10px;
  line-height: 1.4;
  font-size: 16px;
  color: var(--color_error);
  text-align: right;
`;

// A dropdown's options in its own order, with the value the dropdown sends for each.
const dropdownChoices = (options: unknown) =>
  (options as ([string, number] | string)[]).map((option, idx) => {
    const [label, value] = typeof option === 'string' ? [option, idx] : option;
    return {label, value: value || idx};
  });

// The option label a dropdown holds now, found the way the dropdown itself maps
// values to options, so the help list can show which choice is in use. A row
// written on Apply holds its draft.
const currentOptionLabel = (props: any): string | null => {
  if (
    !('type' in props) ||
    props.type !== 'dropdown' ||
    !Array.isArray(props.options)
  ) {
    return null;
  }
  const selected = props.deferred
    ? props.deferred.draft
    : props.value && Array.from(props.value as ArrayLike<number>)[0];
  return (
    dropdownChoices(props.options).find(({value}) => value === selected)
      ?.label ?? null
  );
};

// A dropdown's option labels in its own order, so its help lists what it offers.
const optionLabels = (props: any): string[] | undefined =>
  'type' in props && props.type === 'dropdown' && Array.isArray(props.options)
    ? (props.options as ([string, number] | string)[]).map((option) =>
        typeof option === 'string' ? option : option[0],
      )
    : undefined;

export const VIACustomItem = React.memo(
  (props: VIACustomControlProps & {_id: string; error?: string | null}) => {
    const {t} = useTranslation();
    const eraDefinition = useIsEraDefinition();
    // An ERA definition's names read as the definition spells them, like its options
    // below, so a catalog word shared with another board never translates one row.
    const label = withoutDrawnUnit(
      eraDefinition ? props.label : t(props.label),
      props.deferred?.row,
    );
    const {deferred} = props;
    // Only for the app's own ERA definition: official and uploaded definitions can use
    // the same command names. Most controls get nothing: see `era-feature-help.ts`.
    const help = eraDefinition
      ? findEraControlHelp(
          isCustomMenuCommandContent(props.content) ? props.content[0] : null,
          props.label,
          optionLabels(props),
        )
      : null;
    const {toggle, bodyProps} = useExplainDisclosure(
      t('What this means: {{name}}', {name: label}),
    );
    const labelId = React.useId();
    const detail = (
      <Detail>
        {'type' in props ? (
          <VIACustomControl
            {...props}
            labelId={labelId}
            value={props.value && Array.from(props.value)}
          />
        ) : (
          props.content
        )}
      </Detail>
    );
    return (
      <ItemRow id={props._id} $wrap={!!help || !!props.error}>
        {help || deferred ? (
          <LabelGroup>
            <Label id={labelId}>{label}</Label>
            {deferred?.dirty ? <DirtyDot aria-hidden="true" /> : null}
            {help ? toggle : null}
          </LabelGroup>
        ) : (
          <Label id={labelId}>{label}</Label>
        )}
        {detail}
        {props.error ? <RowError role="alert">{props.error}</RowError> : null}
        {help ? (
          <HelpBody {...bodyProps}>
            <HelpContent content={help} current={currentOptionLabel(props)} />
          </HelpBody>
        ) : null}
      </ItemRow>
    );
  },
);

type ControlGetSet = {
  value: number[];
  updateValue: (
    name: string,
    ...command: number[]
  ) => void | Promise<void>;
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
  /**
   * A row written only on Apply edits a draft instead of the keyboard. It shows its
   * draft, or the saved value while it holds none.
   */
  deferred?: {
    row: DeferredRow;
    draft: MenuDraft;
    dirty: boolean;
    onDraft: (draft: MenuDraft) => void;
    /** The page's Apply, while it has something to write: Enter in a field. */
    onApply?: () => void;
  };
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

const DEFAULT_TOGGLE_OPTIONS = [0, 1];

// The exact whole-number fields: milliseconds for tapping terms, seconds for
// lighting sleep timeouts.
const integerBounds = (
  item: DeferredItem,
  exactMsFamily: ExactMsFamily | null,
) => {
  const [command] = item.content;
  if (isExactTermCommand(command)) {
    const {minMs, maxMs} = exactTermBoundsFromOptions(
      item.options,
      exactMsFamily,
    );
    return {min: minMs, max: maxMs};
  }
  return isExactSecondCommand(command) ? EXACT_SECOND_BOUNDS : null;
};

// The unit such a field draws after its number.
const integerUnit = (command: string) =>
  isExactTermCommand(command)
    ? 'ms'
    : isExactSecondCommand(command)
      ? 's'
      : null;

// A row whose field draws its unit drops the same "(ms)" or "(s)" from the end of
// its name, where a definition keeps it for official VIA, which draws none.
const withoutDrawnUnit = (label: string, row: DeferredRow | undefined) => {
  const unit = row?.bounds ? integerUnit(row.command) : null;
  const drawn = unit && ` (${unit})`;
  return drawn && label.endsWith(drawn)
    ? label.slice(0, -drawn.length)
    : label;
};

/**
 * How a row written only on Apply reads its stored value and turns a draft into
 * the value its command takes, by the kind of control the row is.
 */
export const deferredRowFor = (
  item: DeferredItem,
  menuData: Record<string, unknown>,
  exactMsFamily: ExactMsFamily | null,
): DeferredRow | null => {
  const [command, ...address] = item.content;
  const value = menuData[command] as number[] | undefined;
  const differs = (saved: MenuDraft) => (draft: MenuDraft) => draft !== saved;
  switch (item.type) {
    case 'toggle': {
      const options =
        (item.options as (number | number[])[] | undefined) ||
        DEFAULT_TOGGLE_OPTIONS;
      const saved = valueIsChecked(options[1], value || [0]);
      return {
        command,
        address,
        write: 'value',
        saved,
        bytes: (draft) => boxOrArr(options[+draft]),
        pending: differs(saved),
      };
    }
    case 'keycode': {
      const saved = shiftTo16Bit([value?.[0] ?? 0, value?.[1] ?? 0]);
      return {
        command,
        address,
        write: 'value',
        saved,
        bytes: (draft) => shiftFrom16Bit(draft as number),
        pending: differs(saved),
      };
    }
    case 'dropdown': {
      const choices = dropdownChoices(item.options);
      const {action, running, stored} = item.held ?? {};
      // The option a label names, where the definition has the label.
      const named = (label: DeferredItem | undefined) => {
        const name =
          label &&
          decodeCustomMenuText(
            menuData[label.content[0]] as number[] | undefined,
          );
        return choices.find((choice) => choice.label === name)?.value;
      };
      const inEffect = named(running);
      const kept = named(stored);
      // A held value reads as the one in effect, where the firmware reports it.
      const saved = inEffect ?? value?.[0] ?? 0;
      const row: DeferredRow = {
        command,
        address,
        write: 'value',
        saved,
        bytes: (draft) => [draft as number],
        // Until the keyboard reports a held value both in effect and kept, Apply
        // can send it, even the one shown: a speed the pair fell back to is kept
        // only that way, and a definition without the labels cannot tell.
        pending: action
          ? (draft) => draft !== inEffect || draft !== kept
          : differs(saved),
      };
      if (action) {
        const [actionCommand, ...actionAddress] = action.content;
        const actionOptions =
          (action.options as (number | number[])[] | undefined) ||
          DEFAULT_TOGGLE_OPTIONS;
        row.held = {
          action: {
            command: actionCommand,
            address: actionAddress,
            bytes: boxOrArr(actionOptions[1]),
          },
          labels: [running, stored].flatMap((label) =>
            label ? [label.content[0]] : [],
          ),
          name: (draft: MenuDraft) =>
            choices.find(({value: choice}) => choice === draft)?.label,
        };
      }
      return row;
    }
    case 'range': {
      const bounds = integerBounds(item, exactMsFamily);
      if (bounds) {
        const savedValue = getRangeValue(value ?? [0, 0], bounds.max);
        return {
          command,
          address,
          write: 'value',
          saved: String(savedValue),
          bounds,
          bytes: (draft) => {
            const parsed = parseIntegerDraft(
              String(draft),
              bounds.min,
              bounds.max,
            );
            return parsed.ok ? shiftFrom16Bit(parsed.value) : null;
          },
          pending: (draft) =>
            canApplyIntegerDraft(String(draft), savedValue, bounds),
        };
      }
      const max = (item.options as number[])[1];
      const saved = getRangeValue(value ?? [0, 0], max);
      return {
        command,
        address,
        write: 'range',
        saved,
        bytes: (draft) => encodeRangeValue(draft as number, max),
        pending: differs(saved),
      };
    }
  }
  return null;
};

const DeferredToggleControl = ({
  draft,
  onDraft,
  labelId,
}: {
  draft: boolean;
  onDraft: (checked: boolean) => void;
  labelId?: string;
}) => (
  <AccentSlider isChecked={draft} onChange={onDraft} labelledBy={labelId} />
);

const DeferredKeycodeControl = ({
  label,
  draft,
  onDraft,
  labelId,
}: {
  label: string;
  draft: number;
  onDraft: (code: number) => void;
  labelId?: string;
}) => (
  <PelpiKeycodeInput
    value={draft}
    meta={{label, labelledBy: labelId}}
    setValue={onDraft}
  />
);

const DeferredDropdownControl = ({
  selectOptions,
  draft,
  onDraft,
  labelId,
}: {
  selectOptions: {value: number; label: string}[];
  draft: number;
  onDraft: (value: number) => void;
  labelId?: string;
}) => (
  <AccentSelect
    aria-labelledby={labelId}
    onChange={(option: any) => option && onDraft(+option.value)}
    options={selectOptions}
    value={selectOptions.find((option) => draft === option.value)}
  />
);

const DeferredRangeControl = ({
  min,
  max,
  draft,
  onDraft,
  labelId,
}: {
  min: number;
  max: number;
  draft: number;
  onDraft: (value: number) => void;
  labelId?: string;
}) => (
  <AccentRange
    aria-labelledby={labelId}
    min={min}
    max={max}
    value={draft}
    onChange={onDraft}
  />
);

const VIACustomControl = (
  props: VIACustomControlProps & {
    /** The id of the row label that names the control. */
    labelId?: string;
  },
) => {
  const {t} = useTranslation();
  // An ERA definition's option names read as the definition spells them. The catalog
  // carries a few of the same words for other boards ("Neutral"), and translating
  // only those would leave one option of five in another language.
  const eraDefinition = useIsEraDefinition();
  const {content, type, options, value} = props as any;
  const {deferred, labelId} = props;
  const [name, ...command] = content;
  switch (type) {
    case 'label': {
      return (
        <RangeValueDisplay>
          {content.length === 1 ? t(content[0]) : decodeCustomMenuText(value)}
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
      const unit = integerUnit(name);
      if (unit) {
        const bounds = deferred?.row.bounds;
        if (!deferred || !bounds) {
          return null;
        }
        return (
          <IntegerInput
            draft={String(deferred.draft)}
            savedValue={Number(deferred.row.saved)}
            min={bounds.min}
            max={bounds.max}
            onDraftChange={deferred.onDraft}
            onEnter={deferred.onApply}
            ariaLabel={withoutDrawnUnit(
              eraDefinition ? props.label : t(props.label),
              deferred.row,
            )}
            suffix={unit}
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
      if (deferred) {
        return (
          <DeferredRangeControl
            min={bounds.min}
            max={bounds.max}
            draft={deferred.draft as number}
            onDraft={deferred.onDraft}
            labelId={labelId}
          />
        );
      }
      const rangeValue = getRangeValue(props.value, options[1]);
      return (
        <AccentRange
          aria-labelledby={labelId}
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
      const label = eraDefinition ? props.label : t(props.label);
      if (deferred) {
        return (
          <DeferredKeycodeControl
            label={label}
            draft={deferred.draft as number}
            onDraft={deferred.onDraft}
            labelId={labelId}
          />
        );
      }
      return (
        <PelpiKeycodeInput
          value={shiftTo16Bit([props.value[0], props.value[1]])}
          meta={{label, labelledBy: labelId}}
          setValue={(val: number) =>
            props.updateValue(name, ...command, ...shiftFrom16Bit(val))
          }
        />
      );
    }
    case 'toggle': {
      const toggleOptions: any[] = options || DEFAULT_TOGGLE_OPTIONS;
      const action = eraDefinition ? ACTION_SWITCHES.get(name) : undefined;
      if (action) {
        return (
          <AccentButton
            type="button"
            title={t(action.title)}
            onClick={() =>
              props.updateValue(name, ...command, ...boxOrArr(toggleOptions[1]))
            }
          >
            {t(action.label)}
          </AccentButton>
        );
      }
      if (deferred) {
        return (
          <DeferredToggleControl
            draft={deferred.draft as boolean}
            onDraft={deferred.onDraft}
            labelId={labelId}
          />
        );
      }
      return (
        <AccentSlider
          labelledBy={labelId}
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
            label: eraDefinition ? label : t(label),
          };
        },
      );
      if (deferred) {
        return (
          <DeferredDropdownControl
            selectOptions={selectOptions}
            draft={deferred.draft as number}
            onDraft={deferred.onDraft}
            labelId={labelId}
          />
        );
      }
      return (
        <AccentSelect
          aria-labelledby={labelId}
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
          label={eraDefinition ? props.label : t(props.label)}
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
