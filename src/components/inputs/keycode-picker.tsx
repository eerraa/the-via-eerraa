import {useMemo, useState} from 'react';
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
  parseKeycodeInput,
  selectKeycodeFromMenuCode,
} from '../../utils/keycode-picker';

const KeycodeList = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, 64px);
  grid-auto-rows: 64px;
  justify-content: center;
  grid-gap: 10px;
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
  gap: 8px;
  align-items: center;
  padding: 0 12px 12px;
`;

const Composer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 0 12px 12px;
  color: var(--color_label-highlighted);
  font-size: 13px;
`;

const AdvancedRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 0 12px 16px;
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
  cursor: pointer;
  font-size: 16px;
`;

const SearchInput = styled(TextInput)`
  margin: 0;
  font-size: 1rem;
  width: 220px;
`;

const LayerInput = styled.input`
  width: 48px;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color_accent);
  color: var(--color_accent);
  font-size: 1rem;
`;

const Status = styled.div`
  padding: 0 12px 8px;
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
  const [tapCode, setTapCode] = useState('KC_A');
  const [layer, setLayer] = useState(0);
  const [activeMods, setActiveMods] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState('');
  const [error, setError] = useState<string | null>(null);

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
        disabled={!keycodeInMaster(code, basicKeyToByte)}
        onClick={() => {
          setTapCode(code);
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
    <div>
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
        <div>
          {filteredMenus.map((menu) => (
            <CategoryButton
              key={menu.id}
              $selected={menu.id === currentMenu?.id}
              onClick={() => setSelectedCategory(menu.id)}
            >
              {t(menu.label)}
            </CategoryButton>
          ))}
        </div>
      ) : null}
      {isMacroCategory && !macrosSupported ? (
        <Status>
          {t(
            'Your current firmware does not support macros. Install the latest firmware for your device.',
          )}
        </Status>
      ) : (
        <KeycodeList>{selectedKeycodes.map(renderKeycode)}</KeycodeList>
      )}
      <Composer>
        {MODIFIERS.map((mod) => (
          <label key={mod}>
            <input
              type="checkbox"
              checked={activeMods.includes(mod)}
              onChange={(event) =>
                setActiveMods((current) =>
                  event.target.checked
                    ? [...current, mod]
                    : current.filter((item) => item !== mod),
                )
              }
            />
            {mod}
          </label>
        ))}
        <AccentButton
          onClick={() => {
            const modifier = activeMods[0];
            emit(
              modifier
                ? composeModifier(modifier, tapCode, basicKeyToByte)
                : selectKeycodeFromMenuCode(tapCode, basicKeyToByte),
            );
          }}
        >
          {t('Modifier')}
        </AccentButton>
        <AccentButton
          onClick={() =>
            emit(
              composeModTap(
                activeMods.length
                  ? activeMods.map((mod) => `MOD_${mod}`).join('|')
                  : 'MOD_LSFT',
                tapCode,
                basicKeyToByte,
              ),
            )
          }
        >
          {t('Mod-Tap')}
        </AccentButton>
        <label>
          {t('Layer')}
          <LayerInput
            type="number"
            min={0}
            max={15}
            value={layer}
            onChange={(event) => setLayer(Number(event.target.value))}
          />
        </label>
        <AccentButton
          onClick={() =>
            emit(composeLayerTap(layer, tapCode, basicKeyToByte))
          }
        >
          {t('Layer-Tap')}
        </AccentButton>
      </Composer>
      <AdvancedRow>
        <SearchInput
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
      </AdvancedRow>
      {error ? <Status role="alert">{error}</Status> : null}
    </div>
  );
};
