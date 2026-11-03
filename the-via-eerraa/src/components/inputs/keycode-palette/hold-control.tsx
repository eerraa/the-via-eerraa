import {useId, type ReactNode} from 'react';
import styled from 'styled-components';
import {useTranslation} from 'react-i18next';
import type {IKeycode} from 'src/utils/key';
import {
  COMPOSE_MODIFIERS,
  buildComposeResult,
  decodeComposedKeycode,
  isModifierKey,
  layerModModifier,
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
import {ExplainRow, useExplainDisclosure} from '../explain';
import {
  HelpBody,
  HelpContent,
} from '../../panes/configure-panes/custom/help-content';

// An LT·MT key is not a key of its own here but a hold put on a key: the selected
// key, or the Tap Dance action being filled, keeps the key a tap sends and takes a
// layer or modifiers for holding it. A modifier combo, which sends the key with
// modifiers, goes on the key the same way, and so does a Layer-Mod on a modifier
// key, which holds its modifier with the layer.

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

// The LT·MT·LM tab, listed down the column as the palette's other tabs list their
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

// A row's name with the ⓘ that opens what the row does under it, in the paragraphs
// and column a Configure menu's help opens in: the rows carry no other explanation.
const RowName = ({
  name,
  help,
  title = false,
}: {
  name: string;
  /** Catalog keys of the help's paragraphs. */
  help: readonly string[];
  /** The name is a group's title, not a row's label. */
  title?: boolean;
}) => {
  const {t} = useTranslation();
  const {toggle, bodyProps} = useExplainDisclosure(
    t('What this means: {{name}}', {name}),
  );
  return (
    <ExplainRow>
      {title ? <PopTitle>{name}</PopTitle> : <SectionLabel>{name}</SectionLabel>}
      {toggle}
      <HelpBody {...bodyProps}>
        <HelpContent content={{detail: help}} />
      </HelpBody>
    </ExplainRow>
  );
};

// Each row's help: what it does, then an example or what else to know.
const LT_HELP = [
  'Tapped, it sends the key; held, it turns only the layer on, with no modifier held.',
  'A key put in from the list keeps the hold.',
];
const LM_HELP = [
  'Held, it turns the layer on with this modifier held.',
  'For example, with layer 2 on Alt and F4 where 4 is on layer 2, Alt+4 sends Alt+F4.',
];
const MT_HELP = [
  'Tapped, it sends the key; held, it holds the modifiers picked.',
  'Modifiers picked together are held together, and a key put in from the list keeps the hold.',
];
const COMBO_HELP = [
  'Each press sends the key with the modifiers picked held.',
  'For example, Ctrl picked on C sends Ctrl+C.',
];

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
 * A key's LT·MT·LM tab: a layer or modifiers while the key is held, and modifiers
 * sent with it, each a row of toggles whose name opens what the row does. A
 * modifier key also has a Layer-Mod row: the layer with its own modifier held;
 * any other key asks for one in its place. A layer is one of its row; modifiers
 * add up. Pressed again, what is on comes off, and with the last of it off the key
 * is on its own again. Where no hold can go, it says why instead.
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
  const keyName = tapLegend(key.tap.name) || key.tap.code;
  // The row offers the layers above the base one that the keyboard has. A key
  // holding a layer outside it, layer 0 or one past the keyboard's, gets a lit
  // choice for it that takes the hold off.
  const row = Array.from(
    {length: Math.max(0, Math.min(16, layerCount) - 1)},
    (_, index) => index + 1,
  );
  // Only a modifier key can be a Layer-Mod, which holds its own modifier.
  const layerMod = layerModModifier(key.tap.code, basicKeyToByte);
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
  // A row of layers, Layer-Tap's or Layer-Mod's: one is on at a time.
  const layerRow = (
    as: 'LT' | 'LM',
    label: string,
    help: readonly string[],
    hold: (layer: number) => Hold,
  ) => {
    const layers =
      kind === as && !row.includes(key.layer)
        ? [...row, key.layer].sort((a, b) => a - b)
        : row;
    return layers.length ? (
      <Section>
        <RowName name={label} help={help} />
        <PopRow role="group" aria-label={label}>
          {layers.map((layer) => {
            const on = kind === as && key.layer === layer;
            return choice(
              `${as}-${layer}`,
              String(layer),
              on ? NO_HOLD : hold(layer),
              on,
            );
          })}
        </PopRow>
      </Section>
    ) : null;
  };

  // The title says which key is held, for a screen reader too: it names the
  // rows of the hold as a group.
  return (
    <Sheet>
      {holds ? (
        <Group role="group" aria-labelledby={holdTitle}>
          <PopTitle id={holdTitle}>
            {t('While {{key}} is held', {key: keyName})}
          </PopTitle>
          {layerRow('LT', t('Layer-Tap (LT)'), LT_HELP, (layer) => ({
            kind: 'LT',
            layer,
            modifiers: [],
            right: false,
          }))}
          {layerMod
            ? layerRow('LM', t('Layer-Mod (LM)'), LM_HELP, (layer) => ({
                kind: 'LM',
                layer,
                modifiers: [layerMod.modifier],
                right: layerMod.right,
              }))
            : row.length > 0 && (
                // Any other key asks for a key with a modifier on it in the row's
                // place, and a right-hand modifier key where the protocol's LM has
                // no hand asks for a left-hand one.
                <Section>
                  <RowName name={t('Layer-Mod (LM)')} help={LM_HELP} />
                  <PopNote>
                    {isModifierKey(key.tap.code)
                      ? t(
                          'Select a key on the keyboard mapped to a left-hand modifier (Ctrl, Shift, Alt or Win)',
                        )
                      : t(
                          'Select a key on the keyboard mapped to a modifier (Ctrl, Shift, Alt or Win)',
                        )}
                  </PopNote>
                </Section>
              )}
          <Section>
            <RowName name={t('Mod-Tap (MT)')} help={MT_HELP} />
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
          </Section>
          {footer}
        </Group>
      ) : null}
      <Section>
        <RowName title name={t('Modifier combo')} help={COMBO_HELP} />
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
      </Section>
    </Sheet>
  );
};
