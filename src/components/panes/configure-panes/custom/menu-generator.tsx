import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {
  faDisplay,
  faHeadphones,
  faLightbulb,
  faMicrochip,
  faSliders,
} from '@fortawesome/free-solid-svg-icons';
import React, {useEffect, useMemo, useState} from 'react';
import {AccentSlider} from '../../../inputs/accent-slider';
import {ControlRow, Label, Detail} from '../../grid';
import {MOUSE_PRECISION, hasMousePrecision, mouseExact} from 'src/utils/era-mousekey';
import styled from 'styled-components';
import {SpanOverflowCell} from '../../grid';
import {CenterPane} from '../../pane';
import {
  SubmenuTab,
  SubmenuTabBar,
  TabbedBody,
  TabbedCell,
} from '../../submenu-tabs';
import {title, component} from '../../../icons/lightbulb';
import {DirtyDot} from '../../../inputs/dirty-dot';
import {deferredRowFor, VIACustomItem} from './custom-control';
import {
  ApplyNote,
  collectDeferredItems,
  DeferredApplyButtons,
  getSelectedMenuDrafts,
  isDraftDirty,
  useDeferredApply,
  withDraftValues,
  type DeferredRow,
  type MenuDraft,
} from './deferred-apply';
import {evalExpr} from '@the-via/pelpi';
import type {
  VIAMenu,
  VIASubmenu,
  VIASubmenuSlice,
  VIAItem,
  VIAItemSlice,
} from '@the-via/reader';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {getSelectedDefinition} from 'src/store/definitionsSlice';
import {getSelectedConnectedDevice, getSelectedDevicePath, getSelectedConnectionGeneration} from 'src/store/devicesSlice';
import {getExactMsFamily} from 'src/utils/era-advanced-metadata';
import {
  awaitCustomMenuLabels,
  getSelectedCustomMenuData,
  getSelectedCustomMenuAvailability,
  getCustomRangeControlsForSelectedDefinition,
  refreshCustomMenuValue,
  completeCustomMenuRangeValueContinuous,
  completeCustomMenuValueContinuous,
  updateCustomMenuValue,
  updateCustomMenuValueContinuous,
  updateCustomMenuRangeValue,
  updateCustomMenuRangeValueContinuous,
} from 'src/store/menusSlice';
import {useTranslation} from 'react-i18next';
import {
  isCustomMenuCommandContent,
} from 'src/utils/custom-menu';
import {getEraFirmwareVersionSource} from 'src/utils/era-firmware-version';
import {useIsEraDefinition} from 'src/utils/use-is-era-definition';
import {useSubmenuTab} from 'src/utils/use-configure-place';
import {LinkApplyStatus, MenuObservation, ObservationRow, useMenuObservation} from './menu-observation';
import {LINK_RESULT, observationAddress} from 'src/utils/menu-observation';
import {FeatureHelp} from './feature-help';
import {FirmwareVersion} from './firmware-version';
import {ConfigureStatusMessage} from '../status-message';
import {rgbEffectColor, lowSaturationRgbEffectColor} from 'src/utils/rgb-white-effects';

type Category = {
  label: string;
  Menu: React.FC<any>;
  isHidden?: boolean;
  /** A row it shows holds a change that is not written yet. */
  dirty?: boolean;
};

