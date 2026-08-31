// Short help for the ERA firmware's own menus.
//
// Every entry is keyed off a command name the ERA firmware defines, never off a menu
// label. Labels are free text that an ordinary VIA definition could also use, whereas
// these command ids only exist in ERA firmware, so an unrelated keyboard with a menu
// called "TAPPING" never picks up text written about a different implementation.
//
// Voice: the summary names the setting, it does not narrate it — "Enters the bootloader
// when switched on", not "Puts the keyboard into bootloader mode so that you can flash
// firmware onto it". The detail says what happens when the setting is on and when it is
// off, and stops there. Explaining what the feature *is* in the abstract is what made
// the first version of this text too long to read on the screen it appears on.
//
// Where the firmware's own user guide is thin or wrong — KKUK and the three tapping
// switches — the text comes from reading the firmware instead: `port/kkuk.c`,
// `port/debounce_profile.c` with the algorithms under `quantum/debounce/`, and
// `port/tapping_term.c` on top of stock `action_tapping.c`.

export type EraFeatureHelp = {
  /** One line, always visible above the controls. Names the setting, does not narrate it. */
  summary: string;
  /** Shown when the reader opens the disclosure. Omit when the summary is the whole answer. */
  detail?: string;
};

// The SOCD menu is the same feature under two command families: H7S firmware names it
// `id_qmk_kill_switch_*`, the RP2040 firmware `id_qmk_socd_*`. One object, two prefixes,
// so the two families cannot drift apart into two different explanations.
const SOCD_HELP: EraFeatureHelp = {
  summary: 'Resolves simultaneous input between two opposing keys.',
  detail:
    'A normal keyboard can report opposing keys such as A and D at the same time. With SOCD enabled, the key pressed later takes priority while both are held. Releasing it restores the key that is still physically held. This is mainly useful when a game needs unambiguous directional input.',
};

// TOMAK exact-seconds and H7S minute presets are different wires for the same
// user-visible setting. One object so the two families cannot drift apart.
const RGB_SLEEP_HELP: EraFeatureHelp = {
  summary: 'Turns RGB off after a period with no key input.',
  detail: 'Default is 10 minutes. Pressing a key wakes the RGB.',
};

