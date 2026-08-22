import {useEffect, useMemo, useState} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {Button} from './button';
import TextInput from './text-input';
import {AccentButton, PrimaryAccentButton} from './accent-button';
import {KeycodeModal} from './custom-keycode-modal';
import type {IKeycode, IKeycodeMenu} from '../../utils/key';
import {keycodeInMaster} from '../../utils/key';
import {
  clearKeycodeValue,
  composeLayerTap,
  composeModTap,
  composeModifiers,
  filterKeycodeMenus,
  formatKeycodeLabel,
  getComposeBaseKeycodes,
  isComposerCategory,
  keycodeMatchesQuery,
  resolveComposeBaseCode,
  selectKeycodeFromMenuCode,
} from '../../utils/keycode-picker';

const PickerRoot = styled.div<{$withCategoryNav: boolean}>`
  display: grid;
  grid-template-columns: ${(props) =>
    props.$withCategoryNav ? '148px minmax(0, 1fr)' : 'minmax(0, 1fr)'};
  align-items: start;
  gap: ${(props) => (props.$withCategoryNav ? '16px' : '0')};
  width: 100%;
  min-width: 0;
  padding: 12px;
  padding-bottom: 30px;
  box-sizing: border-box;

  @media (max-width: 760px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const PickerContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
`;

const KeycodeList = styled.div<{$picking?: boolean}>`
  display: grid;
  grid-template-columns: repeat(auto-fill, 64px);
  grid-auto-rows: 64px;
  justify-content: center;
  width: 100%;
  grid-gap: 10px;
  outline: ${(props) =>
    props.$picking ? '2px dashed var(--color_accent)' : 'none'};
  outline-offset: 8px;
  border-radius: 12px;
`;

const KeycodeButton = styled(Button)<{disabled: boolean}>`
  width: 50px;
  height: 50px;
  line-height: 18px;
  font-size: 14px;
  border: 4px solid var(--border_color_icon);
  background: var(--bg_control);
  color: var(--color_label-highlighted);
  margin: 0;
  box-shadow: none;
  border-radius: 10px;
  &:hover {
    border-color: var(--color_accent);
    transform: translate3d(0, -2px, 0);
  }
  ${(props) => props.disabled && `cursor:not-allowed;filter:opacity(50%);`}
`;

const AnyKeycodeButton = styled(KeycodeButton)`
  background: var(--color_accent);
  border-color: var(--color_inside-accent);
  color: var(--color_inside-accent);
`;

const KeycodeContent = styled.div`
  text-overflow: ellipsis;
  overflow: hidden;
`;

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 16px 20px;
  align-items: center;
`;

const ComposePanel = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid var(--border_color_icon);
  padding-top: 14px;
`;

const ComposeHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  align-items: center;
`;

const ComposeIntro = styled.div`
  min-width: 220px;
  max-width: 420px;
`;

const ComposeTitle = styled.div`
  color: var(--color_label-highlighted);
  font-size: 20px;
  line-height: 1.4;
`;

const ComposeActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
`;

const ComposeActionButton = styled(AccentButton)<{$selected: boolean}>`
  min-width: 112px;
  background: ${(props) =>
    props.$selected ? 'var(--color_accent)' : 'var(--bg_outside-accent)'};
  color: ${(props) =>
    props.$selected ? 'var(--color_inside-accent)' : 'var(--color_accent)'};
`;

const ComposeEditor = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-left: 2px solid var(--color_accent);
  padding: 4px 0 4px 14px;
`;

const Hint = styled.div`
  font-size: 14px;
  line-height: 1.4;
  color: var(--color_label);
`;

const ActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  min-height: 40px;
`;

const RowLabel = styled.span`
  width: 100px;
  flex: none;
  color: var(--color_label-highlighted);
  font-size: 18px;
`;

const InlineLabel = styled.span`
  color: var(--color_label);
  font-size: 18px;
`;

