export const isCustomMenuCommandContent = (
  content: unknown,
): content is [string, number, number, ...number[]] =>
  Array.isArray(content) &&
  content.length >= 3 &&
  typeof content[0] === 'string' &&
  content.slice(1).every((value) => typeof value === 'number');

// The firmware keeps some values aside until a second command, which the definition
// spells as a switch, puts them into effect. Where it also reports the value in
// effect and the value it keeps for the next start, it does so with labels naming
// the option. The custom menu writes such a value on Apply and sends the switch
// after it, shows the value in effect, and draws neither the switch nor the labels.
// Official VIA, and this app for any other definition, show them all as the
// definition does.
export type HeldValueCommands = {
  value: string;
  action: string;
  running?: string;
  stored?: string;
  result?: string;
};

export const HELD_VALUES: readonly HeldValueCommands[] = [
  {
    value: 'id_qmk_split_link_level',
    action: 'id_qmk_split_link_apply',
    running: 'id_qmk_split_link_runtime',
    stored: 'id_qmk_split_link_stored',
    result: 'id_qmk_split_link_result',
  },
];

/** A command the custom menu does not draw a row for, because Apply covers it. */
export const isHeldValueSideCommand = (name: unknown) =>
  HELD_VALUES.some(
    ({action, running, stored}) =>
      name === action || name === running || name === stored,
  );

// A switch the firmware always reads back off, because turning it on is an action
// rather than a setting. The custom menu draws it as a button named for the action.
export const ACTION_SWITCHES: ReadonlyMap<
  string,
  {label: string; title: string}
> = new Map([
  ['id_qmk_system_dfu', {label: 'Run', title: 'Restart into the bootloader'}],
]);

/** Text a label value carries, up to its terminating NUL. */
export const decodeCustomMenuText = (value?: readonly number[]) => {
  if (!value || value.length === 0) {
    return '';
  }
  const end = value.indexOf(0);
  return new TextDecoder().decode(
    new Uint8Array(value.slice(0, end === -1 ? undefined : end)),
  );
};