// Ordered: the first prefix that matches a command in the submenu wins, so more
// specific prefixes come before the families that would also match them.
const HELP_BY_COMMAND_PREFIX: [string, EraFeatureHelp][] = [
  [
    'id_qmk_tapdance_',
    {
      summary: 'Four actions on one key.',
      detail:
        'Fill in the actions, then place the matching TD key on your keymap from KEYMAP → TAPDANCE. Nothing here does anything until that key is somewhere you can press it. Term is how long the keyboard waits before deciding which action you meant.',
    },
  ],
  ['id_qmk_kill_switch_', SOCD_HELP],
  ['id_qmk_socd_', SOCD_HELP],
  [
    'id_qmk_kkuk_',
    {
      summary: 'Repeats multiple keys while they remain held.',
      detail:
        'While two or more ordinary keys remain held, KKUK periodically releases the held key group and presses it again. For example, holding A, S and D usually produces "asdasdasd..." instead of the ordinary "asdddd..." auto-repeat. Keys assigned to SOCD are excluded.',
    },
  ],
  [
    'id_qmk_debounce_',
    {
      summary: 'Configures debounce to prevent switch chatter.',
      detail:
        'If one physical press sometimes produces multiple inputs, increase the relevant delay a little at a time. If there is no chatter, keeping the default settings is recommended.',
    },
  ],
  [
    'id_qmk_tapping_',
    {
      summary: 'Sets how tap-hold keys distinguish taps from holds.',
      detail:
        'For Mod-Tap and Layer-Tap keys, 200 ms by default. Shorter triggers the hold sooner but turns fast typing into accidental holds; longer is safer but the hold arrives late. The three switches below change what happens when you press another key first.',
    },
  ],
  [
    'id_qmk_mousekey_',
    {
      summary: 'Configures speed when using mouse-control keys.',
      detail:
        'Nothing here does anything unless your keymap has mouse keys on it. The values interact, so change one at a time.',
    },
  ],
  [
    'id_qmk_custom_nkro_',
    {
      summary: 'Expands simultaneous key input without a limit.',
      detail:
        'Turn it off if an old BIOS or a KVM switch cannot see your typing. Off, the keyboard falls back to 6KRO and registers six keys at once.',
    },
  ],
  [
    'id_qmk_usb_bootmode',
    {
      summary: 'Sets the USB polling rate; applying restarts the keyboard.',
      detail:
        'Pick a mode, then turn on Apply. 1 kHz works on any port; the high-speed rates need a port that negotiates USB High Speed, which hubs and front-panel headers often cannot.',
    },
  ],
  [
    'id_qmk_system_dfu',
    {
      summary: 'Enters the bootloader when switched on.',
      detail:
        'The keyboard enters the bootloader the moment you switch this on, and a new removable drive appears on your PC. Copy the firmware .uf2 file onto that drive. The toggle always reads back off, which is expected.',
    },
  ],
  [
    'id_qmk_system_reset_',
    {
      summary: 'Erases the keymap and every setting.',
      detail:
        'Switch all three toggles within ten seconds to run it. Everything stored is erased and the keyboard restarts. Miss the ten seconds and the toggles you switched clear themselves.',
    },
  ],
  [
    'id_qmk_split_link_',
    {
      summary: 'Link speed of the cable between the two units.',
      detail:
        'Apply does nothing if that speed is already running; changing it restarts both units. Three long red LED pulses mean the split cable is not good enough — replace it. Default is High.',
    },
  ],
  [
    'id_qmk_eeprom_sync_',
    {
      summary: 'Makes the two units behave as one keyboard.',
      detail:
        'All three are on by default, and each covers a different part of what the two units share.',
    },
  ],
  // Exact first: `id_qmk_rgb_sleep_timeout_exact` starts with the H7S minute-dropdown
  // id, so listing the shorter prefix first would steal TOMAK's command. Same help
  // object — idle RGB timeout, 10-minute default, keypress wake — on both families.
  [
    'id_qmk_rgb_sleep_timeout_exact',
    RGB_SLEEP_HELP,
  ],
  ['id_qmk_rgb_sleep_timeout', RGB_SLEEP_HELP],
  [
    'id_qmk_ver_',
    {
      summary: 'Firmware version on this keyboard.',
      detail:
        'Year, month, day and revision, read from the keyboard. Quote it when you report a problem.',
    },
  ],
  [
    'id_qmk_custom_ind_',
    {
      summary: 'LED for Caps Lock, Scroll Lock and Num Lock.',
      detail:
        'Pick what each indicator watches, then set its brightness and colour. It takes over that LED only while the lock is on.',
    },
  ],
  // The badge menu is gated on `id_custom_badge_only`, the one command in it that no
  // other keyboard would plausibly name the same way; the indicator commands beside it
  // are generic enough that keying on them would be a weaker gate.
  [
    'id_custom_badge_only',
    {
      summary: 'Configures badge lighting and lock indicators.',
    },
  ],
  [
    'id_custom_backlight_',
    {
      summary: 'Configures backlight brightness and effects.',
    },
  ],
  [
    'id_qmk_rgblight_',
    {
      summary: 'Configures RGB lighting brightness, effects, speed and color.',
    },
  ],
  [
    'id_qmk_rgb_matrix_',
    {
      summary: 'Configures switch RGB brightness, effects, speed and color.',
    },
  ],
];

export const findEraFeatureHelp = (
  commandNames: readonly unknown[],
): EraFeatureHelp | null => {
  for (const [prefix, help] of HELP_BY_COMMAND_PREFIX) {
    if (
      commandNames.some(
        (name) => typeof name === 'string' && name.startsWith(prefix),
      )
    ) {
      return help;
    }
  }
  return null;
};

