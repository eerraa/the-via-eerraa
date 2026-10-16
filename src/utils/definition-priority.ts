import type {KeyboardDictionary} from '@the-via/reader';

const overlayKeyboardDictionaries = (
  base: KeyboardDictionary,
  overlay: KeyboardDictionary,
): KeyboardDictionary =>
  Object.entries(overlay).reduce<KeyboardDictionary>(
    (merged, [id, definitionMap]) => {
      merged[Number(id)] = {...merged[Number(id)], ...definitionMap};
      return merged;
    },
    {...base},
  );

/** 1: ERA overlay, 2: official VIA snapshot, 3: Design upload. */
export const mergeDefinitionLookup = (
  official: KeyboardDictionary,
  sideload: KeyboardDictionary,
  era: KeyboardDictionary,
) =>
  overlayKeyboardDictionaries(
    overlayKeyboardDictionaries(sideload, official),
    era,
  );
