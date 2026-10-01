import './setup';
import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
await import('../src/utils/keyboard-api');
const {
  getTapDanceSlots, planTapDanceWrites, tapDanceWriteBytes, editTapDanceBehavior,
  tapDanceVisibleRoles, tapDanceImmediate, withTapDanceChanges, pendingTapDanceChanges,
} = await import('../src/utils/keycode-palette');
const {readTapDanceDraft} = await import('../src/utils/tap-dance-values');
const {saveTapDance, planLayoutImport} = await import('../src/utils/layout-import');
import type {TapDanceDraft} from '../src/utils/keycode-palette';
const definition = JSON.parse(readFileSync('era-definitions/custom/v3/brick60-h7s/BRICK60-H7S-VIA.json', 'utf8'));
const [slot] = getTapDanceSlots(definition);
const bounds = {minMs: 1, maxMs: 65535};
const legacy: TapDanceDraft = {actions: {tap: 43, hold: 0, dtap: 0, thold: 0x5221}, term: '200', mode: 0};
describe('Tap Dance behavior and persistence', () => {
  test('requires the firmware marker and accepts only known input modes', () => {
    const data = Object.fromEntries(Object.entries(slot.actions).map(([role, command]) =>
      [command.name, [legacy.actions[role as keyof typeof legacy.actions] >> 8, legacy.actions[role as keyof typeof legacy.actions] & 255]],
    ));
    data[slot.term!.name] = [0, 200];
    for (const response of [undefined, [0, 0], [1, 0xd1], [3, 0xd2]]) {
      const read = readTapDanceDraft(slot, {...data, [slot.mode!.name]: response}, bounds);
      expect(read?.mode).toBeUndefined();
      expect(read?.actions).toEqual(legacy.actions);
    }
    for (const mode of [0, 1, 2]) {
      expect(readTapDanceDraft(slot, {...data, [slot.mode!.name]: [mode, 0xd2]}, bounds)?.mode).toBe(mode);
    }
  });

  test('an explicit edit converts legacy fallback without changing a stored unknown key', () => {
    const current = {...legacy, actions: {...legacy.actions, thold: 0xabcd}};
    expect(tapDanceVisibleRoles(current)).toEqual(['tap', 'thold']);
    const changes = editTapDanceBehavior(current, {mode: 2});
    const draft = withTapDanceChanges(current, changes);
    expect(draft).toEqual({...current, mode: 2, actions: {...current.actions, hold: 1, dtap: 1}});
    expect(current.actions.hold).toBe(0);
    expect(planTapDanceWrites(slot, draft, current, bounds, (value) => value === 1 ? 'transparent' as any : null)?.map(({id}) => id)).toEqual([2, 3, 49]);
    expect(pendingTapDanceChanges(changes, draft)).toEqual({});
  });

  test('leaves immediate mode before adding Hold, and rejects contradictory or unassigned drafts', () => {
    const current = withTapDanceChanges(legacy, editTapDanceBehavior(legacy, {mode: 2}));
    const draft = withTapDanceChanges(current, {mode: 1, hold: 0xe0, term: '137'});
    const writes = planTapDanceWrites(slot, draft, current, bounds)!;
    expect(writes.map(({id}) => id)).toEqual([49, 2, 41]);
    expect(writes.map(tapDanceWriteBytes)).toEqual([[1, 0xd2], [0, 0xe0], [0, 137]]);
    expect(planTapDanceWrites(slot, {...draft, mode: 2}, current, bounds)).toBeNull();
    expect(planTapDanceWrites(slot, withTapDanceChanges(draft, {dtap: -1}), current, bounds)).toBeNull();
    expect(planTapDanceWrites(slot, draft, {...current, mode: undefined}, bounds)).toBeNull();
  });

  test('all eight combinations share the same visible roles and distinguish silence from fallback', () => {
    for (let mask = 0; mask < 8; ++mask) {
      const draft: TapDanceDraft = {mode: 1, term: '200', actions: {tap: 43, hold: mask & 1 ? 0 : 1, dtap: mask & 2 ? 0 : 1, thold: mask & 4 ? 0 : 1}};
      expect(tapDanceVisibleRoles(draft)).toEqual(['tap', ...(['hold', 'dtap', 'thold'] as const).filter((_, i) => mask & (1 << i))]);
      expect(tapDanceImmediate(draft)).toBe(mask === 0);
    }
  });

  test('backup round-trips modes, restores legacy files, and refuses unsupported or invalid input', () => {
    const current = withTapDanceChanges(legacy, editTapDanceBehavior(legacy, {mode: 2}));
    const target = (draft: TapDanceDraft) => ({
      vendorProductId: 0x12345678, layers: [[43]], macroCount: null,
      tapDance: {slots: [slot], read: () => draft, termBounds: () => bounds, available: true},
    });
    const saved = saveTapDance(target(current).tapDance, String);
    expect(saved).toHaveProperty('tapDance.0.mode', 2);
    const file = {name: 'test', vendorProductId: 0x12345678, layers: [['43']], ...saved};
    expect(planLayoutImport(file, target(legacy), Number)).toHaveProperty('customValues.2.value', 2);
    expect(planLayoutImport(file, target({...legacy, mode: undefined}), Number)).toEqual({error: 'tap-dance-mode-unsupported'});
    const old = JSON.parse(JSON.stringify(file));
    delete old.tapDance[0].mode;
    expect(planLayoutImport(old, target(current), Number)).toHaveProperty('customValues.0.value', 0);
    const invalid = JSON.parse(JSON.stringify(file));
    invalid.tapDance[0].hold = '44';
    expect(planLayoutImport(invalid, target(current), Number)).toEqual({error: 'tap-dance-invalid'});
    for (const broken of ['unknown', '-1', '65536', '1.5', null]) {
      const malformed = JSON.parse(JSON.stringify(file));
      malformed.tapDance[0].dtap = broken;
      expect(planLayoutImport(malformed, target(current), Number)).toEqual({error: 'tap-dance-invalid'});
    }
  });

});