// A control gets its own disclosure only when its label cannot say which way to move
// the value. That is true when the choices are proper nouns whose names do not describe
// what they do (Balanced / Fast / Advanced, Permissive Hold), and when the label states
// a specification rather than a consequence — a DEBOUNCE row called "Press & Release -
// delay before and after (same value)" says what the firmware does with the number but
// not that raising it delays every keystroke.
//
// MOUSE was left out of this on the first pass, on the grounds that a row reading
// "Cursor Top Speed / 16 px" already carries its own answer. On the actual screen it
// does not: the unit says how much, never of what. "1.0 s" of acceleration is a ramp
// time, "100 /s" is an event rate that does not change that ramp, and the pointer rows
// swap meaning depending on whether acceleration is on. Each row now carries one line.
//
// Still left out: controls the submenu summary already takes as its subject (Global
// Tapping Term, KKUK's Enable), and controls whose label plus unit really is the whole
// answer (Indicator Brightness).
//
// Keyed off exact firmware command names, the same gate the submenu text uses. Two rows
// can share one command id and mean different things — the debounce window depending on
// the mode, the pointer speed depending on acceleration — so those entries also name the
// labels they belong to; both the H7S spelled-out labels and the shorter RP2040 ones are
// listed. An unmatched label renders no help, which is the right failure: text about the
// wrong side of the debounce window is worse than none.
type EraControlHelp = {
  /** Exact firmware command name. */
  command?: string;
  /**
   * Used instead of `command` when one entry covers a family of numbered commands —
   * TAPDANCE repeats the same five controls across eight slots, so matching
   * `id_qmk_tapdance_` plus the row label beats writing forty identical entries.
   */
  commandPrefix?: string;
  labels?: readonly string[];
  help: string;
};

const HELP_BY_CONTROL: readonly EraControlHelp[] = [
  {
    commandPrefix: 'id_qmk_tapdance_',
    labels: ['On Tap'],
    help: 'The keycode sent when the press is judged a short one.',
  },
  {
    commandPrefix: 'id_qmk_tapdance_',
    labels: ['On Hold'],
    help: 'The keycode sent when the press is judged a long one.',
  },
  {
    commandPrefix: 'id_qmk_tapdance_',
    labels: ['On Double Tap'],
    help: 'The keycode sent when the key is tapped twice inside Term.',
  },
  {
    commandPrefix: 'id_qmk_tapdance_',
    labels: ['Tap+Hold'],
    help: 'The keycode sent when a tap is followed by holding the key down.',
  },
  {
    command: 'id_qmk_kkuk_delay_time',
    help: 'How long to wait after multiple keys are held before repeating begins.',
  },
  {
    command: 'id_qmk_kkuk_repeat_time',
    help: 'How often the held key group repeats. A shorter value repeats it faster.',
  },
  {
    command: 'id_qmk_debounce_mode',
    help: 'Balanced — The most stable default. A press or release is applied only after the switch has remained settled for the configured time, so both directions are delayed by that amount.\n\nFast — Prioritizes response speed. The first press or release change is applied immediately, then further changes from that key are ignored for the configured time. It adds almost no input delay, but leaves the least margin for chatter.\n\nAdvanced — Treats press and release differently. A press is applied immediately, then further press-side changes are ignored for Press Delay. A release is applied only after the signal remains settled for Release Delay. Use this when you want immediate press response with more conservative release filtering.\n\nBalanced is recommended as the starting point.',
  },
  {
    command: 'id_custom_badge_only',
    help: 'Applies RGB effects only to the badge area.',
  },
  {
    command: 'id_custom_indicator_toggle',
    help: 'Selects which lock indicator the badge area shows.',
  },
  {
    command: 'id_custom_indicator_override',
    help: 'Uses the badge area only as an indicator. RGB effects do not affect it.',
  },
  {
    command: 'id_qmk_velocikey_toggle',
    help: 'Changes RGBLight effect speed according to typing speed while enabled.',
  },
  {
    command: 'id_qmk_custom_velocikey_enable',
    help: 'Changes RGBLight effect speed according to typing speed while enabled.',
  },
  {
    command: 'id_qmk_debounce_time_single',
    help: 'One value for both directions. Nothing is reported until the switch has been quiet this long, so this is also how much later every key registers. 5 to 10 ms covers most switches.',
  },
  {
    command: 'id_qmk_debounce_time_post',
    labels: [
      'Press & Release - delay after change (post-only)',
      'Press & Release Cooldown',
    ],
    help: 'The change is sent immediately, then that key is ignored for this long. It costs no response time, so raise it only while a press still doubles.',
  },
  {
    command: 'id_qmk_debounce_time_pre',
    help: 'The press side. It is sent immediately and the key is then ignored for this long, so raising it does not slow the keyboard down.',
  },
  {
    command: 'id_qmk_debounce_time_post',
    labels: [
      'Release - delay before and after release (pre+post window)',
      'Release Delay',
    ],
    help: 'The release side. Letting go is reported only after the switch has been quiet this long. It delays the release, not the press.',
  },
  {
    command: 'id_qmk_tapping_permissive_hold',
    help: 'For holds that do not take when you type fast. On, the key becomes a hold as soon as another key is pressed and released while you are still holding it. Hold on Other Key Press decides earlier — on the other key going down rather than coming back up.',
  },
  {
    command: 'id_qmk_tapping_hold_on_other_key_press',
    help: 'The strongest of the three: the key becomes a hold the moment any other key goes down. Turn it on if holds still come out as letters with Permissive Hold on. It costs rolls, which hurts most on a home-row Mod-Tap.',
  },
  {
    command: 'id_qmk_tapping_retro_tapping',
    help: 'For letters that vanish when you rest on a key too long. On, a tap-hold key held past the term and released with nothing pressed in between still sends the tap.',
  },
  {
    command: 'id_qmk_mousekey_cursor_acceleration',
    help: 'How long the pointer takes to go from start speed to top speed. Off holds it at the start speed.',
  },
  {
    command: 'id_qmk_mousekey_cursor_min_speed',
    labels: ['Cursor Speed'],
    help: 'How far the pointer moves per step. Acceleration is off, so this is the speed the whole time.',
  },
  {
    command: 'id_qmk_mousekey_cursor_min_speed',
    labels: ['Cursor Start Speed'],
    help: 'How far the pointer moves per step the instant you press the key.',
  },
  {
    command: 'id_qmk_mousekey_cursor_max_speed',
    help: 'How far the pointer moves per step once acceleration has finished.',
  },
  {
    command: 'id_qmk_mousekey_cursor_interval',
    help: 'How many move steps go out each second. Higher is smoother and does not change the acceleration time.',
  },
  {
    command: 'id_qmk_mousekey_wheel_interval',
    help: 'How many scroll steps go out each second.',
  },
  {
    command: 'id_qmk_mousekey_wheel_acceleration',
    help: 'How much scrolling speeds up while you hold the key. Off keeps it steady.',
  },
  {
    command: 'id_qmk_eeprom_sync_requested',
    help: 'A few seconds after a stored setting changes, an indicator shows and both units copy it across. INPUT SYNC and RGB SYNC need this on to work fully.',
  },
  {
    command: 'id_qmk_input_sync_requested',
    help: 'With both units plugged into the PC, they share layer state and key decisions so they act as one keyboard.',
  },
  {
    command: 'id_qmk_rgb_sync_requested',
    help: 'Lines the lighting up across both units, reactive effects included.',
  },
];

