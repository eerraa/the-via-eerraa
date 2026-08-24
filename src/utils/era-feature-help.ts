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
// the setting does and how to choose a value.

export type EraFeatureHelp = {
  /** One line, always visible above the controls. */
  summary: string;
  /** Shown when the reader opens the disclosure. */
  detail: string;
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
  [
    'id_qmk_kill_switch_',
    {
      summary:
        'While you hold two opposite keys, only the one you pressed last counts.',
      detail:
        'Set each pair to the two keys that fight each other, usually A and D, then W and S. Let one go and control passes straight back to the other, so you can change direction without releasing first. Competitive rules differ on this — check yours before you rely on it in a match.',
    },
  ],
  [
    'id_qmk_kkuk_',
    {
      summary:
        'Re-sends a key you are still holding so the PC cannot forget it.',
      detail:
        'Some games drop a held key when a lot happens at once. This sends it again on a timer: First Delay is how long you have to hold before that starts, Repeat is how often it goes out afterwards. Keys you assigned to SOCD are left out of it.',
    },
  ],
  [
    'id_qmk_debounce_',
    {
      summary: 'Filters switch chatter, so one press sends one keystroke.',
      detail:
        'Balanced at 5 ms suits most switches. Raise the time only if a single press sometimes types twice, and go up a little at a time — every millisecond you add is a millisecond the key takes to register. Fast reacts sooner on a clean switch; Advanced lets you set the press and release windows separately.',
    },
  ],
  [
    'id_qmk_tapping_',
    {
      summary:
        'How long a tap-hold key waits before it decides you meant the hold.',
      detail:
        'This covers Mod-Tap and Layer-Tap keys, and 200 ms is the default. Shorter makes holds trigger sooner but turns fast typing into accidental holds; longer is more forgiving but the hold arrives late. The toggles change what happens when you press another key partway through — worth trying one at a time rather than all at once.',
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
