import {useId, type ReactNode} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import type {IKeycode} from 'src/utils/key';
import {
  COMPOSE_MODIFIERS,
  buildComposeResult,
  decodeComposedKeycode,
  legendModifier,
  tapLegend,
  type ComposeKind,
  type ComposeModifier,
} from 'src/utils/keycode-palette';
import {modifierLabel} from 'src/utils/keycap-legend';
import {
  getComposeKeycodeDisabledReason,
  selectKeycodeFromMenuCode,
} from 'src/utils/keycode-picker';
import {
  Section,
  SectionLabel,
  TextAction,
  ToggleButton,
  muted,
  strong,
} from './palette-parts';
import {ConfigureStatusMessage} from '../../panes/configure-panes/status-message';

// An LT·MT key is not a key of its own here but a hold put on a key: the selected
// key, or the Tap Dance action being filled, keeps the key a tap sends and takes a
// layer or modifiers for holding it. A modifier combo, which sends the key with
// modifiers, goes on the key the same way.

/** A key as the hold reads it: the key a tap sends and what is put on it. */
type HeldKey = {
  tap: IKeycode;
  /** Null for the key on its own. */
  kind: ComposeKind | null;
  layer: number;
  modifiers: ComposeModifier[];
  /** The modifiers are the right-hand ones: QMK puts all of a key's on one hand. */
  right: boolean;
};

/** The key a value taps and what is put on it; null for a key no hold goes on. */
export const readHeldKey = (
  value: number | null,
  index: Map<number, IKeycode>,
  basicKeyToByte: Record<string, number>,
): HeldKey | null => {
  if (value === null || value < 0) {
    return null;
  }
  const combined = decodeComposedKeycode(value, index, basicKeyToByte);
  // "!" is Shift+1 to the keyboard, but the palette has it as a key of its own.
  if (combined && (combined.kind !== 'MOD' || !index.has(value))) {
    return combined;
  }
  const tap = index.get(value);
  return tap && !getComposeKeycodeDisabledReason(value, basicKeyToByte)
    ? {tap, kind: null, layer: 0, modifiers: [], right: false}
    : null;
};

/** `tap` with a hold put on it, as a keycode; null where the keyboard has none. */
const heldValue = (
  tap: IKeycode,
  {kind, layer, modifiers, right}: Hold,
  basicKeyToByte: Record<string, number>,
): number | null =>
  kind === null
    ? selectKeycodeFromMenuCode(tap.code, basicKeyToByte)
    : buildComposeResult(kind, tap, layer, modifiers, basicKeyToByte, right)
        .value;

// The LT·MT tab, listed down the column as the palette's other tabs list their
// keys: what holding the key does, with how a tap is told from a hold, then the
// modifiers sent with it.
const Sheet = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;
  color: ${strong};
`;

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const PopTitle = styled.div`
  font-size: 16px;
  color: ${strong};
`;

const PopRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
`;

const Chip = styled(ToggleButton)`
  min-width: 48px;
  height: 34px;
  padding: 0 12px;
  line-height: 32px;
  font-size: 16px;
`;

const PopNote = styled.p`
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: ${muted};
`;

/** How the keyboard tells a tap from a hold, under the hold's choices. */
export const TappingFooter = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 15px;
  color: ${muted};

  > strong {
    font-weight: 400;
    color: ${strong};
  }
  > ${TextAction} {
    padding: 0 4px;
    font-size: 15px;
  }
