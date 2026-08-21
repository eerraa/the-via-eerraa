import {useEffect, useMemo, useState} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import {Button} from './button';
import TextInput from './text-input';
import {AccentButton, PrimaryAccentButton} from './accent-button';
import type {IKeycode, IKeycodeMenu} from '../../utils/key';
import {keycodeInMaster} from '../../utils/key';
import {
  clearKeycodeValue,
  composeLayerTap,
  composeModTap,
  composeModifier,
  filterKeycodeMenus,
  formatKeycodeLabel,
  isComposerCategory,
  parseKeycodeInput,
  resolveComposeBaseCode,
  selectKeycodeFromMenuCode,
} from '../../utils/keycode-picker';

const PickerRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px;
  padding-bottom: 30px;
  box-sizing: border-box;
`;

const KeycodeList = styled.div<{$picking?: boolean}>`
  display: grid;
  grid-template-columns: repeat(auto-fill, 64px);
  grid-auto-rows: 64px;
  justify-content: center;
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

const ComposePanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Hint = styled.div`
  font-size: 13px;
  line-height: 1.4;
  color: var(--color_label);
`;

const ActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  min-height: 40px;
`;

const RowLabel = styled.span`
  width: 44px;
  flex: none;
  color: var(--color_label-highlighted);
  font-size: 13px;
`;

const ChipButton = styled.button<{$on: boolean}>`
  height: 40px;
  min-width: 56px;
  padding: 0 12px;
  box-sizing: border-box;
  border-radius: 5px;
  font-size: 14px;
  cursor: pointer;
  border: 1px solid var(--color_accent);
  background: ${(props) =>
    props.$on ? 'var(--color_accent)' : 'var(--bg_outside-accent)'};
  color: ${(props) =>
    props.$on ? 'var(--color_inside-accent)' : 'var(--color_accent)'};
`;

const Resolved = styled.span`
  color: var(--color_accent);
  font-size: 13px;
`;

const CategoryNav = styled.div`
  padding: 15px 20px 20px 10px;
`;

const CategoryButton = styled.button<{$selected: boolean}>`
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: ${(props) =>
    props.$selected
      ? 'var(--color_label-highlighted)'
      : 'var(--color_label)'};
  padding: 8px 12px;
  margin-bottom: 11px;
  cursor: pointer;
  font-size: 16px;
  border-radius: 12px;
`;

const CompactInput = styled(TextInput)`
  margin: 0;
  padding: 0 10px;
  height: 40px;
  line-height: 40px;
  font-size: 16px;
  width: 180px;
  flex: none;
  box-sizing: border-box;
`;

const SearchInput = styled(CompactInput)`
  width: 220px;
  flex: 1 0 220px;
  max-width: 360px;
`;

const LayerInput = styled(CompactInput)`
  width: 56px;
  text-align: center;
`;

const Status = styled.div`
  color: var(--color_label-highlighted);
  font-size: 13px;