// Every string in both tables is rendered through `t()`, so each one has to exist as a
// key in all six catalogs or that language silently falls back to English. Editing the
// English text without updating the locales is the easy mistake here, so the locale test
// reads this list rather than trusting anyone to remember.
// The always-visible half, on its own: `tests/locales.test.ts` holds these to one
// short impersonal sentence so no menu reads differently from its neighbours.
export const eraMenuSummaries = (): string[] => [
  ...new Set(HELP_BY_COMMAND_PREFIX.map(([, {summary}]) => summary)),
];

export const eraHelpStrings = (): string[] => [
  ...HELP_BY_COMMAND_PREFIX.flatMap(([, {summary, detail}]) =>
    detail ? [summary, detail] : [summary],
  ),
  ...HELP_BY_CONTROL.map(({help}) => help),
];

export const findEraControlHelp = (
  commandName: unknown,
  label: unknown,
): string | null => {
  if (typeof commandName !== 'string') {
    return null;
  }
  for (const entry of HELP_BY_CONTROL) {
    const matches = entry.command
      ? entry.command === commandName
      : !!entry.commandPrefix && commandName.startsWith(entry.commandPrefix);
    if (!matches) {
      continue;
    }
    if (entry.labels && !entry.labels.some((known) => known === label)) {
      continue;
    }
    return entry.help;
  }
  return null;
};
