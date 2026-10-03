import React, {useState, useEffect} from 'react';
import {faPlus} from '@fortawesome/free-solid-svg-icons';
import styled from 'styled-components';
import ChippyLoader from '../chippy-loader';
import LoadingText from '../loading-text';
import {CenterPane, ConfigureBasePane} from './pane';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {
  CustomFeaturesV2,
  getLightingDefinition,
  isVIADefinitionV2,
  VIADefinitionV2,
  VIADefinitionV3,
} from '@the-via/reader';
import {isEraVIADefinitionV3} from 'src/utils/era-definition';
import {Grid, Row, IconContainer, MenuCell, ConfigureFlexCell} from './grid';
import * as Keycode from './configure-panes/keycode';
import * as Lighting from './configure-panes/lighting';
import * as Macros from './configure-panes/macros';
import * as SaveLoad from './configure-panes/save-load';
import * as Layouts from './configure-panes/layouts';
import * as RotaryEncoder from './configure-panes/custom/satisfaction75';
import {makeCustomMenus} from './configure-panes/custom/menu-generator';
import {LayerControl} from './configure-panes/layer-control';
import {Badge} from './configure-panes/badge';
import {HostKeyboardLayoutBadge} from './configure-panes/host-keyboard-layout-badge';
import {AccentButtonLarge} from '../inputs/accent-button';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedDefinition} from 'src/store/definitionsSlice';
import {
  clearSelectedKey,
  getLoadProgress,
  getNumberOfLayers,
  setConfigureKeyboardIsSelectable,
} from 'src/store/keymapSlice';
import {useDispatch} from 'react-redux';
import {reloadConnectedDevices} from 'src/store/devicesThunks';
import {getV3MenuComponents} from 'src/store/menusSlice';
import {getIsMacroFeatureSupported} from 'src/store/macrosSlice';
import {
  getConnectedDevices,
  getSelectedConnectionLocked,
  getSupportedIds,
} from 'src/store/devicesSlice';
import {isElectron} from 'src/utils/running-context';
import {useAppDispatch} from 'src/store/hooks';
import {MenuTooltip} from '../inputs/tooltip';
import {getRenderMode, getSelectedTheme} from 'src/store/settingsSlice';
import {menuKeys, useConfigureMenu} from 'src/utils/use-configure-place';
import {useTranslation} from 'react-i18next';
import {globalMenuHeight} from 'src/utils/global-menu-height';

const MenuContainer = styled.div`
  padding: 15px 10px 20px 10px;

  /* The rail's rows are buttons so the keyboard reaches them. Their own face is
     cleared to look as VIA's rows do, and keyboard focus looks as hover does. */
  > button {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    border-left: 2px solid transparent;
    background: none;
    font-family: inherit;
    font-weight: inherit;
    text-align: inherit;
  }
  > button:focus-visible {
    color: var(--color_label-highlighted);
  }
`;

const BadgeRow = styled.div`
  position: absolute;
  top: 0;
  right: 15px;

  display: flex;
  flex-direction: row;
  align-items: flex-start;

  /*
   * Constant distance between the host-layout selector
   * and the connected keyboard name.
   */
  gap: 10px;

  pointer-events: none;
  white-space: nowrap;

  @media (max-width: 720px) {
    position: static;
    flex: 1 1 auto;
    justify-content: flex-end;
    max-width: 100%;

    > div {
      min-width: 0;
      max-width: calc((100vw - 40px) / 2);
    }
    > div > button {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      box-sizing: border-box;
    }
    > div > button > span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    > div > button > svg {
      flex: none;
    }
  }
`;

const KeyboardToolbar = styled.div`
  pointer-events: all;

  @media (max-width: 720px) {
    position: absolute;
    top: 0;
    left: 15px;
    right: 15px;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 2px 10px;
  }
`;

const Rows = [
  Keycode,
  Macros,
  Layouts,
  Lighting,
  SaveLoad,
  RotaryEncoder,
  ...makeCustomMenus([]),
];

function getCustomPanes(customFeatures: CustomFeaturesV2[]) {
  if (
    customFeatures.find((feature) => feature === CustomFeaturesV2.RotaryEncoder)
  ) {
    return [RotaryEncoder];
  }

  return [];
}

const getRowsForKeyboard = (): typeof Rows => {
  const showMacros = useAppSelector(getIsMacroFeatureSupported);
  const v3Menus = useAppSelector(getV3MenuComponents);
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const numberOfLayers = useAppSelector(getNumberOfLayers);

  if (!selectedDefinition) {
    return [];
  } else if (isVIADefinitionV2(selectedDefinition)) {
    return getRowsForKeyboardV2(selectedDefinition, showMacros, numberOfLayers);
  } else if (isEraVIADefinitionV3(selectedDefinition)) {
    return [
      ...filterInferredRows(selectedDefinition, showMacros, numberOfLayers, [
        Keycode,
        Layouts,
        Macros,
        SaveLoad,
      ]),
      ...v3Menus,
    ];
  } else {
    return [];
  }
};

const filterInferredRows = (
  selectedDefinition: VIADefinitionV3 | VIADefinitionV2,
  showMacros: boolean,
  numberOfLayers: number,
  rows: typeof Rows,
): typeof Rows => {
  const {layouts} = selectedDefinition;
  let removeList: typeof Rows = [];

  // LAYOUTS IS INFERRED, filter out if doesn't exist
  if (
    !(layouts.optionKeys && Object.entries(layouts.optionKeys).length !== 0)
  ) {
    removeList = [...removeList, Layouts];
  }

  if (numberOfLayers === 0) {
    removeList = [...removeList, Keycode, SaveLoad];
  }

  if (!showMacros) {
    removeList = [...removeList, Macros];
  }

  let filteredRows = rows.filter(
    (row) => !removeList.includes(row),
  ) as typeof Rows;

  return filteredRows;
};

