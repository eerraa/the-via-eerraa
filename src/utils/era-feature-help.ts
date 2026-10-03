// Short help for the ERA firmware's own menus.
//
// It is shown only for a keyboard opened through the app's own ERA definition, and the
// callers check that, not the command name: VIA's shared lighting menus use the same
// `id_qmk_rgblight_*` and `id_qmk_rgb_matrix_*` ids as the ERA firmware. Within an ERA
// definition, an entry is picked by command name rather than by label, so the H7S and
// the RP2040 spelling of one menu get the same text.
//
// Voice, kept minimal on purpose. The summary names the setting, it does not narrate
// it — "Restarts the keyboard into the bootloader". The detail is a few short paragraphs
// of user-visible behaviour and which way to move a value, nothing about how the
// firmware does it and nothing the screen already shows. Named choices are a list of
// name and one sentence, so they can be compared at a glance; the shipped default is
// only a mark on that list. What a reader does not need in order to set the value —
// a switch's default, a sentence describing the screen, generic advice — is left out.
//
// Where the firmware's own user guide is thin or wrong — KKUK and the three tapping
// switches — the text comes from reading the firmware instead: `port/kkuk.c`,
// `port/debounce_profile.c` with the algorithms under `quantum/debounce/`, and
// `port/tapping_term.c` on top of stock `action_tapping.c`.

/** One named option, compared side by side with its neighbours. */
export type EraHelpChoice = {
  /** The option exactly as the dropdown names it (option labels are not translated). */
  name: string;
  /** One sentence: what picking it does. */
  text: string;
};

/** What a disclosure shows when it opens. Every part is optional. */
export type EraHelpContent = {
  /** Short paragraphs, each one or two sentences. */
  detail?: readonly string[];
  choices?: readonly EraHelpChoice[];
  /** The choice the keyboard ships with; it is marked on the list. */
  defaultChoice?: string;
};

export type EraFeatureHelp = EraHelpContent & {
  /** One line, always visible above the controls. Names the setting, does not narrate it. */
  summary: string;
};

export const hasHelpBody = (content: EraHelpContent) =>
  !!(content.detail?.length || content.choices?.length);

// The SOCD menu is the same feature under two command families: H7S firmware names it
// `id_qmk_kill_switch_*`, the RP2040 firmware `id_qmk_socd_*`. One object, two prefixes,
// so the two families cannot drift apart into two different explanations.
const SOCD_HELP: EraFeatureHelp = {
  summary: 'Resolves simultaneous input between two opposing keys.',
  detail: [
    'While both keys of a pair are held, Mode decides which one is sent.',
    'Keys sent by Tap Dance or macros count too. Two pairs that share a key do not work.',
  ],
};

// The Mode choices are names that have to be compared, so each Mode row lists them.
const SOCD_SHARED_CHOICES: readonly EraHelpChoice[] = [
  {
    name: 'Last Input',
    text: 'The key pressed later wins; releasing it brings the other back.',
  },
  {name: 'Neutral', text: 'Neither key is sent.'},
  {name: 'First Input', text: 'The key pressed first wins.'},
];
const SOCD_LEFT_RIGHT_MODE_HELP: EraHelpContent = {
  choices: [
    ...SOCD_SHARED_CHOICES,
    {name: 'Left Priority', text: 'The Left Key always wins.'},
    {name: 'Right Priority', text: 'The Right Key always wins.'},
  ],
  defaultChoice: 'Last Input',
};
const SOCD_UP_DOWN_MODE_HELP: EraHelpContent = {
  choices: [
    ...SOCD_SHARED_CHOICES,
    {name: 'Up Priority', text: 'The Up Key always wins.'},
    {name: 'Down Priority', text: 'The Down Key always wins.'},
  ],
  defaultChoice: 'Last Input',
};

// One SLEEP page can hold the RGB and the backlight switch, and a page shows one
// explanation, so the text covers either light alone and both together. The lock
// indicators the backlight lights are mentioned only where there is a backlight switch.
const RGB_SLEEP_HELP: EraFeatureHelp = {
  summary: 'Controls when the lighting turns off by itself.',
  detail: [
    'With a switch on, its light goes out after the timeout without input, and when the computer sleeps or the connection drops. A key press brings it back.',
  ],
};
const BACKLIGHT_SLEEP_HELP: EraFeatureHelp = {
  ...RGB_SLEEP_HELP,
  detail: [
    ...(RGB_SLEEP_HELP.detail ?? []),
    'Lock indicators lit by the backlight go out with it.',
  ],
};

