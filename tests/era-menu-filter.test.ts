import {describe, expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {filterMenuTree, shouldKeepMenuControl} from '../src/utils/era-menu-filter';
import {isExactTermCommand} from '../src/utils/era-exact-ms';

const collectExactNames = (value: unknown, names: string[]) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectExactNames(item, names));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const record = value as {content?: unknown};
  if (Array.isArray(record.content) && typeof record.content[0] === 'string') {
    if (isExactTermCommand(record.content[0])) {
      names.push(record.content[0]);
    }
  }
  Object.values(record).forEach((child) => collectExactNames(child, names));
};

describe('exact/legacy term visibility', () => {
  test('capable devices keep exact IDs and hide legacy term dropdowns', () => {
    expect(shouldKeepMenuControl('id_qmk_tapping_global_term_exact', 'capable')).toBe(
      true,
    );
    expect(shouldKeepMenuControl('id_qmk_tapping_global_term', 'capable')).toBe(
      false,
    );
    expect(shouldKeepMenuControl('id_qmk_tapdance_1_term_exact', 'capable')).toBe(
      true,
    );
    expect(shouldKeepMenuControl('id_qmk_tapping_permissive_hold', 'capable')).toBe(
      true,
    );
  });

  test('legacy/unsupported/unknown keep dropdowns and hide exact ranges', () => {
    for (const capability of ['unsupported', 'unknown', 'probing', undefined] as const) {
      expect(shouldKeepMenuControl('id_qmk_tapping_global_term', capability)).toBe(
        true,
      );
      expect(
        shouldKeepMenuControl('id_qmk_tapping_global_term_exact', capability),
      ).toBe(false);
    }
  });

  test('filterMenuTree drops exact range controls unless capable', () => {
    const menus = [
      {
        label: 'TAPPING',
        content: [
          {
            label: 'Global Tapping Term',
            type: 'dropdown',
            content: ['id_qmk_tapping_global_term', 15, 1],
          },
          {
            label: 'Global Tapping Term (ms)',
            type: 'range',
            content: ['id_qmk_tapping_global_term_exact', 15, 5],
            options: [100, 500],
          },
        ],
      },
    ];
    const legacy = filterMenuTree(menus, 'unsupported');
    expect(legacy[0].content.map((item: {content: string[]}) => item.content[0])).toEqual([
      'id_qmk_tapping_global_term',
    ]);
    const exact = filterMenuTree(menus, 'capable');
    expect(exact[0].content.map((item: {content: string[]}) => item.content[0])).toEqual([
      'id_qmk_tapping_global_term_exact',
    ]);
  });

  test('canonical ERA definitions include nine exact-ms range fields', () => {
    const files = [
      'era-definitions/v3/tomak79h/TOMAK79H-L-VIA.json',
      'era-definitions/v3/tomak79h/TOMAK79H-R-VIA.json',
      'era-definitions/v3/brick60/BRICK60-H7S-VIA.JSON',
    ];
    for (const file of files) {
      const names: string[] = [];
      collectExactNames(JSON.parse(readFileSync(file, 'utf8')), names);
      expect(new Set(names).size).toBe(9);
    }
  });
});