const CustomPane = styled(CenterPane)`
  height: 100%;
  background: var(--color_dark_grey);
`;

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 0 12px;
`;

const MenuStatus: React.FC<{message: string}> = ({message}) => (
  <SpanOverflowCell>
    <CustomPane>
      <Container>
        <ConfigureStatusMessage role="status">{message}</ConfigureStatusMessage>
      </Container>
    </CustomPane>
  </SpanOverflowCell>
);

type Props = {
  viaMenu: VIAMenu;
};

function isItem(
  elem: VIAMenu | VIAItem | VIAItemSlice | VIASubmenu | VIASubmenuSlice,
): boolean {
  return 'type' in elem;
}

function isSlice(
  elem: VIAMenu | VIAItem | VIAItemSlice | VIASubmenu | VIASubmenuSlice,
): boolean {
  return !('label' in elem);
}

function categoryGenerator(props: any, t: (key: string) => string): Category[] {
  // Safety check:  return empty if data not loaded yet
  if (!props.selectedCustomMenuData) {
    return [];
  }

  // Check if the entire menu has a showIf condition
  if (
    'showIf' in props.viaMenu &&
    !evalExpr(props.viaMenu.showIf as string, props.showIfMenuData)
  ) {
    return [];
  }

  return props.viaMenu.content.flatMap((menu: any) =>
    submenuGenerator(menu, props, t),
  );
}

function itemGenerator(
  elem: TagWithId<VIAItem, VIAItemSlice>,
  props: any,
): any {
  // Safety check:  return empty if data not loaded yet
  if (!props.selectedCustomMenuData) {
    return [];
  }

  const command = itemCommand(elem);
  if (props.eraDefinition && command?.startsWith('id_qmk_mousekey_')) {
    if (command === MOUSE_PRECISION) return [];
    if (mouseExact(command)) return props.mousePrecise && 'label' in elem ? {...elem, key: elem._id} : [];
    if (props.mousePrecise) return [];
  }
  if (
    'showIf' in elem &&
    !(props.eraDefinition && observationAddress(itemCommand(elem) ?? '')) &&
    !(
      'type' in elem &&
      elem.type === 'color' &&
      props.rgbEffectColors?.has(itemCommand(elem))
    ) &&
    !evalExpr(elem.showIf as string, props.showIfMenuData)
  ) {
    return [];
  }
  if ('label' in elem) {
    return {...elem, key: elem._id};
  } else {
    return elem.content.flatMap((e) =>
      itemGenerator(e as TagWithId<VIAItem, VIAItemSlice>, props),
    );
  }
}

const itemCommand = (item: any): string | undefined =>
  isCustomMenuCommandContent(item.content) ? item.content[0] : undefined;

// Of the items a submenu shows, the rows written only on Apply, in order.
const deferredRowsOf = (
  items: any[],
  deferredRows: Map<string, DeferredRow>,
): DeferredRow[] =>
  items.flatMap((item) => {
    const command = itemCommand(item);
    const row = command && deferredRows.get(command);
    return row ? [row] : [];
  });

const MenuComponent = React.memo((props: any) => {
  const {t} = useTranslation();
  const eraDefinition = useIsEraDefinition();
  const [precise, setPrecise] = useState(false);
  const precisionLabel = React.useId();
  useEffect(() => { setPrecise(false); }, [props.precisionScope, props.selectedDefinition]);
  const precisionAvailable = eraDefinition && hasMousePrecision(props.selectedCustomMenuData) &&
    collectDeferredItems(props.elem).some((item) => mouseExact(item.content[0]));
  props = {...props, mousePrecise: precisionAvailable && precise};
  const visibleItems = props.elem.content
    .flatMap((elem: any) => itemGenerator(elem, props))
    .filter((item: any) => !props.hiddenCommands.has(itemCommand(item)));
  const rgbEffectColors = new Set<string>(
    eraDefinition
      ? visibleItems.flatMap((item: any) =>
          rgbEffectColor(item, props.selectedCustomMenuData) ?? [],
        )
      : [],
  );
  // Some definitions hide Color for rainbow effects although they still use its
  // saturation. Keep Color reachable for these effects even after the warning
  // clears, so changing saturation does not unmount a picker during a drag.
  const items = props.elem.content
    .flatMap((elem: any) => itemGenerator(elem, {...props, rgbEffectColors}))
    .filter((item: any) => !props.hiddenCommands.has(itemCommand(item)));
  const drafts: Record<string, MenuDraft> = props.menuDrafts;
  const rows = deferredRowsOf(items, props.deferredRows);
  const linkItem = eraDefinition && collectDeferredItems(props.elem).find(
    (item) => item.held?.result?.content[0] === LINK_RESULT && item.held.running,
  );
  const linkObservation = useMenuObservation(linkItem ? LINK_RESULT : undefined);
  const deferredApply = useDeferredApply(
    rows,
    collectDeferredItems(props.elem).flatMap(
      (item) => props.deferredRows.get(item.content[0]) ?? [],
    ),
    drafts,
    {
      updateValue: props.updateCustomMenuValue,
      updateRangeValue: props.updateCustomMenuRangeValue,
      awaitLabels: props.awaitCustomMenuLabels,
    },
  );
  // The keyboard changes the value it runs and the one it keeps without a CONFIG
  // revision, as when the link falls back to a slower speed, so a page showing such
  // a value reads both as it opens.
  const labelCommands = rows.flatMap(({held}) => held?.labels ?? []).join(' ');
  useEffect(() => {
    labelCommands
      .split(' ')
      .filter(Boolean)
      .forEach((command) => props.refreshCustomMenuValue(command));
  }, [labelCommands]);
  // An ERA feature menu whose rows cannot say what it is for gets one line saying so,
  // with the rest behind a disclosure. Only for the app's own ERA definition: VIA's
  // shared lighting menus use some of the same command ids.
  const commandNames = items
    .filter((item: any) => isCustomMenuCommandContent(item.content))
    .map((item: any) => item.content[0]);
  const firmwareVersionSource = getEraFirmwareVersionSource(commandNames);
  return (
    <>
      <FeatureHelp commandNames={commandNames} />
      {firmwareVersionSource ? (
        <FirmwareVersion
          source={firmwareVersionSource}
        />
      ) : (
        items.map((itemProps: any) => {
          const command = itemCommand(itemProps);
          if (linkItem && command === LINK_RESULT) {
            return <ObservationRow key={itemProps.key} label={linkItem.held!.running!.label ?? 'Current Link Speed'}
              value={linkObservation.levels?.current} />;
          }
          if (eraDefinition && command && observationAddress(command)) {
            return <MenuObservation key={itemProps.key} command={command} label={itemProps.label} />;
          }
          const row: DeferredRow | undefined =
            command && props.deferredRows.get(command);
          return (
            <VIACustomItem
              {...itemProps}
              lowSaturationRgbWarning={
                eraDefinition &&
                !!lowSaturationRgbEffectColor(itemProps, props.selectedCustomMenuData)
              }
              updateValue={deferredApply.write}
              updateContinuousValue={props.updateCustomMenuValueContinuous}
              completeContinuousValue={props.completeCustomMenuValueContinuous}
              updateContinuousRangeValue={
                props.updateCustomMenuRangeValueContinuous
              }
              completeContinuousRangeValue={
                props.completeCustomMenuRangeValueContinuous
              }
              rangeControls={props.rangeControls}
              menuData={props.selectedCustomMenuData}
              value={
                command ? props.selectedCustomMenuData[command] : undefined
              }
              deferred={
                row && {
                  row,
                  draft: drafts[row.command] ?? row.saved,
                  dirty: isDraftDirty(row, drafts[row.command]),
                  onDraft: (draft: MenuDraft) => deferredApply.edit(row, draft),
                  onApply: deferredApply.canApply
                    ? deferredApply.apply
                    : undefined,
                }
              }
              error={
                command !== undefined &&
                command === deferredApply.failedCommand
                  ? t(
                      'Could not complete this change. Settings after it were not sent.',
                    )
                  : null
              }
            />
          );
        })
      )}
      {precisionAvailable ? (
        <ControlRow>
          <Label id={precisionLabel}>
            {t('Advanced settings')}
          </Label>
          <Detail><AccentSlider labelledBy={precisionLabel} isChecked={precise} onChange={setPrecise} /></Detail>
        </ControlRow>
      ) : null}
      {!firmwareVersionSource && rows.length > 0 ? (
        <DeferredApplyButtons
          canCancel={deferredApply.canCancel}
          canApply={deferredApply.canApply}
          onCancel={deferredApply.cancel}
          onApply={deferredApply.apply}
          status={!linkItem && deferredApply.applied ? t('Applied') : undefined}
        >
          {linkItem ? <LinkApplyStatus observation={linkObservation} confirmed={deferredApply.applied} /> : null}
          {deferredApply.notApplied && (!linkItem || linkObservation.value?.status !== 'ready' ||
            !/^(Busy|Failed|Cancelled)/.test(linkObservation.value.text)) ? (
            <ApplyNote role="alert">{t('Failed')}</ApplyNote>
          ) : null}
        </DeferredApplyButtons>
      ) : null}
    </>
  );
});

const MenuBuilder = (elem: any) => (props: any) => (
  <MenuComponent {...props} key={elem._id} elem={elem} />
);

function submenuGenerator(
  elem: TagWithId<VIASubmenu, VIASubmenuSlice>,
  props: any,
  t: (key: string) => string,
): any {
  // Safety check: return empty if data not loaded yet
  if (!props.selectedCustomMenuData) {
    return [];
  }

  const isHidden =
    'showIf' in elem &&
    !evalExpr(elem.showIf as string, props.showIfMenuData);

  if ('label' in elem) {
    return {
      label: elem.label,
      dirty:
        !isHidden &&
        // A presentation toggle or showIf may hide a field, not its draft.
        // Only rows supported by the current definition/capability participate.
        deferredRowsOf(
          collectDeferredItems(elem),
          props.deferredRows,
        ).some((row) => isDraftDirty(row, props.menuDrafts[row.command])),
      Menu: isHidden
        ? () => (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                color: 'var(--color_label)',
              }}
            >
              {t('This feature is not available for this firmware version.')}
            </div>
          )
        : MenuBuilder(elem),
      isHidden,
    };
  } else {
    // For slices, filter out if hidden
    if (isHidden) {
      return [];
    }
    return elem.content.flatMap((e) =>
      submenuGenerator(e as TagWithId<VIASubmenu, VIASubmenuSlice>, props, t),
    );
  }
}

export const Pane: React.FC<Props> = (props: any) => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();
  const selectedDefinition = useAppSelector(getSelectedDefinition);
  const selectedCustomMenuData = useAppSelector(getSelectedCustomMenuData);
  const menuAvailability = useAppSelector(getSelectedCustomMenuAvailability);
  const rangeControls = useAppSelector(
    getCustomRangeControlsForSelectedDefinition,
  );
  const vendorProductId = useAppSelector(
    (state) => getSelectedConnectedDevice(state)?.vendorProductId,
  );
  const menuDrafts = useAppSelector(getSelectedMenuDrafts);
  const saveRetries = useAppSelector((state) => {
    const path = getSelectedDevicePath(state);
    return path ? state.menus.saveRetries?.[path] : undefined;
  });
  const eraDefinition = useIsEraDefinition();
  const devicePath = useAppSelector(getSelectedDevicePath);
  const connectionGeneration = useAppSelector(getSelectedConnectionGeneration);
  const deferredRows = useMemo(() => {
    const rows = new Map<string, DeferredRow>();
    if (!selectedCustomMenuData) {
      return rows;
    }
    const exactMsFamily =
      vendorProductId === undefined ? null : getExactMsFamily(vendorProductId);
    collectDeferredItems(props.viaMenu).forEach((item) => {
      // Official and uploaded definitions keep a held value's own switch.
      if (item.held && !eraDefinition) {
        return;
      }
      if (mouseExact(item.content[0]) && (!eraDefinition || !hasMousePrecision(selectedCustomMenuData))) return;
      const row = deferredRowFor(item, selectedCustomMenuData, exactMsFamily, saveRetries?.[item.content[0]]);
      if (row) {
        rows.set(row.command, row);
      }
    });
    return rows;
  }, [props.viaMenu, selectedCustomMenuData, vendorProductId, eraDefinition, saveRetries]);
  // Apply sends a held value's switch and the value reads as its labels, so none of
  // them gets a row.
  const hiddenCommands = useMemo(
    () =>
      new Set(
        [...deferredRows.values()].flatMap(({held}) =>
          held ? [held.action.command, ...held.labels] : [],
        ),
      ),
    [deferredRows],
  );
  const showIfMenuData = useMemo(
    () =>
      selectedCustomMenuData &&
      withDraftValues(selectedCustomMenuData, deferredRows, menuDrafts),
    [selectedCustomMenuData, deferredRows, menuDrafts],
  );

  const childProps = {
    ...props,
    eraDefinition,
    precisionScope: `${devicePath}:${connectionGeneration}`,
    selectedDefinition,
    selectedCustomMenuData,
    showIfMenuData,
    deferredRows,
    hiddenCommands,
    menuDrafts,
    rangeControls,
    updateCustomMenuValue: (command: string, ...rest: number[]) =>
      dispatch(updateCustomMenuValue(command, ...rest)),
    awaitCustomMenuLabels: (commands: string[], text: string, result?: string) =>
      dispatch(awaitCustomMenuLabels(commands, text, result)),
    refreshCustomMenuValue: (command: string) =>
      dispatch(refreshCustomMenuValue(command)),
    updateCustomMenuRangeValue: (command: string, value: number) =>
      dispatch(updateCustomMenuRangeValue(command, value)),
    updateCustomMenuValueContinuous: (command: string, ...rest: number[]) =>
      dispatch(updateCustomMenuValueContinuous(command, ...rest)),
    completeCustomMenuValueContinuous: (command: string) =>
      dispatch(completeCustomMenuValueContinuous(command)),
    updateCustomMenuRangeValueContinuous: (
      command: string,
      value: number,
    ) => dispatch(updateCustomMenuRangeValueContinuous(command, value)),
    completeCustomMenuRangeValueContinuous: (command: string) =>
      dispatch(completeCustomMenuRangeValueContinuous(command)),
  };

  const menus = categoryGenerator(childProps, t);

  const [selectedCategoryLabel, openSubmenu] = useSubmenuTab(
    props.viaMenu.label,
    menus.map(({label}) => label),
  );
  const selectedCategory = menus.find(
    ({label}) => label === selectedCategoryLabel,
  );

  if (!selectedDefinition) {
    return null;
  }

  if (menuAvailability === 'checking') {
    return <MenuStatus message={t('Loading...')} />;
  }

  if (menuAvailability === 'unverified') {
    return (
      <MenuStatus
        message={t(
          'Unable to verify feature support. Reconnect the keyboard. If the problem persists, update to the latest firmware.',
        )}
      />
    );
  }

  if (menuAvailability === 'failed' || !selectedCustomMenuData) {
    return (
      <MenuStatus
        message={t(
          'Unable to load feature settings. Reconnect the keyboard and try again.',
        )}
      />
    );
  }

  // Handle case where all menus are hidden
  if (menus.length === 0) {
    return (
      <SpanOverflowCell>
        <CustomPane>
          <Container>
            <ConfigureStatusMessage role="status">
              {t('No features available for this firmware version.')}
            </ConfigureStatusMessage>
          </Container>
        </CustomPane>
      </SpanOverflowCell>
    );
  }

  return (
    <TabbedCell>
      <SubmenuTabBar
        label={eraDefinition ? props.viaMenu.label : t(props.viaMenu.label)}
      >
        {menus.map((menu) => {
          const selected = selectedCategory?.label === menu.label;
          return (
            <SubmenuTab
              key={menu.label}
              type="button"
              $selected={selected}
              aria-pressed={selected}
              disabled={menu.isHidden}
              onClick={() => openSubmenu(menu.label)}
            >
              {eraDefinition ? menu.label : t(menu.label)}
              {menu.dirty ? <DirtyDot aria-hidden="true" /> : null}
            </SubmenuTab>
          );
        })}
      </SubmenuTabBar>
      <TabbedBody>
        <CustomPane>
          <Container>
            {selectedCategory ? selectedCategory.Menu(childProps) : null}
          </Container>
        </CustomPane>
      </TabbedBody>
    </TabbedCell>
  );
};

export const Icon = component;
export const Title = title;

export type IdTag = {_id: string};
export type MapIntoArr<A, C> = A extends (infer B)[] ? (C & B)[] : any;
export type IntersectKey<A, B extends keyof A, C> = A & {
  [K in B]: MapIntoArr<A[B], C>;
};
export type TagWithId<A, B extends {content: any}> =
  (IdTag & A) | IntersectKey<B, 'content', IdTag>;

export const MenuContainer = styled.div`
  padding: 15px 10px 20px 10px;