// Where the indicator LED is part of the lighting, the no-lock choice is RGB Effect;
// where it is an LED of its own, it is Off. Both lists live under the same command ids,
// so this one covers both and each dropdown shows the choices it offers.
const LOCK_INDICATOR_HELP: EraHelpContent = {
  choices: [
    {name: 'RGB Effect', text: 'Follows the lighting effect.'},
    {name: 'Off', text: 'Stays dark.'},
    {name: 'Caps Lock', text: 'Lights while Caps Lock is on.'},
    {name: 'Scroll Lock', text: 'Lights while Scroll Lock is on.'},
    {name: 'Num Lock', text: 'Lights while Num Lock is on.'},
  ],
};

// Ordered: the first prefix that matches a command in the submenu wins, so more
// specific prefixes come before the families that would also match them.
const HELP_BY_COMMAND_PREFIX: [string, EraFeatureHelp][] = [
  [
    'id_qmk_tapdance_',
    {
      summary: 'Puts four actions on one key.',
      detail: [
        'Takes effect once its TD key is on the keymap.',
        'Term is how long the keyboard waits to tell the actions apart.',
      ],
    },
  ],
  ['id_qmk_kill_switch_', SOCD_HELP],
  ['id_qmk_socd_', SOCD_HELP],
  [
    'id_qmk_kkuk_',
    {
      summary: 'Repeats multiple keys while they remain held.',
      detail: [
        'While two or more keys are held, the group is released and pressed again over and over: holding A, S and D types "asdasd…" instead of "asddd…".',
        'Keys assigned to SOCD are left out.',
      ],
    },
  ],
  [
    'id_qmk_debounce_',
    {
      summary: 'Configures debounce to prevent switch chatter.',
      detail: [
        'If one press sometimes types twice, raise the relevant time a little at a time.',
      ],
    },
  ],
  [
    'id_qmk_tapping_',
    {
      summary: 'Sets how tap-hold keys distinguish taps from holds.',
      detail: [
        'Applies to Mod-Tap and Layer-Tap keys. A shorter Term brings the hold sooner but can turn fast typing into holds.',
      ],
    },
  ],
  [
    'id_qmk_mousekey_',
    {
      summary: 'Sets how fast mouse keys move the pointer and wheel.',
      detail: ['Takes effect only with mouse keys on the keymap.'],
    },
  ],
  [
    'id_qmk_custom_nkro_',
    {
      summary: 'Removes the six-key rollover limit for simultaneous key input.',
      detail: [
        'Turn it off if an old BIOS or a KVM switch cannot see the keyboard; it then registers up to six keys at once.',
      ],
    },
  ],
  [
    'id_qmk_usb_bootmode',
    {
      summary: 'Sets the USB polling rate; applying restarts the keyboard.',
      detail: [
        '1 kHz works on any port. The faster rates need a port running at USB High Speed; hubs and front-panel ports often do not.',
        'Keyboard IN interval setting at the last successful read; not measured host polling or input latency.',
      ],
    },
  ],
  [
    'id_qmk_system_dfu',
    {
      summary: 'Restarts the keyboard into the bootloader.',
      detail: [
        'A removable drive appears on the computer; copy the firmware .uf2 file onto it.',
      ],
    },
  ],
  [
    'id_qmk_system_reset_',
    {
      summary: 'Erases the keymap and every setting.',
      detail: [
        'Turn on all three switches to erase everything and restart.',
      ],
    },
  ],
  [
    'id_qmk_split_link_',
    {
      summary: 'Sets the link speed of the cable between the two units.',
      detail: [
        'Apply changes the speed without restarting the keyboard or reconnecting USB.',
        'Result for this unit only; it does not confirm all saved settings on the other half.',
        'On TOMAK, one green STATUS flash confirms Apply and one red flash means it did not take. Three long red flashes mean the link fell back to Low; if that repeats, check the split cable.',
      ],
    },
  ],
  [
    'id_qmk_eeprom_sync_',
    {
      summary: 'Makes the two units behave as one keyboard.',
    },
  ],
  ['id_qmk_backlight_sleep_', BACKLIGHT_SLEEP_HELP],
  ['id_qmk_rgb_sleep_', RGB_SLEEP_HELP],
  // VERSION and the lighting pages have no line here: their rows already say
  // everything a sentence above them would.
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
// MOUSE rows each carry one line: the unit says how much, never of what. "1.0 s" of
// acceleration is a ramp time, "100 /s" is an event rate that does not change that ramp,
// and the pointer rows swap meaning depending on whether acceleration is on.
//
// Left out: controls the submenu summary already takes as its subject (Global Tapping
// Term, KKUK's Enable), controls whose label plus unit really is the whole answer
// (Indicator Brightness), and Tap Dance's On Tap / On Hold / On Double Tap / Tap+Hold,
// whose names already say when each is sent.
//
// Keyed off exact firmware command names, like the submenu text. Two rows
// can share one command id and mean different things — the debounce window depending on
// the mode, the pointer speed depending on acceleration — so those entries also name the
// labels they belong to; both the H7S spelled-out labels and the shorter RP2040 ones are
// listed. An unmatched label renders no help, which is the right failure: text about the
// wrong side of the debounce window is worse than none.
export type EraControlHelpEntry = {
  /** Exact firmware command name. */
  command: string;
  labels?: readonly string[];
  help: EraHelpContent;
};

const line = (text: string): EraHelpContent => ({detail: [text]});

const HELP_BY_CONTROL: readonly EraControlHelpEntry[] = [
  {command: 'id_qmk_socd_lr_mode', help: SOCD_LEFT_RIGHT_MODE_HELP},
  {command: 'id_qmk_kill_switch_mode_lr', help: SOCD_LEFT_RIGHT_MODE_HELP},
  {command: 'id_qmk_socd_ud_mode', help: SOCD_UP_DOWN_MODE_HELP},
  {command: 'id_qmk_kill_switch_mode_ud', help: SOCD_UP_DOWN_MODE_HELP},
  {
    command: 'id_qmk_kkuk_delay_time',
    help: line('How long the keys are held before the repeating starts.'),
  },
  {
    command: 'id_qmk_kkuk_repeat_time',
    help: line('How often the group repeats. Shorter repeats faster.'),
  },
  {
    command: 'id_qmk_debounce_mode',
    help: {
      choices: [
        {
          name: 'Balanced',
          text: 'A change counts once the switch has settled for the set time, so press and release are both delayed by it.',
        },
        {
          name: 'Fast',
          text: 'The first change counts at once, then the key is ignored for the set time: the least delay and the least margin for chatter.',
        },
        {
          name: 'Advanced',
          text: 'A press counts at once and the key is then ignored for Press Delay; a release counts once settled for Release Delay.',
        },
      ],
      defaultChoice: 'Balanced',
    },
  },
  {
    command: 'id_custom_badge_only',
    help: line('Applies RGB effects only to the badge area.'),
  },
  {
    command: 'id_custom_indicator_toggle',
    help: line(
      'Selects which lock the badge shows. At RGB Effect the badge keeps the lighting effect.',
    ),
  },
  {
    command: 'id_custom_indicator_override',
    help: line(
      'Keeps the badge for the lock indicator; RGB effects leave it out. Link and sync STATUS signals can still appear.',
    ),
  },
  {command: 'id_qmk_custom_ind_selec', help: LOCK_INDICATOR_HELP},
  {command: 'id_qmk_custom_ind_1_select', help: LOCK_INDICATOR_HELP},
  {command: 'id_qmk_custom_ind_2_select', help: LOCK_INDICATOR_HELP},
  {command: 'id_qmk_custom_riley_ind1_mode', help: LOCK_INDICATOR_HELP},
  {command: 'id_qmk_custom_riley_ind2_mode', help: LOCK_INDICATOR_HELP},
  {command: 'id_qmk_custom_riley_ind3_mode', help: LOCK_INDICATOR_HELP},
  {
    command: 'id_qmk_velocikey_toggle',
    help: line('Speeds the lighting effect up and down with typing speed.'),
  },
  {
    command: 'id_qmk_custom_velocikey_enable',
    help: line('Speeds the lighting effect up and down with typing speed.'),
  },
  {
    command: 'id_qmk_debounce_time_single',
    help: line(
      'A change counts only after the switch has been stable this long, which is also the added delay. 5 to 10 ms suits most switches.',
    ),
  },
  {
    command: 'id_qmk_debounce_time_post',
    labels: [
      'Press & Release - delay after change (post-only)',
      'Press & Release Cooldown',
    ],
    help: line(
      'The change is sent at once, then the key is ignored this long. It adds no delay; raise it only while presses still double.',
    ),
  },
  {
    command: 'id_qmk_debounce_time_pre',
    help: line(
      'The press is sent at once, then the key is ignored this long. It adds no delay.',
    ),
  },
  {
    command: 'id_qmk_debounce_time_post',
    labels: [
      'Release - delay before and after release (pre+post window)',
      'Release Delay',
    ],
    help: line(
      'A release counts only after the switch has been stable this long. It delays release, not press.',
    ),
  },
  {
    command: 'id_qmk_tapping_permissive_hold',
    help: line(
      'Becomes a hold when another key is pressed and released while it is held. Use it when a quick hold still comes out as a tap.',
    ),
  },
  {
    command: 'id_qmk_tapping_hold_on_other_key_press',
    help: line(
      'Becomes a hold as soon as another key is pressed, earlier than Permissive Hold. Rolled typing can turn taps into holds.',
    ),
  },
  {
    command: 'id_qmk_tapping_retro_tapping',
    help: line(
      'Sends the tap when the key is held past Term and released with no other key pressed.',
    ),
  },
  {
    command: 'id_qmk_mousekey_cursor_acceleration',
    help: line('Time from start speed to top speed. Off keeps the start speed.'),
  },
  {
    command: 'id_qmk_mousekey_cursor_min_speed',
    labels: ['Cursor Speed'],
    help: line(
      'Distance per step. With acceleration off, this is the speed the whole time.',
    ),
  },
  {
    command: 'id_qmk_mousekey_cursor_min_speed',
    labels: ['Cursor Start Speed'],
    help: line('Distance per step when the key is first pressed.'),
  },
  {
    command: 'id_qmk_mousekey_cursor_max_speed',
    help: line('Distance per step once acceleration has finished.'),
  },
  {
    command: 'id_qmk_mousekey_cursor_interval',
    help: line(
      'Steps sent per second. Higher is smoother and leaves the acceleration time alone.',
    ),
  },
  {
    command: 'id_qmk_mousekey_wheel_interval',
    help: line('Scroll steps sent per second.'),
  },
  {
    command: 'id_qmk_mousekey_wheel_acceleration',
    help: line('How much scrolling speeds up while held. Off keeps it steady.'),
  },
  {
    command: 'id_qmk_split_link_level',
    help: {
      detail: [
        'The speed matters mainly for layer sharing when both units are plugged into the computer.',
      ],
      choices: [
        {name: 'High', text: 'Layer changes reach the other unit soonest.'},
        {
          name: 'Medium',
          text: 'A little slower; for a cable that is unstable at High.',
        },
        {
          name: 'Low',
          text: 'Slowest; for a cable that is unstable at the faster speeds.',
        },
      ],
      defaultChoice: 'High',
    },
  },
  {
    command: 'id_qmk_eeprom_sync_requested',
    help: line(
      'Copies stored settings between the halves; INPUT SYNC and RGB SYNC need it. On TOMAK, blue STATUS shows it working.',
    ),
  },
  // Only split boards have this row, which is why the SOCD rule for them lives here:
  // each unit plugged into the computer sends its own keys, with or without INPUT SYNC.
  {
    command: 'id_qmk_input_sync_requested',
    help: line(
      'With both units plugged into the computer, they share layers and key decisions; both keys of an SOCD pair must be on the same unit.',
    ),
  },
  {
    command: 'id_qmk_rgb_sync_requested',
    help: line('Keeps the lighting in step on both units, reactive effects included.'),
  },
];

/** Every control entry, for tests that hold the help to the real definitions. */
export const eraControlHelpEntries = (): readonly EraControlHelpEntry[] =>
  HELP_BY_CONTROL;

// Every string in both tables is rendered through `t()`, so each one has to exist as a
// key in all six catalogs or that language silently falls back to English. Editing the
// English text without updating the locales is the easy mistake here, so the locale test
// reads this list rather than trusting anyone to remember. Choice names are left out:
// they are the dropdown's own option labels, which stay as the firmware names them.
// The always-visible half, on its own: `tests/locales.test.ts` holds these to one
// short impersonal sentence so no menu reads differently from its neighbours.
export const eraMenuSummaries = (): string[] => [
  ...new Set(HELP_BY_COMMAND_PREFIX.map(([, {summary}]) => summary)),
];

const contentStrings = (content: EraHelpContent): string[] => [
  ...(content.detail ?? []),
  ...(content.choices ?? []).map(({text}) => text),
];

export const eraHelpStrings = (): string[] => [
  ...new Set([
    ...HELP_BY_COMMAND_PREFIX.flatMap(([, help]) => [
      help.summary,
      ...contentStrings(help),
    ]),
    ...HELP_BY_CONTROL.flatMap(({help}) => contentStrings(help)),
  ]),
];

// Given the options a dropdown offers, its choices come back as that dropdown lists
// them: in its order, and only the ones it has. One command id can offer different
// lists on different boards, like a lock indicator's RGB Effect or Off.
export const findEraControlHelp = (
  commandName: unknown,
  label: unknown,
  options?: readonly string[],
): EraHelpContent | null => {
  if (typeof commandName !== 'string') {
    return null;
  }
  for (const entry of HELP_BY_CONTROL) {
    if (entry.command !== commandName) {
      continue;
    }
    if (entry.labels && !entry.labels.some((known) => known === label)) {
      continue;
    }
    const {choices} = entry.help;
    if (!choices || !options) {
      return entry.help;
    }
    const offered = options.flatMap(
      (option) => choices.find(({name}) => name === option) ?? [],
    );
    return offered.length || entry.help.detail?.length
      ? {...entry.help, choices: offered}
      : null;
  }
  return null;
};
