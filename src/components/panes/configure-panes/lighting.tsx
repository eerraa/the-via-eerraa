import styled from 'styled-components';
import {CenterPane} from '../pane';
import {
  SubmenuTab,
  SubmenuTabBar,
  TabbedBody,
  TabbedCell,
} from '../submenu-tabs';
import {title, component} from '../../icons/lightbulb';
import {GeneralPane} from './submenus/lighting/general';
import {
  LayoutConfigValues,
  Pane as LayoutPane,
} from './submenus/lighting/layout';
import {
  AdvancedLightingValues,
  AdvancedPane,
} from './submenus/lighting/advanced';
import {getLightingDefinition, isVIADefinitionV2} from '@the-via/reader';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedDefinition} from 'src/store/definitionsSlice';
import type {FC} from 'react';
import {useTranslation} from 'react-i18next';
import {useSubmenuTab} from 'src/utils/use-configure-place';

export const Category = {
  General: {label: 'General', Menu: GeneralPane},
  Layout: {label: 'Layout', Menu: LayoutPane},
  Advanced: {label: 'Advanced', Menu: AdvancedPane},
};

const LightingPane = styled(CenterPane)`
  height: 100%;
  background: var(--color_dark_grey);
`;

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 0 12px;
`;

export const Pane: FC = () => {
  const {t} = useTranslation();
  const selectedDefinition = useAppSelector(getSelectedDefinition);

  const getMenus = () => {
    if (!isVIADefinitionV2(selectedDefinition)) {
      throw new Error(
        t('This lighting component is only compatible with v2 definitions'),
      );
    }

    const hasLayouts = LayoutConfigValues.some(
      (value) =>
        getLightingDefinition(
          selectedDefinition.lighting,
        ).supportedLightingValues.indexOf(value) !== -1,
    );
    const hasAdvanced = AdvancedLightingValues.some(
      (value) =>
        getLightingDefinition(
          selectedDefinition.lighting,
        ).supportedLightingValues.indexOf(value) !== -1,
    );

    return [
      Category.General,
      ...(hasLayouts ? [Category.Layout] : []),
      ...(hasAdvanced ? [Category.Advanced] : []),
    ].filter(({Menu}) => !!Menu);
  };

  const menus = getMenus();
  const [selectedLabel, openSubmenu] = useSubmenuTab(
    title,
    menus.map(({label}) => label),
  );
  const selectedCategory =
    menus.find(({label}) => label === selectedLabel) ?? Category.General;

  return (
    <TabbedCell>
      <SubmenuTabBar label={t('Lighting')}>
        {menus.map((menu) => (
          <SubmenuTab
            key={menu.label}
            type="button"
            $selected={selectedCategory === menu}
            aria-pressed={selectedCategory === menu}
            onClick={() => openSubmenu(menu.label)}
          >
            {t(menu.label)}
          </SubmenuTab>
        ))}
      </SubmenuTabBar>
      <TabbedBody>
        <LightingPane>
          <Container>
            <selectedCategory.Menu />
          </Container>
        </LightingPane>
      </TabbedBody>
    </TabbedCell>
  );
};

export const Icon = component;
export const Title = title;