`;

export type KeycodePickerProps = {
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
  const [composeDraft, setComposeDraft] = useState('');
  const [pickingBase, setPickingBase] = useState(false);
  const [layer, setLayer] = useState(0);
  const [activeMods, setActiveMods] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState('');
  const [error, setError] = useState<string | null>(null);
  const showComposer = isComposerCategory(selectedCategory);

  useEffect(() => {
    if (!showComposer) {
      setPickingBase(false);
    }
  }, [showComposer]);

  const filteredMenus = useMemo(
    () => filterKeycodeMenus(menus, query),
    [menus, query],
  );
  const currentMenu =
    filteredMenus.find((menu) => menu.id === selectedCategory) ??
    filteredMenus[0];

  const currentLabel =
    value === undefined
      ? ''
      : formatKeycodeLabel(value, basicKeyToByte, byteToKey);
  const composeBaseCode = useMemo(
    () =>
      resolveComposeBaseCode(
        composeDraft,
        menus,
        basicKeyToByte,
        byteToKey,
      ),
    [composeDraft, menus, basicKeyToByte, byteToKey],
  );
  const canCompose = composeBaseCode !== null;
  const canUseModifiers = canCompose && activeMods.length > 0;

  const emit = (next: number | null) => {
    if (next === null) {
      setError('Unrecognized keycode');
      return;
    }
    setError(null);
    onSelect(next);
  };

  const renderKeycode = (keycode: IKeycode) => {
    const {code} = keycode;
    if (code === 'text') {
      return null;
    }
    return (
      <KeycodeButton
        key={code}
        disabled={
          !(showComposer && pickingBase) &&
          !keycodeInMaster(code, basicKeyToByte)
        }
        onClick={() => {
          if (showComposer && pickingBase) {
            setComposeDraft(code);
            setPickingBase(false);
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

  const selectedKeycodes = currentMenu?.keycodes ?? [];
  const isMacroCategory = currentMenu?.id === 'macro';

  return (
    <PickerRoot>
      <Toolbar>
        <SearchInput
          aria-label={t('Search keycodes')}
          placeholder={t('Search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <AccentButton
          onClick={() => {
            setQuery('');
            emit(clearKeycodeValue(basicKeyToByte));
          }}
        >
          {t('Clear')}
        </AccentButton>
      </Toolbar>
      <Status>
        {t('Current')}: {currentLabel || '—'}
      </Status>
      {renderCategoryNav ? (
        <CategoryNav>
          {filteredMenus.map((menu) => (
            <CategoryButton
              key={menu.id}
              $selected={menu.id === currentMenu?.id}
              onClick={() => setSelectedCategory(menu.id)}
            >
              {t(menu.label)}
            </CategoryButton>
          ))}
        </CategoryNav>
      ) : null}
      {isMacroCategory && !macrosSupported ? (
        <Status>
          {t(
            'Your current firmware does not support macros. Install the latest firmware for your device.',
          )}
        </Status>
      ) : (
        <KeycodeList $picking={showComposer && pickingBase}>
          {selectedKeycodes.map(renderKeycode)}
        </KeycodeList>
      )}
      {showComposer ? (
        <ComposePanel>
          <Hint>
            {pickingBase
              ? t(
                  'Click a keycode card to set the base. It will not be assigned yet.',
                )
              : t(
                  'Grid clicks assign the selected key. Compose uses the base keycode.',
                )}
          </Hint>
          <ActionRow>
            <RowLabel>{t('Tap')}</RowLabel>
            <CompactInput
              aria-label={t('Base keycode')}
              placeholder={t('KC_A, A, Esc')}
              value={composeDraft}
              onChange={(event) => setComposeDraft(event.target.value)}
            />
            {pickingBase ? (
              <PrimaryAccentButton
                aria-pressed={true}
                onClick={() => setPickingBase(false)}
              >
                {t('Pick from grid')}
              </PrimaryAccentButton>
            ) : (
              <AccentButton
                aria-pressed={false}
                onClick={() => setPickingBase(true)}
              >
                {t('Pick from grid')}
              </AccentButton>
            )}
            <Resolved>
              {composeBaseCode
                ? composeBaseCode
                : composeDraft.trim()
                  ? t('Unrecognized keycode')
                  : t('Choose a base keycode first')}
            </Resolved>
          </ActionRow>
          <ActionRow>
            <RowLabel>{t('Hold')}</RowLabel>
            {MODIFIERS.map((mod) => (
              <ChipButton
                key={mod}
                type="button"
                $on={activeMods.includes(mod)}
                aria-pressed={activeMods.includes(mod)}
                onClick={() =>
                  setActiveMods((current) =>
                    current.includes(mod)
                      ? current.filter((item) => item !== mod)
                      : [...current, mod],
                  )
                }
              >
                {mod}
              </ChipButton>
            ))}
            <AccentButton
              disabled={!canUseModifiers}
              title={
                !canCompose
                  ? t('Choose a base keycode first')
                  : t('Choose at least one modifier')
              }
              onClick={() => {
                const modifier = activeMods[0];
                if (!composeBaseCode || !modifier) {
                  return;
                }
                emit(
                  composeModifier(modifier, composeBaseCode, basicKeyToByte),
                );
              }}
            >
              {t('Modifier')}
            </AccentButton>
            <AccentButton
              disabled={!canUseModifiers}
              title={
                !canCompose
                  ? t('Choose a base keycode first')
                  : t('Choose at least one modifier')
              }
              onClick={() =>
                emit(
                  composeModTap(
                    activeMods.map((mod) => `MOD_${mod}`).join('|'),
                    composeBaseCode ?? '',
                    basicKeyToByte,
                  ),
                )
              }
            >
              {t('Mod-Tap')}
            </AccentButton>
          </ActionRow>
          <ActionRow>
            <RowLabel>{t('Layer')}</RowLabel>
            <LayerInput
              type="number"
              min={0}
              max={15}
              aria-label={t('Layer')}
              value={layer}
              onChange={(event) => setLayer(Number(event.target.value))}
            />
            <AccentButton
              disabled={!canCompose}
              title={t('Choose a base keycode first')}
              onClick={() =>
                emit(
                  composeLayerTap(
                    layer,
                    composeBaseCode ?? '',
                    basicKeyToByte,
                  ),
                )
              }
            >
              {t('Layer-Tap')}
            </AccentButton>
          </ActionRow>
          <ActionRow>
            <RowLabel>{t('Any')}</RowLabel>
            <CompactInput
              aria-label={t('Advanced keycode')}
              placeholder={t('MT(...), LT(...), 0xNNNN')}
              value={advanced}
              onChange={(event) => setAdvanced(event.target.value)}
            />
            <PrimaryAccentButton
              onClick={() => emit(parseKeycodeInput(advanced, basicKeyToByte))}
            >
              {t('Apply')}
            </PrimaryAccentButton>
          </ActionRow>
        </ComposePanel>
      ) : null}
      {error ? <Status role="alert">{t(error)}</Status> : null}
    </PickerRoot>
  );
};
