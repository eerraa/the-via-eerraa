export const ERA_RGB_SLEEP_EXACT_SECONDS_COMMAND =
  'id_qmk_rgb_sleep_timeout_exact';

export const isExactSecondCommand = (name: string) =>
  name === ERA_RGB_SLEEP_EXACT_SECONDS_COMMAND;

export const EXACT_SECOND_BOUNDS = {min: 1, max: 65535} as const;