const ChipButton = styled.button<{$on: boolean}>`
  height: 40px;
  min-width: 56px;
  padding: 0 12px;
  flex: none;
  box-sizing: border-box;
  border-radius: 5px;
  font-size: 20px;
  cursor: pointer;
  border: 1px solid var(--color_accent);
  background: ${(props) =>
    props.$on ? 'var(--color_accent)' : 'var(--bg_outside-accent)'};
  color: ${(props) =>
    props.$on ? 'var(--color_inside-accent)' : 'var(--color_accent)'};
`;

const Resolved = styled.span`
  color: var(--color_accent);
  font-size: 14px;
`;

const ComposeFooter = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
`;

const Preview = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-width: 220px;
  color: var(--color_label);
  font-size: 14px;

  code {
    color: var(--color_accent);
    font-size: 14px;
  }
`;

const CategoryNav = styled.div`
  position: sticky;
  top: 0;
  align-self: start;
  padding: 4px 16px 4px 0;
  border-right: 1px solid var(--border_color_cell);
  background: var(--bg_menu);

  @media (max-width: 760px) {
    position: static;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 0 12px;
    border-right: 0;
    border-bottom: 1px solid var(--border_color_cell);
  }
`;

const CategoryButton = styled.button<{$selected: boolean}>`
  display: block;
  width: 100%;
  text-align: left;
  background: ${(props) => (props.$selected ? 'var(--bg_icon)' : 'none')};
  border: none;
  color: ${(props) =>
    props.$selected ? 'var(--color_label-highlighted)' : 'var(--color_label)'};
  padding: 8px 12px;
  margin-bottom: 11px;
  cursor: pointer;
  font-size: 20px;
  border-radius: 12px;

  @media (max-width: 760px) {
    width: auto;
    margin-bottom: 0;
  }
`;

const CompactInput = styled(TextInput)`
  margin: 0;
  padding: 0 10px;
  height: 40px;
  line-height: 40px;
  width: 200px;
  flex: none;
  box-sizing: border-box;
`;

const SearchInput = styled(CompactInput)`
  width: 220px;
  flex: 1 0 220px;
  max-width: 360px;
`;

const LayerInput = styled(CompactInput)`
  width: 64px;
  text-align: center;
`;

const CompactAccentButton = styled(AccentButton)`
  min-width: 100px;
  flex: none;
`;

const CompactPrimaryAccentButton = styled(PrimaryAccentButton)`
  min-width: 100px;
  flex: none;
`;

const Status = styled.div`
  color: var(--color_label-highlighted);
  font-size: 18px;
`;

type KeycodePickerProps = {
  menus: IKeycodeMenu[];
  basicKeyToByte: Record<string, number>;
  byteToKey: Record<number, string>;
  value?: number;
  macrosSupported?: boolean;
  onSelect: (keycode: number) => void;
  renderCategoryNav?: boolean;
  selectedCategoryId?: string;
  onSelectCategory?: (id: string) => void;
};

const MODIFIERS = ['LCTL', 'LSFT', 'LALT', 'LGUI'] as const;
const ADVANCED_KEYCODE: IKeycode = {name: 'Any', code: 'text'};
type Modifier = (typeof MODIFIERS)[number];
type ComposeKind = 'layerTap' | 'modTap' | 'modifier';

const nestModifiers = (modifiers: readonly string[], keycode: string) =>
  modifiers.reduceRight(
    (current, modifier) => `${modifier}(${current})`,
    keycode,
  );