`;

export type LabelProps = {
  _type?: 'slice' | 'submenu' | 'menu';
  _id?: string;
  _renderIf?: (props: any) => boolean;
  content: any;
};

export function elemLabeler(elem: any, prefix: string = ''): any {
  if (isItem(elem)) {
    return {
      ...elem,
      ...(elem.showIf
        ? {_renderIf: (props: any) => evalExpr(elem.showIf, props)}
        : {}),
      _id: prefix,
      _type: 'item',
    };
  } else if (isSlice(elem)) {
    return {
      ...elem,
      ...(elem.showIf
        ? {_renderIf: (props: any) => evalExpr(elem.showIf, props)}
        : {}),
      _id: prefix,
      _type: 'slice',
      content: menuLabeler(elem.content, prefix),
    };
  } else {
    return {
      ...elem,
      ...(elem.showIf
        ? {_renderIf: (props: any) => evalExpr(elem.showIf, props)}
        : {}),
      _id: prefix,
      _type: 'menu',
      content: menuLabeler(elem.content, prefix),
    };
  }
}

export function menuLabeler(menus: any, prefix: string = ''): any {
  return menus.map((menu: any, idx: number) =>
    elemLabeler(menu, `${prefix}-${idx}`),
  );
}

const iconKeywords = [
  {
    icon: faLightbulb,
    keywords: ['light', 'rgb'],
  },
  {
    icon: faHeadphones,
    keywords: ['audio', 'sound'],
  },
  {
    icon: faDisplay,
    keywords: ['display', 'oled', 'lcd'],
  },
];

const getIconFromLabel = (menu: VIAMenu) => {
  const label = menu.label.toLowerCase();
  const defaultIcon = {icon: faMicrochip};
  return (
    iconKeywords.find((icon) =>
      icon.keywords.some((keyword) => label.includes(keyword)),
    ) || defaultIcon
  ).icon;
};

const menuCommands = (node: unknown): string[] => {
  if (isCustomMenuCommandContent(node)) {
    return [node[0]];
  }
  if (Array.isArray(node)) {
    return node.flatMap(menuCommands);
  }
  if (node && typeof node === 'object' && 'content' in node) {
    return menuCommands(node.content);
  }
  return [];
};

const getEraMenuIcon = (menu: VIAMenu) => {
  const commands = menuCommands(menu);
  if (commands.some((command) =>
    /^id_qmk_(ver_|system_|usb_)/.test(command),
  )) {
    return faMicrochip;
  }
  if (commands.some((command) =>
    /^id_qmk_(socd_|kill_switch_|debounce_|tapping_|mousekey_|kkuk_)/.test(command),
  )) {
    return faSliders;
  }
  return getIconFromLabel(menu);
};

export const makeCustomMenu = (menu: VIAMenu, idx: number) => {
  return {
    Title: menu.label,
    Icon: () => {
      const eraDefinition = useIsEraDefinition();
      return (
        <FontAwesomeIcon
          icon={eraDefinition ? getEraMenuIcon(menu) : getIconFromLabel(menu)}
        />
      );
    },
    Pane: (props: any) => (
      <Pane {...props} key={`${menu.label}-${idx}`} viaMenu={menu} />
    ),
  };
};
export const makeCustomMenus = (menus: VIAMenu[]) => menus.map(makeCustomMenu);
