// MOUSE precision uses the existing V3 Custom Value channel. Firmware support
// is a live capability, independent of its date string and definition source.
export const MOUSE_PRECISION = 'id_qmk_mousekey_precision';
export const MOUSE_MARKER = 0xe4;
export const MOUSE_EXACT = {
  id_qmk_mousekey_cursor_start_exact: {id: 8, min: 1, max: 127, unit: 'px'},
  id_qmk_mousekey_cursor_target_exact: {id: 9, min: 1, max: 127, unit: 'px'},
  id_qmk_mousekey_cursor_ramp_exact: {id: 10, min: 0, max: 65535, unit: 'ms'},
  id_qmk_mousekey_cursor_interval_exact: {id: 11, min: 1, max: 255, unit: 'ms'},
  id_qmk_mousekey_wheel_interval_exact: {id: 12, min: 1, max: 255, unit: 'ms'},
  id_qmk_mousekey_wheel_target_exact: {id: 13, min: 1, max: 127, unit: 'steps'},
  id_qmk_mousekey_wheel_ramp_exact: {id: 14, min: 0, max: 65535, unit: 'ms'},
} as const;
export const mouseExact = (id: string) => MOUSE_EXACT[id as keyof typeof MOUSE_EXACT];
export const hasMousePrecision = (data: Record<string, unknown> | undefined) => {
  const capability = data?.[MOUSE_PRECISION];
  return Array.isArray(capability) && capability[0] === MOUSE_MARKER && capability[1] === 1;
};
export const readMouseExact = (id: string, value: unknown): number => {
  const field = mouseExact(id);
  if (!field || !Array.isArray(value) || value[2] !== MOUSE_MARKER ||
      !value.slice(0, 2).every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
    throw new Error(`Invalid MOUSE precision response: ${id}`);
  }
  const number = value[0] * 256 + value[1];
  if (number < field.min || number > field.max) throw new Error(`Invalid MOUSE precision value: ${id}`);
  return number;
};