export const KeycodePicker = ({
  menus,
  basicKeyToByte,
  byteToKey,
  value,
  macrosSupported = true,
  onSelect,
  renderCategoryNav = true,
  selectedCategoryId,
  onSelectCategory,
}: KeycodePickerProps) => {
  const {t} = useTranslation();
  const [query, setQuery] = useState('');
  const [baseQuery, setBaseQuery] = useState('');
  const [uncontrolledCategory, setUncontrolledCategory] = useState(
    menus[0]?.id ?? '',
  );
  const selectedCategory = selectedCategoryId ?? uncontrolledCategory;
  const setSelectedCategory = (id: string) => {
    onSelectCategory?.(id);
    if (selectedCategoryId === undefined) {
      setUncontrolledCategory(id);
    }
  };
  const [composeKind, setComposeKind] = useState<ComposeKind | null>(null);
  const [composeDraft, setComposeDraft] = useState('');
  const [pickingBase, setPickingBase] = useState(false);
  const [layer, setLayer] = useState(0);
  const [activeMods, setActiveMods] = useState<Modifier[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showComposer = isComposerCategory(selectedCategory);

  useEffect(() => {
    if (!showComposer) {
      setComposeKind(null);
      setPickingBase(false);
    }
  }, [showComposer]);

  const menusWithAdvanced = useMemo(
    () =>
      menus.map((menu) =>
        menu.id === 'special' &&
        !menu.keycodes.some((keycode) => keycode.code === 'text')
          ? {...menu, keycodes: [...menu.keycodes, ADVANCED_KEYCODE]}
          : menu,
      ),
    [menus],
  );
  const filteredMenus = useMemo(
    () => filterKeycodeMenus(menusWithAdvanced, query),
    [menusWithAdvanced, query],
  );
  const currentMenu =
    filteredMenus.find((menu) => menu.id === selectedCategory) ??
    filteredMenus[0];
  const composeBaseKeycodes = useMemo(
    () =>
      getComposeBaseKeycodes(menus, basicKeyToByte).filter((keycode) =>
        keycodeMatchesQuery(keycode, baseQuery),
      ),
    [menus, basicKeyToByte, baseQuery],
  );

  const currentLabel =
    value === undefined
      ? ''
      : formatKeycodeLabel(value, basicKeyToByte, byteToKey);
  const composeBaseCode = useMemo(
    () =>
      resolveComposeBaseCode(composeDraft, menus, basicKeyToByte, byteToKey),
    [composeDraft, menus, basicKeyToByte, byteToKey],
  );
  const orderedActiveMods = MODIFIERS.filter((modifier) =>
    activeMods.includes(modifier),
  );
  const hasValidLayer = Number.isInteger(layer) && layer >= 0 && layer <= 15;
  const canCompose = composeBaseCode !== null;
  const canApply =
    canCompose &&
    (composeKind === 'layerTap' ? hasValidLayer : orderedActiveMods.length > 0);
  const previewBase = composeBaseCode ?? 'kc';
  const composePreview =
    composeKind === 'layerTap'
      ? `LT(${layer},${previewBase})`
      : composeKind === 'modTap'
        ? `MT(${
            orderedActiveMods
              .map((modifier) => `MOD_${modifier}`)
              .join(' | ') || 'mods'
          },${previewBase})`
        : nestModifiers(
            orderedActiveMods.length ? orderedActiveMods : ['modifier'],
            previewBase,
          );
  const composeHint =
    composeKind === 'layerTap'
      ? t('Tap sends the chosen key. Hold activates the layer.')
      : composeKind === 'modTap'
        ? t('Tap sends the chosen key. Hold applies the selected modifiers.')
        : t('Send the chosen key with the selected modifiers.');

  const emit = (next: number | null) => {
    if (next === null) {
      setError('Unrecognized keycode');
      return false;
    }
    setError(null);
    onSelect(next);
    return true;
  };

  const openComposer = (kind: ComposeKind) => {
    setComposeKind(kind);
    setPickingBase(false);
    setError(null);
  };

  const applyCompose = () => {
    if (!composeKind || !composeBaseCode) {
      setError('Unrecognized keycode');
      return;
    }

    const next =
      composeKind === 'layerTap'
        ? composeLayerTap(layer, composeBaseCode, basicKeyToByte)
        : composeKind === 'modTap'
          ? composeModTap(
              orderedActiveMods.map((modifier) => `MOD_${modifier}`).join('|'),
              composeBaseCode,
              basicKeyToByte,
            )
          : composeModifiers(
              orderedActiveMods,
              composeBaseCode,
              basicKeyToByte,
            );

    if (emit(next)) {
      setComposeKind(null);
      setPickingBase(false);
    }
  };

  const openAdvanced = () => {
    setShowAdvanced(true);
  };

  const renderKeycode = (keycode: IKeycode) => {
    const {code} = keycode;
    if (code === 'text') {
      return (
        <AnyKeycodeButton
          key={code}
          disabled={false}
          onClick={openAdvanced}
          title={t('Advanced keycode')}
        >
          <KeycodeContent>{t('Any')}</KeycodeContent>
        </AnyKeycodeButton>
      );
    }
    return (
      <KeycodeButton
        key={code}
        disabled={!pickingBase && !keycodeInMaster(code, basicKeyToByte)}
        onClick={() => {
          if (pickingBase) {
            setComposeDraft(code);
            setPickingBase(false);
            setBaseQuery('');
            setError(null);
            return;
          }
          emit(selectKeycodeFromMenuCode(code, basicKeyToByte));
        }}
      >
        <KeycodeContent>{keycode.name}</KeycodeContent>
      </KeycodeButton>
    );
  };

  const selectedKeycodes = pickingBase
    ? composeBaseKeycodes
    : (currentMenu?.keycodes ?? []);
  const isMacroCategory = !pickingBase && currentMenu?.id === 'macro';
  const showCategoryNav = renderCategoryNav && !pickingBase;

  return (
    <PickerRoot $withCategoryNav={showCategoryNav}>
      {showCategoryNav ? (
        <CategoryNav aria-label={t('Keycode categories')}>
          {filteredMenus.map((menu) => (
            <CategoryButton
              key={menu.id}
              $selected={menu.id === currentMenu?.id}
              aria-pressed={menu.id === currentMenu?.id}
              onClick={() => setSelectedCategory(menu.id)}
            >
              {t(menu.label)}
            </CategoryButton>
          ))}
        </CategoryNav>
      ) : null}
      <PickerContent>
        {pickingBase ? (
          <Toolbar>
            <SearchInput
              aria-label={t('Search keycodes')}
              placeholder={t('Search')}
              value={baseQuery}
              onChange={(event) => setBaseQuery(event.target.value)}
            />
            <CompactAccentButton
              onClick={() => {
                setPickingBase(false);
                setBaseQuery('');
              }}
            >
              {t('Back to Layers')}
            </CompactAccentButton>
          </Toolbar>
        ) : (
          <Toolbar>
            <SearchInput
              aria-label={t('Search keycodes')}
              placeholder={t('Search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <CompactAccentButton
              onClick={() => {
                setQuery('');
                emit(clearKeycodeValue(basicKeyToByte));
              }}
            >
              {t('Clear')}
            </CompactAccentButton>
          </Toolbar>
        )}
        <Status>
          {t('Current')}: {currentLabel || '—'}
        </Status>
        {pickingBase ? (
          <Hint role="status">
            {t('Choose a tap key from the grid. It will not be assigned yet.')}
          </Hint>
        ) : null}
        {isMacroCategory && !macrosSupported ? (
          <Status>
            {t(
              'Your current firmware does not support macros. Install the latest firmware for your device.',
            )}
          </Status>
        ) : (
          <KeycodeList $picking={pickingBase}>
            {selectedKeycodes.map(renderKeycode)}
          </KeycodeList>
        )}
        {showComposer && !pickingBase ? (
          <ComposePanel aria-label={t('Compose')}>
            <ComposeHeader>
              <ComposeIntro>
                <ComposeTitle>{t('Compose')}</ComposeTitle>
                <Hint>
                  {t('Choose a behavior, then set its key and hold action.')}
                </Hint>
              </ComposeIntro>
              <ComposeActions>
                <ComposeActionButton
                  $selected={composeKind === 'layerTap'}
                  aria-pressed={composeKind === 'layerTap'}
                  onClick={() => openComposer('layerTap')}
                >
                  {t('Layer-Tap')}
                </ComposeActionButton>
                <ComposeActionButton
                  $selected={composeKind === 'modTap'}
                  aria-pressed={composeKind === 'modTap'}
                  onClick={() => openComposer('modTap')}
                >
                  {t('Mod-Tap')}
                </ComposeActionButton>
                <ComposeActionButton
                  $selected={composeKind === 'modifier'}
                  aria-pressed={composeKind === 'modifier'}
                  onClick={() => openComposer('modifier')}
                >
                  {t('Modifier')}
                </ComposeActionButton>
              </ComposeActions>
            </ComposeHeader>
            {composeKind ? (
              <ComposeEditor>
                <Hint>{composeHint}</Hint>
                <ActionRow>
                  <RowLabel>
                    {composeKind === 'modifier' ? t('Key') : t('Tap')}
                  </RowLabel>
                  <CompactInput
                    aria-label={t('Base keycode')}
                    placeholder={t('KC_A, A, Esc')}
                    value={composeDraft}
                    onChange={(event) => setComposeDraft(event.target.value)}
                  />
                  <CompactAccentButton
                    onClick={() => {
                      setBaseQuery('');
                      setPickingBase(true);
                    }}
                  >
                    {t('Pick from grid')}
                  </CompactAccentButton>
                  <Resolved>
                    {composeBaseCode
                      ? composeBaseCode
                      : composeDraft.trim()
                        ? t('Unrecognized keycode')
                        : t('Choose a base keycode first')}
                  </Resolved>
                </ActionRow>
                {composeKind === 'layerTap' ? (
                  <ActionRow>
                    <RowLabel>{t('Hold')}</RowLabel>
                    <InlineLabel>{t('Layer')}</InlineLabel>
                    <LayerInput
                      type="number"
                      min={0}
                      max={15}
                      aria-label={t('Layer')}
                      value={layer}
                      onChange={(event) => setLayer(Number(event.target.value))}
                    />
                  </ActionRow>
                ) : (
                  <ActionRow>
                    <RowLabel>
                      {composeKind === 'modifier' ? t('Modifier') : t('Hold')}
                    </RowLabel>
                    {MODIFIERS.map((modifier) => (
                      <ChipButton
                        key={modifier}
                        type="button"
                        $on={activeMods.includes(modifier)}
                        aria-pressed={activeMods.includes(modifier)}
                        onClick={() =>
                          setActiveMods((current) =>
                            current.includes(modifier)
                              ? current.filter((item) => item !== modifier)
                              : [...current, modifier],
                          )
                        }
                      >
                        {modifier}
                      </ChipButton>
                    ))}
                  </ActionRow>
                )}
                <ComposeFooter>
                  <Preview>
                    <span>{t('Preview')}:</span>
                    <code>{composePreview}</code>
                  </Preview>
                  <CompactAccentButton
                    onClick={() => {
                      setComposeKind(null);
                      setPickingBase(false);
                    }}
                  >
                    {t('Cancel')}
                  </CompactAccentButton>
                  <CompactPrimaryAccentButton
                    disabled={!canApply}
                    title={
                      !canCompose
                        ? t('Choose a base keycode first')
                        : orderedActiveMods.length === 0 &&
                            composeKind !== 'layerTap'
                          ? t('Choose at least one modifier')
                          : ''
                    }
                    onClick={applyCompose}
                  >
                    {t('Apply')}
                  </CompactPrimaryAccentButton>
                </ComposeFooter>
              </ComposeEditor>
            ) : null}
          </ComposePanel>
        ) : null}
        {error ? <Status role="alert">{t(error)}</Status> : null}
      </PickerContent>
      {showAdvanced ? (
        <KeycodeModal
          defaultValue={value}
          onExit={() => setShowAdvanced(false)}
          onConfirm={(next) => {
            setError(null);
            setShowAdvanced(false);
            onSelect(next);
          }}
        />
      ) : null}
    </PickerRoot>
  );
};
