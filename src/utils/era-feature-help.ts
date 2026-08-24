// Short help for the ERA firmware's own menus.
//
// Every entry is keyed off a command name the ERA firmware defines, never off a menu
// label. Labels are free text that an ordinary VIA definition could also use, whereas
// these command ids only exist in ERA firmware, so an unrelated keyboard with a menu
// called "TAPPING" never picks up text written about a different implementation.
//
// The source is the firmware's own user guide at
// `qmk_firmware_eerraa/keyboards/era/common/docs/user/readme.txt`, rewritten for
// someone reading it inside the configurator: the guide tells you where to click,
// which the reader already knows by the time they see this, so what is left is what
// the setting does and how to choose a value. Where the guide is thin or wrong —
// Anti-Ghosting and the three tapping switches — the text below comes from reading the
// firmware instead: `port/kkuk.c`, `port/debounce_profile.c` with the algorithms under
// `quantum/debounce/`, and `port/tapping_term.c` on top of stock `action_tapping.c`.

export type EraFeatureHelp = {
  /** One line, always visible above the controls. */
  summary: string;
  /** Shown when the reader opens the disclosure. */
  detail: string;
};

// The SOCD menu is the same feature under two command families: H7S firmware names it
// `id_qmk_kill_switch_*`, the RP2040 firmware `id_qmk_socd_*`. One object, two prefixes,
// so the two families cannot drift apart into two different explanations.
const SOCD_HELP: EraFeatureHelp = {
  summary:
    'While you hold two opposite keys, only the one you pressed last counts.',
  detail:
    'Set each pair to the two keys that fight each other, usually A and D, then W and S. Let one go and control passes straight back to the other, so you can change direction without releasing first. Competitive rules differ on this — check yours before you rely on it in a match.',
};

