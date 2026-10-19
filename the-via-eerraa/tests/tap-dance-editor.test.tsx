import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import i18n from 'i18next';
import {I18nextProvider} from 'react-i18next';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
import type {TapDanceDraft, TapDanceField} from '../src/utils/keycode-palette';
import {keycapLegend} from '../src/utils/keycap-legend';

// The store module graph is circular; entering it through keyboard-api first is the
// order the app itself loads it in.
await import('../src/utils/keyboard-api');
const {getTapDanceSlots, editTapDanceBehavior, withTapDanceChanges} =
  await import('../src/utils/keycode-palette');
const {TapDanceEditor} =
  await import('../src/components/inputs/keycode-palette/tap-dance-panels');

const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});

const definition = JSON.parse(
  readFileSync(
    'era-definitions/custom/v3/brick60-h7s/BRICK60-H7S-VIA.json',
    'utf8',
  ),
);
const [slot] = getTapDanceSlots(definition);
// A Tap Dance in the Legacy input start, with an action on tap and on Tap+Hold.
const legacy: TapDanceDraft = {
  actions: {tap: 43, hold: 0, dtap: 0, thold: 0x5221},
  term: '200',
  mode: 0,
};
const onPress = withTapDanceChanges(
  legacy,
  editTapDanceBehavior(legacy, {mode: 2}),
);

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

// The editor on its own, a key named by its value; what it asks for is recorded.
const mount = (draft: TapDanceDraft, saved: TapDanceDraft) => {
  const asked: unknown[] = [];
  const editor = (values: TapDanceDraft) => (
    <I18nextProvider i18n={translations}>
      <TapDanceEditor
        view={{
          slot,
          draft: values,
          saved,
          dirty: new Set<TapDanceField>(),
          focus: 0,
          termBounds: {minMs: 1, maxMs: 65535},
          termValid: true,
          canApply: true,
          applyBlockedReason: '',
          applying: false,
          error: null,
        }}
        categoryLabel="Tap Dance"
        colors={{cap: '#333', skirt: '#111', legend: '#fff'}}
        legendOf={(value) => ({
          legend: keycapLegend({
            type: 'named',
            code: String(value),
            name: String(value),
          }),
          name: String(value),
        })}
        onPickSlot={() => undefined}
        onTerm={() => undefined}
        onMode={(mode) => asked.push({mode})}
        onAddAction={(add) => asked.push({add})}
        onRemoveAction={(remove) => asked.push({remove})}
        onTiming={(timing) => asked.push(timing)}
        onCancel={() => undefined}
        onApply={() => asked.push('saved')}
      />
    </I18nextProvider>
  );
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(editor(draft));
  });
  const {root} = renderer;
  return {
    root,
    asked,
    show: (values: TapDanceDraft) => act(() => renderer.update(editor(values))),
    control: (label: string) =>
      root.find(
        (node) =>
          (node.type === 'button' || node.type === 'input') &&
          node.props['aria-label'] === label,
      ),
    actions: () =>
      root.findAll(
        (node) =>
          node.type === 'button' && node.props['aria-pressed'] !== undefined,
      ).length,
  };
};

describe('the Tap Dance editor', () => {
  // On press sends the base key at once, so a Hold of its own needs After decision,
  // and a Hold of its own keeps On press off. Firmware without Input start keeps
  // the four legacy actions and says what an update brings.
  test('adds, removes and times actions, refusing what the firmware cannot run', () => {
    const {root, asked, show, control, actions} = mount(onPress, legacy);
    expect(actions()).toBe(2);
    expect(control('Add action: On Hold').props.disabled).toBe(true);
    act(() => control('Add action: On Double Tap').props.onClick());
    act(() => control('After decision').props.onChange());
    act(() => control('Remove Tap+Hold').props.onClick());
    expect(asked).toEqual([{add: 'dtap'}, {mode: 1}, {remove: 'thold'}]);

    // The preview says what each action sends.
    act(() => control('Preview actions: TD0').props.onClick());
    show({...onPress, actions: {...onPress.actions, tap: 44}});
    expect(
      root.findAll((node) => node.type === 'td').map((node) => textOf(node)),
    ).toEqual(['44', '44', '44 → 44', '44 → 21025']);

    // The last extra action removed must not leave On press without a way back.
    show({...onPress, actions: {...onPress.actions, thold: 1}});
    expect(control('After decision').props.disabled).toBe(false);
    show({...onPress, mode: 1, actions: {...onPress.actions, hold: 0xe0}});
    expect(control('On press').props.disabled).toBe(true);

    show({...legacy, mode: undefined});
    expect(actions()).toBe(4);
    expect(textOf(root)).toContain(
      'Update firmware to use additional actions and immediate input.',
    );
  });

  test('advanced timing stages its changes and saves nothing', () => {
    const current = {...onPress, holdTerm: '0', holdOnOther: 0};
    const {root, asked, show, control} = mount(
      {...current, term: '2000'},
      current,
    );
    const settings = () =>
      root.find(
        (node) =>
          node.type === 'button' && node.children.includes('Advanced settings'),
      );
    const checkbox = (label: string) =>
      root
        .find((node) => node.type === 'label' && textOf(node) === label)
        .find((node) => node.type === 'input');

    act(() => settings().props.onClick());
    // A separate hold decision starts at the term.
    act(() =>
      checkbox('Separate hold decision time').props.onChange({
        target: {checked: true},
      }),
    );
    show({...current, term: '2000', holdTerm: '180'});
    expect(control('Hold decision').props.value).toBe('180');
    act(() =>
      control('Hold decision').props.onChange({target: {value: '137'}}),
    );
    act(() =>
      checkbox('Hold when another key is pressed').props.onChange({
        target: {checked: true},
      }),
    );
    expect(asked).toEqual([
      {holdTerm: '2000'},
      {holdTerm: '137'},
      {holdOnOther: 1},
    ]);

    // Firmware without independent timing keeps the settings shut.
    show({...current, holdTerm: undefined, holdOnOther: undefined});
    expect(settings().props.disabled).toBe(true);
  });
});
