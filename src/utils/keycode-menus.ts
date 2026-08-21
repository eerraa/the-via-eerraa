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

  return menus.map((menu) => {
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
}
