import {useEffect, useRef} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import type {IKeycode} from 'src/utils/key';
import {
  COMPOSE_KINDS,
  COMPOSE_MODIFIERS,
  MODIFIER_LEGEND,
  toPaletteKey,
  type ComposeKind,
  type ComposeModifier,
  type ComposeResult,
} from 'src/utils/keycode-palette';
import {AccentButton, PrimaryAccentButton} from '../accent-button';
import {EmptyKeycap, KeycapView, type KeycapColors} from './palette-keycap';
import {PickerSlotButton, PickerSlotLabel} from './tap-dance-panels';
import {
  LayerChoice,
  LinePanel,
  Tab,
  TabRow,
  ToggleButton,
} from './palette-parts';

// The builder reuses VIA's own controls: the kinds are tabs like the categories
// above, the layer is picked like VIA's layer bar, modifiers are accent buttons,
// and the tap key is an ordinary 1u keycap. It is one line, read in the order of
// the key it makes: the kind, what a hold does, the tap key.

const KIND_LABEL: Record<ComposeKind, string> = {
  LT: 'Layer-Tap',
  MT: 'Mod-Tap',
  MOD: 'Modifier',
};

const KIND_HINT: Record<ComposeKind, string> = {
  LT: 'Tap: the key · Hold: a layer',
  MT: 'Tap: the key · Hold: modifiers',
  MOD: 'Sends the key with modifiers held',
};

// Without room for the whole line, what a hold does keeps the tap key beside it
// and the buttons go last.
const Line = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 24px;
`;

const Group = styled.div<{$gap: number}>`
  display: flex;
  align-items: center;
  gap: ${(props) => props.$gap}px;
  min-height: 54px;
`;

// The four modifiers take the width of their names, so the line keeps its keys.
const ModifierButton = styled(ToggleButton)`
  min-width: 72px;
`;

export type ComposeState = {
  kind: ComposeKind;
  tap: IKeycode | null;
  modifiers: ComposeModifier[];
  layer: number;
  /** The category to return to when the builder closes. */
  from: string;
};

export const ComposePanel = ({
  state,
  result,
  layerCount,
  colors,
  canPut,
  putBlockedReason,
  onTapSelect,
  onChange,
  onCancel,
  onPut,
}: {
  state: ComposeState;
  result: ComposeResult;
  layerCount: number;
  colors: Record<'alpha' | 'accent', KeycapColors>;
  /** False while there is no key to put the result on. */
  canPut: boolean;
  putBlockedReason?: string;
  onTapSelect: () => void;
  onChange: (next: Partial<ComposeState>) => void;
  onCancel: () => void;
  onPut: () => void;
}) => {
  const {t} = useTranslation();
  const {kind, tap, modifiers, layer} = state;
  const tapKey = tap ? toPaletteKey(tap) : null;
  const tapName = tap ? tap.name.replace(/\n/g, ' ') || tap.code : '';
  // Like a Tap Dance action, the operand is selected and focused when opened.
  const tapRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    tapRef.current?.focus();
  }, []);
  return (
    <LinePanel aria-label={t('Combined key')}>
      <Line>
        <TabRow $height={40} role="radiogroup" aria-label={t('Combined key')}>
          {COMPOSE_KINDS.map((id) => (
            <Tab
              key={id}
              type="button"
              role="radio"
              aria-checked={id === kind}
              $selected={id === kind}
              title={t(KIND_HINT[id])}
              onClick={() => onChange({kind: id})}
            >
              {t(KIND_LABEL[id])}
            </Tab>
          ))}
        </TabRow>
        <Group $gap={24}>
          {kind === 'LT' ? (
            <Group $gap={2} role="group" aria-label={t('On hold · layer')}>
              {Array.from({length: layerCount}, (_, index) => (
                <LayerChoice
                  key={index}
                  type="button"
                  aria-pressed={index === layer}
                  $on={index === layer}
                  onClick={() => onChange({layer: index})}
                >
                  {index}
                </LayerChoice>
              ))}
            </Group>
          ) : (
            <Group
              $gap={8}
              role="group"
              aria-label={
                kind === 'MT' ? t('On hold · modifiers') : t('Modifiers to hold')
              }
            >
              {COMPOSE_MODIFIERS.map((modifier) => {
                const on = modifiers.includes(modifier);
                return (
                  <ModifierButton
                    key={modifier}
                    type="button"
                    aria-pressed={on}
                    $on={on}
                    onClick={() =>
                      onChange({
                        modifiers: on
                          ? modifiers.filter((item) => item !== modifier)
                          : [...modifiers, modifier],
                      })
                    }
                  >
                    {MODIFIER_LEGEND[modifier]}
                  </ModifierButton>
                );
              })}
            </Group>
          )}
          <PickerSlotButton
            ref={tapRef}
            type="button"
            $focused
            aria-pressed={true}
            aria-label={tapKey ? `${t('On tap')}: ${tapName}` : t('On tap')}
            title={t('Choose a tap key')}
            onClick={onTapSelect}
          >
            {tapKey ? (
              <KeycapView
                top={tapKey.top}
                bottom={tapKey.bottom}
                colors={colors.alpha}
                glow
              />
            ) : (
              <EmptyKeycap aria-hidden="true">?</EmptyKeycap>
            )}
            <PickerSlotLabel $focused>{t('On tap')}</PickerSlotLabel>
          </PickerSlotButton>
        </Group>
        <div style={{display: 'flex', gap: 8, marginLeft: 'auto'}}>
          <AccentButton type="button" onClick={onCancel}>
            {t('Cancel')}
          </AccentButton>
          <PrimaryAccentButton
            type="button"
            disabled={result.value === null || !canPut || !!putBlockedReason}
            title={
              putBlockedReason ||
              (!tap
                ? t('Choose a tap key first')
                : result.value === null
                  ? t('Choose at least one modifier')
                  : !canPut
                    ? t('Select a key on the keyboard first')
                    : undefined)
            }
            onClick={onPut}
          >
            {t('Put in')}
          </PrimaryAccentButton>
        </div>
      </Line>
    </LinePanel>
  );
};