`;

type Hold = Omit<HeldKey, 'tap'>;
const NO_HOLD: Hold = {kind: null, layer: 0, modifiers: [], right: false};

/**
 * A key's LT·MT tab: a layer or modifiers while the key is held, and modifiers
 * sent with it, each a row of toggles. A layer is one of its row; modifiers add
 * up. Pressed again, what is on comes off, and with the last of it off the key is
 * on its own again. Where no hold can go, it says why instead.
 */
export const HoldChoices = ({
  held,
  reason,
  layerCount,
  holds = true,
  blocked,
  basicKeyToByte,
  onChange,
  footer,
}: {
  /** The key and what is on it now; null where no hold can go. */
  held: HeldKey | null;
  /** Why no hold can go on the key now, or nothing. */
  reason: string;
  layerCount: number;
  /** Whether the hold's rows, LT and MT, come over the combo's. A Tap Dance action
   *  goes without them: the dance itself tells a tap from a hold. */
  holds?: boolean;
  /** Why a choice cannot go where the key is, or nothing: a Tap Dance action's limits. */
  blocked?: (value: number) => string;
  basicKeyToByte: Record<string, number>;
  onChange: (value: number) => void;
  /** Under the choices: how the keyboard tells a tap from a hold. */
  footer?: ReactNode;
}) => {
  const {t} = useTranslation();
  const holdTitle = useId();
  if (reason || !held) {
    // A state message, as the Tap Dance tab gives one.
    return (
      <ConfigureStatusMessage role="status" style={{alignSelf: 'center'}}>
        {reason}
      </ConfigureStatusMessage>
    );
  }
  const key = held;
  const kind = key.kind;
  // The row offers the layers above the base one that the keyboard has. A key
  // holding a layer outside it, layer 0 or one past the keyboard's, gets a lit
  // choice for it that takes the hold off.
  const row = Array.from(
    {length: Math.max(0, Math.min(16, layerCount) - 1)},
    (_, index) => index + 1,
  );
  const layers =
    kind === 'LT' && !row.includes(key.layer)
      ? [...row, key.layer].sort((a, b) => a - b)
      : row;
  // Modifiers add up within their kind, on the hand they are on; the last one off
  // leaves the key alone, and modifiers put on afresh are left-hand.
  const toggled = (as: 'MT' | 'MOD', modifier: ComposeModifier): Hold => {
    const current = kind === as ? key.modifiers : [];
    const modifiers = current.includes(modifier)
      ? current.filter((item) => item !== modifier)
      : [...current, modifier];
    return modifiers.length
      ? {kind: as, layer: 0, modifiers, right: kind === as && key.right}
      : NO_HOLD;
  };
  // Every choice is a toggle: `next` is what the key becomes when it is pressed.
  const choice = (id: string, label: string, next: Hold, on: boolean) => {
    const value = heldValue(key.tap, next, basicKeyToByte);
    const why = value === null ? '' : (blocked?.(value) ?? '');
    return (
      <Chip
        key={id}
        type="button"
        aria-pressed={on}
        $on={on}
        disabled={value === null || !!why}
        title={why || undefined}
        onClick={() => {
          if (value !== null && !why) {
            onChange(value);
          }
        }}
      >
        {label}
      </Chip>
    );
  };

  // The title says which key is held, for a screen reader too: it names the
  // rows of the hold as a group.
  return (
    <Sheet>
      {holds ? (
        <Group role="group" aria-labelledby={holdTitle}>
          <PopTitle id={holdTitle}>
            {t('While {{key}} is held', {
              key: tapLegend(key.tap.name) || key.tap.code,
            })}
          </PopTitle>
          {layers.length ? (
            <Section>
              <SectionLabel>{t('Layer-Tap (LT)')}</SectionLabel>
              <PopRow role="group" aria-label={t('Layer-Tap (LT)')}>
                {layers.map((layer) => {
                  const on = kind === 'LT' && key.layer === layer;
                  return choice(
                    `layer-${layer}`,
                    String(layer),
                    on
                      ? NO_HOLD
                      : {kind: 'LT', layer, modifiers: [], right: false},
                    on,
                  );
                })}
              </PopRow>
            </Section>
          ) : null}
          <Section>
            <SectionLabel>{t('Mod-Tap (MT)')}</SectionLabel>
            <PopRow role="group" aria-label={t('Mod-Tap (MT)')}>
              {COMPOSE_MODIFIERS.map((modifier) =>
                choice(
                  `mt-${modifier}`,
                  modifierLabel(
                    legendModifier(modifier),
                    kind === 'MT' && key.right,
                  ),
                  toggled('MT', modifier),
                  kind === 'MT' && key.modifiers.includes(modifier),
                ),
              )}
            </PopRow>
            <PopNote>
              {t(
                'Modifiers picked together are held together. A key put in from the list keeps the hold.',
              )}
            </PopNote>
          </Section>
          {footer}
        </Group>
      ) : null}
      <Section>
        <PopTitle>{t('Modifier combo')}</PopTitle>
        <PopRow role="group" aria-label={t('Modifier combo')}>
          {COMPOSE_MODIFIERS.map((modifier) =>
            choice(
              `mod-${modifier}`,
              modifierLabel(
                legendModifier(modifier),
                kind === 'MOD' && key.right,
              ),
              toggled('MOD', modifier),
              kind === 'MOD' && key.modifiers.includes(modifier),
            ),
          )}
        </PopRow>
        <PopNote>{t('Sends the key with modifiers held')}</PopNote>
      </Section>
    </Sheet>
  );
};
