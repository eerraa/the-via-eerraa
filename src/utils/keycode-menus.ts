import {
  KeycodeType,
  getLightingDefinition,
  isVIADefinitionV3,
  type VIADefinitionV2,
  type VIADefinitionV3,
} from '@the-via/reader';
import {
  categoriesForKeycodeModule,
  getKeycodes,
  getOtherMenu,
  getQMKLightingKeycodes,
  type IKeycodeMenu,
} from './key';

const maybeFilter = <M extends Function>(maybe: boolean, filter: M) =>
  maybe ? () => true : filter;

export const generateKeycodeCategories = (
  basicKeyToByte: Record<string, number>,
  numMacros: number = 16,
) => getKeycodes(numMacros).concat(getOtherMenu(basicKeyToByte));

export function buildEnabledKeycodeMenus(args: {
  definition: VIADefinitionV3 | VIADefinitionV2;
  basicKeyToByte: Record<string, number>;
  protocol?: number;
  macroCount?: number;
}): IKeycodeMenu[] {
  const {definition, basicKeyToByte, protocol = 12, macroCount = 16} = args;
  const categories = generateKeycodeCategories(basicKeyToByte, macroCount).map(
    (category) =>
      category.id === 'qmk_lighting'
        ? {
            ...category,
            keycodes: getQMKLightingKeycodes(definition, protocol),
          }
        : category,
  );

  let menus: IKeycodeMenu[];
  if (isVIADefinitionV3(definition)) {
    const keycodes = ['default' as const, ...(definition.keycodes || [])];
    const allowedKeycodes = keycodes.flatMap((keycodeName) =>
      categoriesForKeycodeModule(keycodeName),
    );
    if ((definition.customKeycodes || []).length !== 0) {
      allowedKeycodes.push('custom');
    }
    menus = categories.filter((category) =>
      allowedKeycodes.includes(category.id),
    );
  } else {
    const {lighting, customKeycodes} = definition;
    const {keycodes} = getLightingDefinition(lighting);
    menus = categories
      .filter(
        maybeFilter(
          keycodes === KeycodeType.QMK,
          ({id}: IKeycodeMenu) => id !== 'qmk_lighting',
        ),
      )
      .filter(
        maybeFilter(
          keycodes === KeycodeType.WT,
          ({id}: IKeycodeMenu) => id !== 'lighting',
        ),
      )
      .filter(
        maybeFilter(
          typeof customKeycodes !== 'undefined',
          ({id}: IKeycodeMenu) => id !== 'custom',
        ),
      );
  }

  const withCustomValues = menus.map((menu) => {
    if (menu.id !== 'custom' || !definition.customKeycodes) {
      return menu;
    }
    return {
      ...menu,
      keycodes: definition.customKeycodes.map((keycode, idx) => ({
        ...keycode,
        code: `CUSTOM(${idx})`,
      })),
    };
  });
  return menusWithTapDanceSplit(withCustomValues);
}

export const isTapDanceCustomKeycode = (keycode: {name: string}) =>
  /^TD[0-7]$/.test(keycode.name);

export function menusWithTapDanceSplit(menus: IKeycodeMenu[]): IKeycodeMenu[] {
  const next: IKeycodeMenu[] = [];
  for (const menu of menus) {
    if (menu.id !== 'custom') {
      next.push(menu);
      continue;
    }
    const tapdance = menu.keycodes.filter(isTapDanceCustomKeycode);
    const custom = menu.keycodes.filter(
      (keycode) => !isTapDanceCustomKeycode(keycode),
    );
    if (tapdance.length) {
      next.push({
        id: 'tapdance',
        label: 'TAPDANCE',
        width: 'label',
        keycodes: tapdance,
      });
    }
    if (custom.length) {
      next.push({...menu, keycodes: custom});
    }
  }
  return next;
}