describe('Independent Tap Dance timing', () => {
  const current = {...withTapDanceChanges(legacy, editTapDanceBehavior(legacy, {mode: 2})), holdTerm: '0', holdOnOther: 0};
  test('only confirmed firmware exposes advanced timing, with exact wire bytes', () => {
    const data = Object.fromEntries(Object.entries(slot.actions).map(([role, command]) =>
      [command.name, [current.actions[role as keyof typeof current.actions] >> 8, current.actions[role as keyof typeof current.actions] & 255]],
    ));
    data[slot.term!.name] = [7, 208];
    data[slot.mode!.name] = [2, 0xd2, 0xd3];
    data[slot.holdTerm!.name] = [0, 180, 0xd3];
    data[slot.holdOnOther!.name] = [1, 0xd3];
    expect(readTapDanceDraft(slot, data, bounds)).toMatchObject({term: '2000', holdTerm: '180', holdOnOther: 1});
    for (const field of [slot.mode!, slot.holdTerm!, slot.holdOnOther!]) {
      expect(readTapDanceDraft(slot, {...data, [field.name]: [0, 0, 0]}, bounds)?.holdTerm).toBeUndefined();
    }
    const writes = planTapDanceWrites(slot, {...current, holdTerm: '65535', holdOnOther: 1}, current, bounds)!;
    expect(writes.map(({id}) => id)).toEqual([57, 65]);
    expect(writes.map(tapDanceWriteBytes)).toEqual([[255, 255, 0xd3], [1, 0xd3]]);
    for (const holdTerm of ['', '-1', '65536', '1.5']) {
      expect(planTapDanceWrites(slot, {...current, holdTerm}, current, bounds)).toBeNull();
    }
    expect(planTapDanceWrites(slot, {...current, holdOnOther: 2}, current, bounds)).toBeNull();
    expect(planTapDanceWrites(slot, {...current, holdTerm: '180'}, {...current, holdTerm: undefined}, bounds)).toBeNull();
  });
  test('backup preserves both settings and old files restore shared time and default interruptions', () => {
    const target = (draft: TapDanceDraft) => ({vendorProductId: 0x12345678, layers: [[43]], macroCount: null,
      tapDance: {slots: [slot], read: () => draft, termBounds: () => bounds, available: true}});
    const configured = {...current, holdTerm: '180', holdOnOther: 1};
    const saved = saveTapDance(target(configured).tapDance, String);
    expect(saved).toHaveProperty('tapDance.0.holdTerm', 180);
    expect(saved).toHaveProperty('tapDance.0.holdOnOther', 1);
    const file = {name: 'test', vendorProductId: 0x12345678, layers: [['43']], ...saved};
    const plan = planLayoutImport(file, target(current), Number);
    expect(plan).toHaveProperty('customValues.0.value', 180);
    expect(plan).toHaveProperty('customValues.1.value', 1);
    expect(planLayoutImport(file, target({...current, holdTerm: undefined, holdOnOther: undefined}), Number)).toEqual({error: 'tap-dance-mode-unsupported'});
    const old = {...file, tapDance: [{...saved.tapDance![0]}]};
    delete old.tapDance[0].holdTerm; delete old.tapDance[0].holdOnOther;
    const reset = planLayoutImport(old, target(configured), Number);
    expect(reset).toHaveProperty('customValues.0.value', 0);
    expect(reset).toHaveProperty('customValues.1.value', 0);
    expect(planLayoutImport({...file, tapDance: [{...saved.tapDance![0], holdTerm: 65536}]}, target(current), Number)).toEqual({error: 'tap-dance-invalid'});
  });
});
