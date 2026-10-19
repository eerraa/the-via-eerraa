import {
  KeycodeType,
  getLightingDefinition,
  type VIADefinitionV2,
  type VIADefinitionV3,
} from '@the-via/reader';
import {
  customKeycodeWireIndex,
  getTapDanceKeycodes,
  hasCustomKeycodeTab,
  isEraVIADefinitionV3,
  type EraVIADefinitionV3,
} from './era-definition';
import {
  categoriesForKeycodeModule,
  getKeycodes,
  getOtherMenu,
  getQMKLightingKeycodes,
  type IKeycodeMenu,
} from './key';

const maybeFilter = <M extends Function>(maybe: boolean, filter: M) =>
  maybe ? () => true : filter;

const generateKeycodeCategories = (
  basicKeyToByte: Record<string, number>,
  numMacros: number = 16,
) => getKeycodes(numMacros).concat(getOtherMenu(basicKeyToByte));

export function buildEnabledKeycodeMenus(args: {
  definition: VIADefinitionV3 | VIADefinitionV2;
  basicKeyToByte: Record<string, number>;
  protocol?: number;
  /** Null when the keyboard has no macros: the Macro category is left out. */
  macroCount?: number | null;
}): IKeycodeMenu[] {
  const {definition, basicKeyToByte, protocol = 12, macroCount = 16} = args;
  const categories = generateKeycodeCategories(basicKeyToByte, macroCount ?? 0)
    .filter(({id}) => macroCount !== null || id !== 'macro')
    .map((category) =>
      category.id === 'qmk_lighting'
        ? {
            ...category,
            keycodes: getQMKLightingKeycodes(definition, protocol),
          }
        : category,
    );

  let menus: IKeycodeMenu[];
  if (isEraVIADefinitionV3(definition)) {
    const keycodes = ['default' as const, ...(definition.keycodes || [])];
    const allowedKeycodes = keycodes.flatMap((keycodeName) =>
      categoriesForKeycodeModule(keycodeName),
    );
    if (hasCustomKeycodeTab(definition)) {
      allowedKeycodes.push('custom');
    }
    menus = categories.filter((category) =>
      allowedKeycodes.includes(category.id),
    );
  } else {
    const {lighting, customKeycodes} = definition as VIADefinitionV2;
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
          ({id}: IKeycodeMenu) => id !== 'wt_lighting',
        ),
      )
      .filter(
        maybeFilter(
          typeof customKeycodes !== 'undefined',
          ({id}: IKeycodeMenu) => id !== 'custom',
        ),
      );
  }

  const tapdanceKeycodes = getTapDanceKeycodes(
    definition as EraVIADefinitionV3,
  );
  const withCustomValues = menus.map((menu) => {
    if (menu.id !== 'custom' || !hasCustomKeycodeTab(definition)) {
      return menu;
    }
    const customKeycodes = definition.customKeycodes;
    return {
      ...menu,
      keycodes: customKeycodes.map((keycode, idx) => ({
        ...keycode,
        code: `CUSTOM(${customKeycodeWireIndex(idx, tapdanceKeycodes.length)})`,
      })),
    };
  });
  return menusWithTapDanceKeycodes(withCustomValues, tapdanceKeycodes);
}

export function menusWithTapDanceKeycodes(
  menus: IKeycodeMenu[],
  tapdanceKeycodes: {name: string; title?: string; shortName?: string}[] = [],
): IKeycodeMenu[] {
  if (!tapdanceKeycodes.length) {
    return menus;
  }
  // A tab the app draws, translated like its siblings; only the stock JSON's own
  // TAPDANCE menu keeps the definition's spelling.
  const tapdanceMenu: IKeycodeMenu = {
    id: 'tapdance',
    label: 'Tap Dance',
    width: 'label',
    keycodes: tapdanceKeycodes.map(({name, title, shortName}, idx) => ({
      name,
      ...(title !== undefined && {title}),
      ...(shortName !== undefined && {shortName}),
      code: `TD(${idx})`,
    })),
  };
  const customIndex = menus.findIndex((menu) => menu.id === 'custom');
  if (customIndex === -1) {
    return [...menus, tapdanceMenu];
  }
  return [
    ...menus.slice(0, customIndex),
    tapdanceMenu,
    ...menus.slice(customIndex),
  ];
}
