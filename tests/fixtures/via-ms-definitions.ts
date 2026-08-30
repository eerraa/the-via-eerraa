/** Test-only definition shapes. Numeric IDs here are fixtures, not production allocations. */

export const LEGACY_TAPPING_TERM_OPTIONS = [
  10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46,
  48, 50,
] as const;

export const legacyGlobalTermControl = {
  label: 'Global Tapping Term',
  type: 'dropdown' as const,
  content: ['id_qmk_tapping_global_term', 15, 1],
  options: LEGACY_TAPPING_TERM_OPTIONS.map(
    (units) => [`${units * 10} ms`, units] as const,
  ),
};

export const exactGlobalTermControl = {
  label: 'Global Tapping Term',
  type: 'range' as const,
  content: ['id_qmk_tapping_global_term_exact', 15, 5],
  options: [100, 500],
};

export const customExactGlobalTermControl = {
  ...exactGlobalTermControl,
  options: [1, 65535],
};