const getRowsForKeyboardV2 = (
  selectedDefinition: VIADefinitionV2,
  showMacros: boolean,
  numberOfLayers: number,
): typeof Rows => {
  let rows: typeof Rows = [Keycode, Layouts, Macros, SaveLoad];

  if (isVIADefinitionV2(selectedDefinition)) {
    const {lighting, customFeatures} = selectedDefinition;
    const {supportedLightingValues} = getLightingDefinition(lighting);

    if (supportedLightingValues.length !== 0) {
      rows = [...rows, Lighting];
    }

    if (customFeatures) {
      rows = [...rows, ...getCustomPanes(customFeatures)];
    }
  }

  return filterInferredRows(
    selectedDefinition,
    showMacros,
    numberOfLayers,
    rows,
  );
};

const Loader: React.FC<{
  loadProgress: number;
  selectedDefinition: VIADefinitionV2 | VIADefinitionV3 | null;
}> = (props) => {
  const {t} = useTranslation();
  const {loadProgress, selectedDefinition} = props;
  const dispatch = useAppDispatch();
  const theme = useAppSelector(getSelectedTheme);

  const connectedDevices = useAppSelector(getConnectedDevices);
  const supportedIds = useAppSelector(getSupportedIds);
  const connectionLocked = useAppSelector(getSelectedConnectionLocked);
  const noSupportedIds = !Object.values(supportedIds).length;
  const noConnectedDevices = !Object.values(connectedDevices).length;
  const [showButton, setShowButton] = useState<boolean>(false);

  useEffect(() => {
    // TODO: Remove the timeout because it is funky
    const timeout = setTimeout(() => {
      if (!selectedDefinition) {
        setShowButton(true);
      }
    }, 3000);

    return () => clearTimeout(timeout);
  }, [selectedDefinition]);

  return (
    <LoaderPane>
      {<ChippyLoader theme={theme} progress={loadProgress || null} />}

      {!connectionLocked &&
      (showButton || noConnectedDevices) &&
      !noSupportedIds &&
      !isElectron ? (
        <AccentButtonLarge
          onClick={() => dispatch(reloadConnectedDevices({authorize: true}))}
        >
          {t('Authorize device')}
          <FontAwesomeIcon style={{marginLeft: '10px'}} icon={faPlus} />
        </AccentButtonLarge>
      ) : (
        <LoadingText
          isSearching={!selectedDefinition}
          needsReconnect={connectionLocked}
        />
      )}
    </LoaderPane>
  );
};

const LoaderPane = styled(CenterPane)`
  display: flex;
  align-items: center;
  justify-content: center;
  row-gap: 50px;
  position: absolute;
  bottom: 50px;
  top: ${globalMenuHeight};
  left: 0;
  right: 0;
  z-index: 4;
`;

export const ConfigurePane = () => {
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const loadProgress = useAppSelector(getLoadProgress);
  const renderMode = useAppSelector(getRenderMode);

  const showLoader = !selectedDefinition || loadProgress !== 1;

  return showLoader ? (
    renderMode === '2D' ? (
      <Loader
        selectedDefinition={selectedDefinition || null}
        loadProgress={loadProgress}
      />
    ) : null
  ) : (
    <ConfigureBasePane>
      <ConfigureGrid />
    </ConfigureBasePane>
  );
};

const ConfigureGrid = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();

  const KeyboardRows = getRowsForKeyboard();
  const menus = menuKeys(KeyboardRows.map(({Title}) => Title));
  const [shownMenu, openMenu] = useConfigureMenu(menus, Keycode.Title);
  const selectedRow = menus.findIndex((menu) => menu === shownMenu);
  const SelectedPane = KeyboardRows[selectedRow]?.Pane;
  const selectedTitle = KeyboardRows[selectedRow]?.Title;

  useEffect(() => {
    if (selectedTitle !== 'Keymap') {
      dispatch(setConfigureKeyboardIsSelectable(false));
    } else {
      dispatch(setConfigureKeyboardIsSelectable(true));
    }
  }, [selectedTitle]);

  return (
    <>
      <ConfigureFlexCell
        onClick={(evt) => {
          if ((evt.target as any).nodeName !== 'CANVAS')
            dispatch(clearSelectedKey());
        }}
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          top: globalMenuHeight,
          left: 0,
          right: 0,
        }}
      >
        <KeyboardToolbar>
          <LayerControl />

          <BadgeRow>
            <HostKeyboardLayoutBadge />
            <Badge />
          </BadgeRow>
        </KeyboardToolbar>
      </ConfigureFlexCell>

      <Grid style={{pointerEvents: 'none'}}>
        <MenuCell style={{pointerEvents: 'all'}}>
          <MenuContainer>
            {(KeyboardRows || []).map(
              ({Icon, Title}: {Icon: any; Title: string}, idx: number) => (
                <Row
                  key={idx}
                  as="button"
                  type="button"
                  aria-label={t(Title)}
                  aria-pressed={selectedRow === idx}
                  onClick={(_) => openMenu(menus[idx])}
                  $selected={selectedRow === idx}
                >
                  <IconContainer>
                    <Icon />
                    <MenuTooltip>{t(Title)}</MenuTooltip>
                  </IconContainer>
                </Row>
              ),
            )}
          </MenuContainer>
        </MenuCell>

        {SelectedPane && <SelectedPane />}
      </Grid>
    </>
  );
};
