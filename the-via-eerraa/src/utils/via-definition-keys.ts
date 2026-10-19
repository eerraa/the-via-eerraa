import type {VIADefinitionV2, VIADefinitionV3, VIAKey} from '@the-via/reader';

type DefinitionLayouts = {
  keys: VIAKey[];
  optionKeys?: VIADefinitionV3['layouts']['optionKeys'];
};

const isEncoderId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export const collectDefinitionKeys = (
  definition: Pick<VIADefinitionV2 | VIADefinitionV3, 'layouts'> | undefined,
): VIAKey[] => {
  if (!definition?.layouts) {
    return [];
  }
  const {keys, optionKeys} = definition.layouts as DefinitionLayouts;
  const optionKeyList = optionKeys
    ? Object.values(optionKeys).flatMap((variants) =>
        Object.values(variants).flat(),
      )
    : [];
  return [...keys, ...optionKeyList];
};

export const collectUniqueEncoderIds = (
  definition: Pick<VIADefinitionV2 | VIADefinitionV3, 'layouts'> | undefined,
): number[] => {
  const encoderIds = collectDefinitionKeys(definition)
    .map((key) => Number((key as {ei?: number}).ei))
    .filter(isEncoderId);
  return Array.from(new Set(encoderIds)).sort((left, right) => left - right);
};

export const collectMaxLedIndex = (
  definition: Pick<VIADefinitionV2 | VIADefinitionV3, 'layouts'> | undefined,
): number =>
  collectDefinitionKeys(definition).reduce(
    (maxLedIndex, key) => Math.max(maxLedIndex, key.li ?? -1),
    -1,
  );
