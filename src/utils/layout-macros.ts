export const normalizeLayoutMacros = (
  expressions: readonly string[],
  macroCount: number,
): string[] =>
  Array.from({length: macroCount}, (_, index) => expressions[index] ?? '');
