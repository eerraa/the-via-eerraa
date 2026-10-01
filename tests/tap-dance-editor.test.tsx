import React from 'react';
import {describe, expect, test} from 'bun:test';
import {act, create} from 'react-test-renderer';
import i18n from 'i18next';
import {I18nextProvider} from 'react-i18next';
import {readFileSync} from 'node:fs';
await import('../src/utils/keyboard-api');
const {
  getTapDanceSlots, editTapDanceBehavior, withTapDanceChanges,
} = await import('../src/utils/keycode-palette');
const {TapDanceEditor} = await import('../src/components/inputs/keycode-palette/tap-dance-panels');
import type {TapDanceDraft, TapDanceField} from '../src/utils/keycode-palette';
const definition = JSON.parse(readFileSync('era-definitions/custom/v3/brick60-h7s/BRICK60-H7S-VIA.json', 'utf8'));
const [slot] = getTapDanceSlots(definition);
const bounds = {minMs: 1, maxMs: 65535};
const legacy: TapDanceDraft = {actions: {tap: 43, hold: 0, dtap: 0, thold: 0x5221}, term: '200', mode: 0};
const translations = i18n.createInstance();
await translations.init({lng: 'en', resources: {en: {translation: {}}}});

describe('Tap Dance editor', () => {
  test('the editor shows configured actions, exposes timing and disables incompatible Hold', () => {
    const draft = withTapDanceChanges(legacy, editTapDanceBehavior(legacy, {mode: 2}));
    let mode: number | undefined, added: string | undefined, removed: string | undefined;
    const render = (values: TapDanceDraft) => (
      <I18nextProvider i18n={translations}>
        <TapDanceEditor view={{slot, draft: values, saved: legacy, dirty: new Set<TapDanceField>(), focus: 0,
          termBounds: bounds, termValid: true, canApply: true, applyBlockedReason: '', applying: false,
          error: null, placed: false, canPlace: true}}
          categoryLabel="Tap Dance" colors={{cap: '#333', skirt: '#111', legend: '#fff'}}
          legendOf={(value) => ({top: String(value), bottom: '', name: String(value)})}
          onPlace={() => {}} onFocusSlot={() => {}} onTerm={() => {}}
          onMode={(value) => {mode = value;}} onAddAction={(value) => {added = value;}}
          onRemoveAction={(value) => {removed = value;}} onCancel={() => {}} onApply={() => {}} />
      </I18nextProvider>
    );
    let renderer!: ReturnType<typeof create>;
    act(() => {renderer = create(render(draft));});
    const actions = () => renderer.root.findAll((node) => node.type === 'button' && node.props['aria-pressed'] !== undefined);
    expect(actions()).toHaveLength(2);
    const helpToggle = () => renderer.root.find((node) =>
      node.type === 'button' && node.props['aria-label'] === 'What this means: Tap Dance · TD0 · Input start',
    );
    const helpBody = () => renderer.root.find((node) =>
      node.type === 'div' && node.props.id === helpToggle().props['aria-controls'],
    );
    expect(helpToggle().props['aria-expanded']).toBe(false);
    expect(helpBody().props.hidden).toBe(true);
    act(() => helpToggle().props.onClick());
    expect(helpToggle().props['aria-expanded']).toBe(true);
    expect(helpBody().props.hidden).toBe(false);
    expect(helpBody().findAllByType('dd').map((node) => node.children.join('')).join(' ')).toContain('only the second press waits.');
    expect(helpBody().findAllByType('table')).toHaveLength(0);
    const timeHelp = () => renderer.root.find((node) => node.type === 'button' && node.props['aria-label'] === 'What this means: Tap Dance · TD0 · Decision time');
    const timeBody = () => renderer.root.find((node) => node.type === 'div' && node.props.id === timeHelp().props['aria-controls']);
    const preview = () => renderer.root.find((node) => node.type === 'button' && node.props['aria-label'] === 'Preview actions: TD0');
    const previewBody = () => renderer.root.find((node) => node.type === 'div' && node.props.id === preview().props['aria-controls']);
    expect(timeBody().props.hidden).toBe(true);
    expect(previewBody().props.hidden).toBe(true);
    act(() => timeHelp().props.onClick());
    act(() => preview().props.onClick());
    expect(timeBody().props.hidden).toBe(false);
    expect(previewBody().props.hidden).toBe(false);
    expect(previewBody().findAllByType('tr')).toHaveLength(4);
    expect(timeBody().findAllByType('table')).toHaveLength(0);
    act(() => helpToggle().props.onClick());
    expect(helpBody().props.hidden).toBe(true);
    expect(timeBody().props.hidden).toBe(false);
    expect(previewBody().props.hidden).toBe(false);
    act(() => renderer.update(render({...draft, actions: {...draft.actions, tap: 44}})));
    expect(previewBody().findAllByType('td').map((node) => node.children.join(''))).toEqual(['44', '44', '44 → 44', '44 → 21025']);
    act(() => renderer.update(render(draft)));

    const add = (role: string) => renderer.root.find((node) =>
      node.type === 'button' && node.props['aria-label'] === `Add action: ${role}`,
    );
    expect(add('On Hold').props.disabled).toBe(true);
    act(() => add('On Double Tap').props.onClick());
    expect(added).toBe('dtap');
    const timing = (label: string) => renderer.root.find((node) =>
      node.type === 'input' && node.props.type === 'radio' && node.props['aria-label'] === label,
    );
    expect(timing('On press').props.checked).toBe(true);
    act(() => timing('After decision').props.onChange());
    expect(mode).toBe(1);
    act(() => renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label'] === 'Remove Tap+Hold')[0].props.onClick());
    expect(removed).toBe('thold');
    expect(JSON.stringify(renderer.toJSON())).toContain('only the second press waits.');
    act(() => renderer.update(render({...draft, actions: {...draft.actions, thold: 1}})));
    // Removing the last extra action must not strand Hold behind a hidden timing control.
    expect(timing('After decision').props.disabled).toBe(false);
    act(() => renderer.update(render({...draft, mode: 1, actions: {...draft.actions, hold: 0xe0}})));
    expect(timing('On press').props.disabled).toBe(true);

    act(() => renderer.update(render({...legacy, mode: undefined})));
    expect(actions()).toHaveLength(4);
    expect(JSON.stringify(renderer.toJSON())).toContain('Update firmware');
    act(() => renderer.unmount());
  });
});


describe('Independent Tap Dance timing', () => {
  const current = {...withTapDanceChanges(legacy, editTapDanceBehavior(legacy, {mode: 2})), holdTerm: '0', holdOnOther: 0};
  test('advanced settings stay independent from help and stage changes without saving', () => {
    let changed: unknown;
    const render = (draft: TapDanceDraft) => <I18nextProvider i18n={translations}>
      <TapDanceEditor view={{slot, draft, saved: current, dirty: new Set<TapDanceField>(), focus: 0,
        termBounds: bounds, termValid: true, canApply: true, applyBlockedReason: '', applying: false,
        error: null, placed: false, canPlace: true}}
        categoryLabel="Tap Dance" colors={{cap: '#333', skirt: '#111', legend: '#fff'}}
        legendOf={(value) => ({top: String(value), bottom: '', name: String(value)})}
        onPlace={() => {}} onFocusSlot={() => {}} onTerm={() => {}}
        onTiming={(value) => {changed = value;}} onCancel={() => {}} onApply={() => {throw Error('must remain a draft');}} />
    </I18nextProvider>;
    let renderer!: ReturnType<typeof create>;
    act(() => {renderer = create(render({...current, term: '2000'}));});
    const details = () => renderer.root.find((node) => node.type === 'button' && node.children.includes('Advanced settings'));
    const body = () => renderer.root.find((node) => node.type === 'div' && node.props.id === details().props['aria-controls']);
    const help = () => renderer.root.find((node) => node.type === 'button' && node.props['aria-label'] === 'What this means: Tap Dance · TD0 · Input start');
    const helpBody = () => renderer.root.find((node) => node.type === 'div' && node.props.id === help().props['aria-controls']);
    expect(body().props.hidden).toBe(true);
    expect(helpBody().props.hidden).toBe(true);
    act(() => help().props.onClick());
    expect(helpBody().props.hidden).toBe(false);
    expect(body().props.hidden).toBe(true);
    act(() => details().props.onClick()); expect(body().props.hidden).toBe(false);
    act(() => help().props.onClick());
    expect(helpBody().props.hidden).toBe(true);
    expect(body().props.hidden).toBe(false);
    act(() => body().findAllByType('input')[0].props.onChange({target: {checked: true}}));
    expect(changed).toEqual({holdTerm: '2000'});
    act(() => renderer.update(render({...current, term: '2000', holdTerm: '180'})));
    expect(body().findAllByType('input').some((node) => node.props['aria-label'] === 'Hold decision')).toBe(false);
    const holdField = () => renderer.root.find((node) => node.type === 'input' && node.props['aria-label'] === 'Hold decision');
    expect(holdField().props.value).toBe('180');
    act(() => details().props.onClick());
    expect(body().props.hidden).toBe(true);
    act(() => holdField().props.onChange({target: {value: '137'}}));
    expect(changed).toEqual({holdTerm: '137'});
    act(() => details().props.onClick());
    act(() => body().findAllByType('input').filter((node) => node.props.type === 'checkbox')[1].props.onChange({target: {checked: true}}));
    expect(changed).toEqual({holdOnOther: 1});
    act(() => renderer.update(render({...current, holdTerm: undefined, holdOnOther: undefined})));
    expect(details().props.disabled).toBe(true);
    expect(details().props['aria-controls']).toBeUndefined();
    act(() => renderer.unmount());
  });
});