// Ordered: the first prefix that matches a command in the submenu wins, so more
// specific prefixes come before the families that would also match them.
const HELP_BY_COMMAND_PREFIX: [string, EraFeatureHelp][] = [
  [
    'id_qmk_tapdance_',
    {
      summary:
        'One key, four actions: tap, hold, double tap, and tap-then-hold.',
      detail:
        'Fill in the actions you want, then place the matching TD key on your keymap from KEYMAP → CUSTOM — the settings here do nothing until that key is somewhere you can press it. Term is how long the keyboard waits before deciding which action you meant. Raise it if double taps get missed, lower it if the key feels slow to respond.',
    },
  ],
  ['id_qmk_kill_switch_', SOCD_HELP],
  ['id_qmk_socd_', SOCD_HELP],
  [
    'id_qmk_kkuk_',
    {
      summary:
        'Hold several keys and they cycle: hold a, s and d and you get "asdasdasd", not "asddddd".',
      detail:
        'The menu name is misleading — this has nothing to do with matrix ghosting. Hold two or more ordinary keys still, and the keyboard starts letting the whole group go and pressing it again on a timer, so every key you are holding keeps arriving instead of only the last one repeating. First Delay Time is how long you have to hold before that begins; Repeat Time is how often the group goes out afterwards. Keys you gave to SOCD are left out of it. It is the firmware doing the job people otherwise buy a macro pad for in games.',
    },
  ],
  [
    'id_qmk_debounce_',
    {
      summary: 'Filters switch chatter, so one press sends one keystroke.',
      detail:
        'Leave it alone unless one press sometimes types twice. When that happens, raise the time a little at a time — on Balanced every millisecond you add is a millisecond the key takes to register. Balanced at 5 to 10 ms suits most switches. The mode decides which time boxes appear under it.',
    },
  ],
  [
    'id_qmk_tapping_',
    {
      summary:
        'How long a tap-hold key waits before it decides you meant the hold.',
      detail:
        'This covers Mod-Tap and Layer-Tap keys — the ones that send a key when you tap them and a modifier or a layer when you hold them. 200 ms is the default: shorter makes holds trigger sooner but turns fast typing into accidental holds, longer is more forgiving but the hold arrives late. The three switches under it decide what happens when you press something else before the key has made up its mind. Turn them on one at a time.',
    },
  ],
  [
    'id_qmk_mousekey_',
    {
      summary: 'Pointer and wheel speed for the mouse keys in your keymap.',
      detail:
        'Start from the defaults and change one value at a time; these interact, and moving several at once makes it hard to tell what helped. Cursor settings move the pointer, wheel settings scroll. None of it does anything unless your keymap actually has mouse keys on it.',
    },
  ],
  [
    'id_qmk_custom_nkro_',
    {
      summary: 'Lets the keyboard report every key you are holding at once.',
      detail:
        'On is right for almost everything. Turn it off if an old BIOS, a boot menu or a KVM switch cannot see your typing — those usually only understand the simpler six-key report.',
    },
  ],
  [
    'id_qmk_usb_bootmode',
    {
      summary:
        'How often the keyboard reports to the PC. Applies after a restart.',
      detail:
        'Pick a mode, then turn on Apply. The keyboard restarts by itself and comes back at the new rate. 1 kHz works on any port; the high-speed rates need a port that can negotiate USB High Speed, and a hub or a front-panel header often cannot. Run the test below afterwards to see how the mode actually behaved on your machine.',
    },
  ],
  [
    'id_qmk_system_dfu',
    {
      summary:
        'Puts the keyboard into bootloader mode so you can flash firmware.',
      detail:
        'It acts the moment you switch it on, and the toggle always reads back off — that is expected, not a failed write. A drive named RPI-RP2 appears on your PC; copy the .uf2 file onto it and the drive disappears when flashing is done. Holding the top-left key while you plug the keyboard in does the same thing.',
    },
  ],
  [
    'id_qmk_system_reset_',
    {
      summary:
        'Erases the keymap and every setting, then restarts on defaults.',
      detail:
        'Turn on all three toggles within ten seconds of the first one. Miss that and they all release themselves, so you just start again; switching one back off cancels immediately. Back your keymap up from SAVE + LOAD first, because this erases that too.',
    },
  ],
  [
    'id_qmk_split_link_',
    {
      summary:
        'Speed of the cable between the two halves. High unless it misbehaves.',
      detail:
        'Choose a speed, then turn on Apply to change both halves together. At startup the halves meet at Low and step up to the speed you stored; if that step fails they stay at Low for that session and the LED gives three long red pulses. Only drop the speed if the link is actually unreliable.',
    },
  ],
  [
    'id_qmk_eeprom_sync_',
    {
      summary: 'Keeps the two halves in step: settings, input and lighting.',
      detail:
        'All three are on by default and there is rarely a reason to change that. After you alter something the keyboard stores, give it a few seconds and reload VIA on the other half before deciding whether it took.',
    },
  ],
  [
    'id_qmk_ver_',
    {
      summary: 'The firmware build date this keyboard is running.',
      detail:
        'Year, month, day and revision, read back from the keyboard. Quote it when you report a problem — it is the only way to tell two builds apart.',
    },
  ],
  [
    'id_qmk_custom_ind_',
    {
      summary: 'Which LED shows Caps Lock, Scroll Lock or Num Lock.',
      detail:
        'Pick what each indicator watches, then give it a brightness and a colour. An indicator takes over its LED only while that lock is on; the rest of the time the normal lighting has it.',
    },
  ],
  [
    'id_qmk_rgblight_',
    {
      summary: 'Brightness, effect, speed and colour for the lighting.',
      detail:
        'Only the lighting your keyboard actually has shows up here. Velocikey, where it exists, speeds the effect up the faster you type and ignores the speed slider while it is on.',
    },
  ],
  [
    'id_qmk_rgb_matrix_',
    {
      summary: 'Brightness, effect, speed and colour for the lighting.',
      detail:
        'Only the lighting your keyboard actually has shows up here. Velocikey, where it exists, speeds the effect up the faster you type and ignores the speed slider while it is on.',
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
// the value. That is true when the choices are proper nouns whose names do not
// describe what they do (Balanced / Fast / Advanced, Permissive Hold), and when the
// label states a specification rather than a consequence — a DEBOUNCE row called
// "Press & Release - delay before and after (same value)" says what the firmware does
// with the number but not that raising it delays every keystroke.
//
// It is not for a control whose unit is already the answer (Cursor Top Speed at 16 px,
// Repeat Time at 80 ms), nor for one the submenu summary above already takes as its
// subject — Global Tapping Term and Anti-Ghosting's Enable are what those summaries are
// about, so repeating them one row lower would be noise.
//
// Keyed off exact firmware command names, the same gate the submenu text uses. Two rows
// can share one command id and mean different things depending on the debounce mode, so
// those entries also name the labels they belong to; both the H7S spelled-out labels and
// the shorter RP2040 ones are listed. An unmatched label renders no help, which is the
// right failure — text about the wrong side of the debounce window is worse than none.
type EraControlHelp = {
  command: string;
  labels?: readonly string[];
  help: string;
};

const HELP_BY_CONTROL: readonly EraControlHelp[] = [
  {
    command: 'id_qmk_kkuk_mode',
    help: 'Report Pulse is the only behaviour the firmware implements, and it is what the rest of this menu describes: the held group is released and pressed again on the Repeat Time. The dropdown exists because the setting is stored as a number with room for more; picking anything else is ignored.',
  },
  {
    command: 'id_qmk_debounce_mode',
    help: 'Balanced waits: nothing is sent until the switch has held still for the set time, on the way down and on the way up alike, so every press registers that many milliseconds late. Fast sends the change the instant it happens and then stops listening to that key for the set time — nothing is added to how fast a key registers, but a bounce that arrives after the window can still double. Advanced is Fast on the press and Balanced on the release, with a separate time for each. Start with Balanced and only move off it if you can feel the delay.',
  },
  {
    command: 'id_qmk_debounce_time_single',
    help: 'One number for both directions. A press or a release is reported only once the switch has stayed quiet this long, so this is also how much later every key registers. 5 to 10 ms covers most switches — raise it while a press is still doubling, and stop as soon as it is not.',
  },
  {
    command: 'id_qmk_debounce_time_post',
    labels: [
      'Press & Release - delay after change (post-only)',
      'Press & Release Cooldown',
    ],
    help: 'Fast reports the change straight away, then stops listening to that key for this long. It costs you nothing in response time, so the only reason to raise it is a press that still doubles — this window is the only thing catching the bounce.',
  },
  {
    command: 'id_qmk_debounce_time_pre',
    help: 'The press side of Advanced. The press goes out immediately and that key is then ignored for this long, so raising it does not slow the keyboard down. It only has to outlast the bounce on the way down.',
  },
  {
    command: 'id_qmk_debounce_time_post',
    labels: [
      'Release - delay before and after release (pre+post window)',
      'Release Delay',
    ],
    help: 'The release side of Advanced. Letting go is reported only once the switch has stayed quiet this long, which is where most chatter lives. It delays the release and not the press, so holding a key and typing feel the same.',
  },
  {
    command: 'id_qmk_tapping_permissive_hold',
    help: 'For holds that do not take when you move fast. With this on, a tap-hold key becomes the hold as soon as another key is pressed and released while you are still holding it: hold a Shift Mod-Tap, tap b, and you get B even inside the waiting time. Off, that same sequence types both letters instead. Hold on Other Key Press is the blunt version of this — it decides when the other key goes down, this one waits for it to come back up.',
  },
  {
    command: 'id_qmk_tapping_hold_on_other_key_press',
    help: 'The strongest of the three. A tap-hold key becomes the hold the moment any other key goes down, without waiting for it to come back up. Turn it on if holds still come out as letters with Permissive Hold on. It costs you rolls: pressing the tap-hold key and the next key almost together now gives the hold, which hurts most on a Mod-Tap sitting on a home-row letter.',
  },
  {
    command: 'id_qmk_tapping_retro_tapping',
    help: 'For letters that vanish when you rest on a key too long. Normally a tap-hold key held past the term and let go with nothing pressed in between sends nothing at all. With this on it sends the tap anyway. It changes nothing about the case where you did press another key, so it sits safely next to either switch above.',
  },
];

// Every string in both tables is rendered through `t()`, so each one has to exist as a
// key in all six catalogs or that language silently falls back to English. Editing the
// English text without updating the locales is the easy mistake here, so the locale
// test reads this list rather than trusting anyone to remember.
export const eraHelpStrings = (): string[] => [
  ...HELP_BY_COMMAND_PREFIX.flatMap(([, {summary, detail}]) => [
    summary,
    detail,
  ]),
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
    if (entry.command !== commandName) {
      continue;
    }
    if (entry.labels && !entry.labels.some((known) => known === label)) {
      continue;
    }
    return entry.help;
  }
  return null;
};
