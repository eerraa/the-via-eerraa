# 0003 — ERA menu help and diagnostics screen UI

Status: Accepted
Genre: contract
Canonical for: diagnostics-block placement and information architecture,
observation-copy constraints, word choice and type scale, locale rules, per-control
ⓘ attach rules for ERA menu help, menu-name decisions, and VERSION read-only
presentation

ERA-only menus shipped as labels with no explanation. USB diagnostics is the
screen with the most copy. Both use the same disclosure
(`src/components/inputs/explain.tsx`), so they share this contract. Wire and
instrumentation are [ADR 0002](0002-h7s-usb-diagnostics.md). Definition
ownership is `docs/PROJECT_DIRECTION.md`.

Re-measured from this host: `src/components/panes/configure-panes/custom/`,
`src/utils/era-feature-help.ts`, `src/locales/*.json`,
`era-definitions/custom/v3`, `tests/locales.test.ts`,
`tests/custom-menu-pane.test.tsx`, `tests/diagnostics-pane.test.tsx`,
`tests/era-definition.test.ts`. Peer firmware user guides are
`qmk_firmware_eerraa/keyboards/era/common/docs/user/usevia.txt`,
`qmk_firmware_eerraa/keyboards/era/common/docs/user/usevia_split.txt`, and
`eerraa-qmk-h7s-fw/docs/usevia.txt`; H7S also has five board
`json/*-VIA.JSON` files.

## 1. The diagnostics block sits inline under the setting it measures

The block renders **always expanded** under `Apply Selected Mode` in
`CONFIGURE → SYSTEM → USB POLLING`.

A top-level `/diagnostics` page failed two ways, which is why inline placement
is the contract:

- The user who just changed polling mode had to leave that submenu to see the
  effect, and did not find it.
- The top-level tab is meaningful only on the five H7S definitions, yet it
  showed on every keyboard. That breaks the fork rule that ordinary VIA visual
  language and workflow are preserved.

A modal hides the function one more step and, during a 10 / 30 / 60 s session
that must stay open, a mis-close leaves only the firmware session. An accordion
has the same discoverability cost.

> **REFUSED:** a top-level `/diagnostics` page, a modal, or an accordion.
> **WHY:** the top-level tab is H7S-only yet appeared on every keyboard, the
> measurement was not on the screen where mode is changed, and a modal or
> accordion can close or fold a live 10 / 30 / 60 s session while firmware
> keeps running.
> **REOPENS:** none. Ordinary VIA visual language and workflow stay.

> **REFUSED:** putting the diagnostics block in as a definition-JSON menu item.
> **WHY:** `menu-generator.tsx` renders it from `id_qmk_usb_bootmode` plus the
> `usbDiagnostics` opt-in, so the same keyboard opened from the official
> snapshot or a Design upload never sends selector `0x07`.
> **REOPENS:** none.

`submenuGenerator` in
`src/components/panes/configure-panes/custom/menu-generator.tsx` sets
`hasPollingModeControl` when a submenu item's command is
`USB_POLLING_MODE_COMMAND` (`id_qmk_usb_bootmode`,
`src/utils/custom-menu.ts`) and then mounts `UsbDiagnosticsSection`. The
section returns null unless `shouldProbeUsbDiagnostics(definitionSource, vpid)`
is true: effective source `era` and canonical metadata `usbDiagnostics: true`
(`src/utils/era-advanced-metadata.ts`). That is the five H7S definitions
(`config/era-definitions.manifest.json`).
`tests/custom-menu-pane.test.tsx` locks placement after `Apply Selected Mode`
and the opt-in / official-source omissions.

Two side effects of inline placement:

- The user can measure without leaving the polling-mode screen, so a page
  change no longer kills the session. Changing submenu or category still
  unmounts the section and saves the run as `aborted`; that fact is shown on
  screen while a run is active.
- The retired top-level page left `configureVisible` false, which stopped the
  State Sync 500 ms recovery poll. Inline placement measures with Configure
  visible, so that poll shares the per-path serial WebHID queue with diagnostic
  snapshot reads. Control traffic rises by about two exchanges per second and
  is handled on the main loop, so `loop max` / stall-count baselines can rise.
  Recovery is not changed for the measurement window — refusing to couple
  selector `0x07` to polling mode or recovery is
  [ADR 0002](0002-h7s-usb-diagnostics.md). Loop timing from the retired page
  and from this block are not comparable
  ([ADR 0002](0002-h7s-usb-diagnostics.md) comparison grouping).

`src/utils/pane-config.ts` has no Diagnostics icon. `src/Routes.tsx` keeps
`/diagnostics` as a redirect to `/` so an open tab or bookmark is not a blank
page. A cold deeplink on the deploy host does not hit that redirect
(`docs/MAP.md` §7).

Peer official-VIA guide `eerraa-qmk-h7s-fw/docs/usevia.txt` intentionally
documents official usevia.app only and therefore does not name this custom-app
diagnostics block. Its placement and copy remain owned by this ADR.

## 2. Result screen: summary by default, advanced on request

Showing nine panels at once was unreadable. The hardware-confirmed caveats
still have to stay reachable.

> **REFUSED:** deleting advanced metrics, or moving the comparison table to
> copy-paste text only.
> **WHY:** dropping the `Spread` / `Queue` columns returns the
> phase-dependent misread those columns exist to prevent.
> **REOPENS:** none. The default is a summary; advanced is on request.

**Summary view + `Advanced metrics and mode comparison` toggle**, the same
family as Settings `Show Diagnostic Information`. The toggle sits **above**
the panel it opens (`AdvancedRow` then `AdvancedPanel` in
`src/components/panes/configure-panes/custom/usb-diagnostics-section.tsx`).
Below the content, turning it on would grow the page in both directions.

The summary answers one question: whether this window, in this mode, observed
a problem. Five topics, two-column definition list, plain-language name on the
left and an observation fragment on the right
(`DiagnosticsResultView` `detail="summary"` in
`src/components/panes/diagnostics-results.tsx`):

| Topic (locale key) | Measures |
| --- | --- |
| `Lost key presses` | report-queue drop |
| `USB link changes` | USB hard event (reset / configuration / suspend / speed change) |
| `Firmware pauses (over {{threshold}})` | main-loop gap over 1 ms |
| `Most waiting to send` | queue-depth peak |
| `Connection speed` | selected mode vs negotiated speed |

Absolute µs, normalized quantiles, histogram, trend, timeline, and boot
counters move to advanced. Those numbers mislead without their captions; the
summary omits the numbers rather than showing them caption-less.

Controls render only when they can act. Recovery and leftover-session actions
live **inside the card that explains that situation**, so the buttons can be
`Show It` / `Discard It` / `Stop It`. The default control row is `Test
duration` + `Start Test`. `Read Device Result` failed because it named an
action (read from the device) and not the situation (sleep / reload /
reconnect left a finished session on the keyboard); shortening it made that
worse.

### Stays on screen, not behind a disclosure

A fact that reverses a reading is not folded.

- Speed-mismatch caveat in full (conditional; when it appears, all of it shows)
- Identity of the run on screen, and that Copy follows that run
- Boot counters: "These were read when the test finished. They do not tick up
  while you watch." Hardware validation misread these as live twice.
- Comparison one-liner: compare runs with Spread / drops / queue — average and
  maximum include an offset redrawn on every replug (full reasoning folded)

`tests/diagnostics-pane.test.tsx` strips `hidden` markup and asserts the
on-screen set separately from the shipped set.

## 3. Observation copy must not become a verdict

Diagnostics states **only what was observed in the measured window**. "No
report queue drops were observed" is allowed. stable / perfect / certified /
a composite score are not.

**Cause:** hardware validation produced the wrong conclusion twice from exactly
this kind of over-claim. A sentence that covers failure categories the test
never measured was read as "this is fine." Dropping the cause leaves nothing
to stop the next dashboard from adding a score.

- The UI states the scope: "These five lines are everything this test looks
  at. Anything else that could go wrong is simply outside what it measures."
- `reportSamples === 0` adds "No keys were pressed during this test. Type
  while the next one runs." A window with no keypresses makes every delivery
  sentence vacuously true and reads as a clean result.
- **Translation is in scope.** A fluent rendering that promotes "not
  observed" to "stable" or "no problems" breaks the contract.
  `tests/locales.test.ts` runs per-language verdict regexes on
  `DIAGNOSTIC_OBSERVATION_KEYS` and checks that every `{{placeholder}}`
  survives.
- **Scope is diagnostic observation keys only.** Settings copy is not in
  that list — "lower the speed only when the connection is actually unstable"
  is cable advice, and "unstable" is the right word there. The checker first
  flagged those sentences, so the list is the test file's
  `DIAGNOSTIC_OBSERVATION_KEYS`, read from source, not restated in two places.

## 4. Words and type scale

`report` is HID, `enumerate` is USB spec, `queue depth` is firmware. None of
those names help someone who came to change polling rate. **The measured
object stays; the word changes** — "lost key presses", not "dropped HID
reports"; "USB link changes", not "USB link interruption".

Identifiers left untranslated, matching copied reports, the comparison table,
and firmware docs: `FS 1K` `HS 8K` `Full Speed` `High Speed` `p50/p95/p99`
`EEPROM` `RAM`. `enumerate` remains only in the folded comparison commentary,
where the reader asked for precision.

The two-column layout already supplies the subject, so values are fragments
("Not observed", not "was not observed in this test"). Scope lives in the row
name and the heading above (`What this {{seconds}}-second test observed`).

Dense data panels need an explicit scale. Without one they inherit the VIA
menu row (`ControlRow` in `src/components/panes/grid.tsx`: font-size 20 px,
min-height 50 px) and the least important line on a card becomes the largest.
Measured from `usb-diagnostics-section.tsx` and `diagnostics-results.tsx`:

```
18  section title
16  summary headline
15  section body · panel title · summary answer row
14  metric label/value · tab · guidance
13  secondary copy · disclosure body · comparison table · histogram
12  timeline axis labels
```

Buttons and the duration select in this block are 36 px high, not the 50 px
menu row. The `State: …` line is 13 px (`Muted`); it must read smaller than
the 15 px answer rows. The 16 px summary headline must not outrank a 15 px
panel title.

The block is named for the setting it sits under, not the instrumentation
object. `USB Polling Diagnostics`, not `USB Delivery Diagnostics`: it lives
in `USB POLLING` and answers "how is this polling mode behaving."

## 5. Locales

All six catalogs (`de en es ja ko zh`) get every key. Keys are the English
source, so a missing translation degrades to readable English — and therefore
breaks **silently**.

- **Translate after the English sentence is settled.** The other order
  translates a fuzzy sentence six times, then edits it six times.
- **`Copy Diagnostic Report` body stays English.**
  `buildUsbDiagnosticReport` in `src/utils/usb-diagnostics-history.ts` is
  hardcoded English, including "it is not a stability certification." That
  text is pasted into a maintainer bug report; translating it makes the
  receiving side unable to read it. The button label may translate.
- **`t()` is held in a ref in session callbacks.** Putting it on the
  dependency array of `finishActive` changes that callback's identity on a
  language switch, and the cleanup effect that depends on it **aborts a
  running measurement** (`translate` in
  `src/components/panes/configure-panes/custom/usb-diagnostics-section.tsx`).
- Key-parity across the six files does not catch a reworded English string
  that never reached the catalogs. `eraHelpStrings()` in
  `src/utils/era-feature-help.ts` exposes every help string;
  `tests/locales.test.ts` asserts each is a key in all six catalogs. The test
  reads the list from source.

## 6. ERA menu help

`src/utils/era-feature-help.ts` holds the tables.
`src/components/panes/configure-panes/custom/feature-help.tsx` renders a
one-line summary above the submenu controls. A folded detail is present only
when the summary is not the whole answer. Lighting pages use the direct summary
alone; explanation that belongs to one control sits on that control's ⓘ.

**Keys are firmware command ids, not menu labels.** Labels are free text; an
ordinary VIA definition can also name a menu `TAPPING`. `id_qmk_tapping_*`
exists only in ERA firmware, so another keyboard never inherits this copy.
Same gate idea as the diagnostics block.

Firmware user-guide text is rewritten, not copied. The guide says "adjust this
under VIA CONFIGURE → FEATURE → DEBOUNCE"; the reader of this text is already
on that screen. What remains is what the setting does and which way to move
the value. The peer `usevia.txt` guides keep the same user-visible meaning,
terms, trade-offs, and recommendations as the summary/detail/control help here,
then add official-VIA navigation and firmware-family differences that the user
can actually observe. They do not reintroduce internal mechanism that this Help
intentionally omits merely because the firmware can describe it. The peer
guides are `qmk_firmware_eerraa/keyboards/era/common/docs/user/usevia.txt`,
`qmk_firmware_eerraa/keyboards/era/common/docs/user/usevia_split.txt`, and
`eerraa-qmk-h7s-fw/docs/usevia.txt`.

- **A summary names the setting; it is not a narration.** `Enters the
  bootloader when switched on.`, not `Puts the keyboard into bootloader mode
  so you can flash firmware.` Mixing lengths makes the remaining summaries
  look padded, so every summary has the same shape.
- **Detail is optional and stops at the user-visible result.** Mechanism is
  stripped. A summary-only page does not get an empty or redundant disclosure.
- Summary: **at most 12 English words, no second person, one sentence in all
  six languages.** Addressing the reader belongs in the detail.
  `tests/locales.test.ts` checks all three; it caught a Japanese USB POLLING
  summary that was still two sentences.
- Detail has no word cap. Shape, not length, is the grain.

**One feature can use two command families.** SOCD is `id_qmk_socd_*` on
RP2040 and `id_qmk_kill_switch_*` on H7S; both prefixes share one help object.
Registering only one left twenty-five definitions with no help and nothing
failed — no test asked whether every ERA submenu actually resolves. 
`tests/era-definition.test.ts` asks, and a submenu that is allowed to have
none must be named in `SUBMENUS_WITHOUT_HELP` (currently `Backlight` only).
`SYSTEM -> SLEEP` is intentionally not an exception. TOMAK uses the exact-second
channel 9 / id 11 command and H7S uses the stock minute-preset channel 18 / id 1
command, but both resolve to the same summary: the value is an input-idle RGB
timeout. The folded detail carries only the 10-minute default and keypress wake
behaviour. DUAL-HOST/HOST-PEER ownership, USB suspend, and frame-loss
terminology are firmware mechanics and are omitted from this user-facing help.

The custom exact-second SLEEP surface has two independent write lifecycles.
`RGB Sleep` is the master and writes immediately when its toggle changes. It is
never staged behind the submenu's `Apply` button. Only
`id_qmk_rgb_sleep_timeout_exact` is deferred: editing the seconds field enables
`Apply`, and that button commits only the timeout draft. The timeout row's V3
`showIf` follows the authoritative/optimistic menu value for
`id_qmk_rgb_sleep_enable`, so switching the master off hides the timeout as soon
as the immediate master write is accepted (and restores it if that write is
rolled back).

## 7. Per-control ⓘ

One submenu-top ⓘ cannot explain DEBOUNCE. The chosen layout puts the answer
next to the question: the `Debounce Mode` dropdown's ⓘ compares the three
modes, and each `showIf` ms row's ⓘ explains only that row.

> **REFUSED:** expanding the submenu-top ⓘ body (A), and mode-conditional
> top copy (B).
> **WHY:** (A) makes the reader hunt the sentence for the row on screen — on
> TAPPING that paragraph becomes eight sentences — and (B) hides the unchosen
> modes at the moment a comparison is needed.
> **REOPENS:** none.

### Attach rule

Scattered attachments raise "why does only this row have help?", so the rule
is fixed.

> Per-control ⓘ attaches only when the label cannot answer which way to move
> the value.
>
> Attach: (a) the choices are proper nouns whose names do not describe the
> behaviour (`Balanced` / `Fast` / `Advanced`, `Permissive Hold`). (b) the
> label states a specification, not a consequence —
> `Press & Release - delay before and after (same value)` says what the
> firmware does with the number, not that raising it delays every keystroke.
>
> Do not attach: a control whose unit is the whole answer (`Indicator
> Brightness`) or a control the **submenu summary already takes as its subject**
> (`Global Tapping Term (ms)`, KKUK `Enable`). Repeating that information one
> line down is noise.

TAPPING therefore has no ⓘ on row 1 and has ⓘ on rows 2–4. That is the rule
working, not a hole. MOUSE was first skipped as "the unit is the answer" and
**that was wrong** — the unit says how much, never of what. `Cursor
Acceleration` `1.0 s` is ramp time; `Cursor Steps Per Second` `100 /s` is an
event rate that does not change that ramp; the pointer-speed rows swap meaning
when acceleration is on. That is (b). Those rows now have one line each
(`HELP_BY_CONTROL` in `src/utils/era-feature-help.ts`).

### How keys are matched

Exact firmware command name (same idea as the submenu gate, narrower). When
one command id means two things, **the label is matched as well.**

- `id_qmk_debounce_time_post` is Fast's `Press & Release - delay after change
  (post-only)` and Advanced's `Release - delay before and after release
  (pre+post window)` and **means different things per mode.** Both the H7S
  spelled-out labels and the shorter RP2040 labels (`Press & Release
  Cooldown` / `Release Delay`) are registered.
- `id_qmk_mousekey_cursor_min_speed` is `Cursor Speed` (acceleration Off) and
  `Cursor Start Speed` (acceleration On).
- A label that matches neither **renders no help.** Wrong-side debounce copy
  is worse than none.
- TAPDANCE repeats the same five controls across eight slots, so exact-name
  matching would need forty entries. `commandPrefix` `id_qmk_tapdance_` plus
  row label covers all slots with four entries.

Neither SOCD nor KKUK exposes a fixed one-option `Mode` row. RP2040 firmware
still accepts the shipped mode value ids so cached older VIA definitions remain
compatible, but the only legal values are Last Input Wins for SOCD and Report
Pulse for KKUK. A dropdown with no alternative is not a setting and adds a
label the user has to interpret without giving them a decision. The submenu
summary explains the fixed behaviour instead. If a second firmware mode is
ever implemented, the dropdown returns together with per-control help that
compares the real alternatives.

### Implementation contract

`Explain` renders the button and body as adjacent siblings, which cannot sit
inside `ControlRow` (label left / Detail right): putting the body before
Detail wraps the control onto a third line. `explain.tsx` exports
`useExplainDisclosure()` and `ExplainBody` so the caller places them.

**Folded copy stays in the DOM and is only `hidden`.** Find-in-page and
assistive tech still reach it, and the §3 tests stay valid. The hook does not
export `open`; it hands out already-resolved `hidden` on `bodyProps`, so a
caller cannot write `{open && <Body/>}`. The fold contract is a type, not a
doc line.

Only rows with help use the wrapping `HelpfulControlRow`; others keep the
two-column `ControlRow`. `aria-label` is `What this means: {{name}}` so several
ⓘ on one screen are not read as the same control.

`tests/custom-menu-pane.test.tsx` locks Debounce Mode ⓘ, Fast vs Advanced
copy on the shared command id, and the absent ⓘ on `Global Tapping Term (ms)`.

Long folded explanations use blank-line paragraph breaks. `ExplainBody` in
`src/components/inputs/explain.tsx` renders translated newlines with
`white-space: pre-line`. The LINK speed control follows the same Debounce
pattern: its dropdown says only `High` / `Medium` / `Low`, while the
control's ⓘ gives 460800 / 230400 / 115200 bps and the 1 / 2 / 4 ms DUAL-HOST
layer-sharing periods. HOST-PEER (Master–Slave) behavior changes very little.

## 8. Names follow behaviour

### `KKUK`

With two or more basic keys held, after `delay_time` it sends a
full-group-release report every `repeat_time` and restores the original
report. Holding `asd` types `asdasdasd`, not OS auto-repeat `asddddd`.

Five official H7S `json/*-VIA.JSON` files and this host's five H7S custom JSON
files all label the submenu `KKUK`. Peer
`eerraa-qmk-h7s-fw/docs/usevia.txt` describes the same behavior and label.

The label is the English token `KKUK` in every catalog (`"KKUK": "KKUK"`), so
official `usevia.app` shows the same name. Recognition is carried by the
summary's `asdasdasd` example, which does not depend on language. A Korean
colloquial name as a catalog key would ship as a meaningless proper noun to
German and Spanish readers.

### Badge control names describe their scope

The badge page uses `RGB-Only` and `Indicator-Only`. `RGB-Only` makes the badge
the only area receiving the selected RGB effect. `Indicator-Only` removes RGB
effect influence from the badge and leaves it as the selected lock indicator.
The page heading itself has no disclosure; these two rows and `Lock Indicator`
carry the explanations beside the controls. Scope is the three split boards
(`tomak`, `tomak79h`, `tomak79s`), six left/right definitions. H7S has no Badge
Lighting menu — official and custom JSON both have Lighting → `INDICATOR`
(`id_qmk_custom_ind_*`), a different page.

### Lighting summaries follow the visible hardware surface

RGB Matrix says it configures switch RGB brightness, effects, speed and color.
RGBLight says it configures RGB lighting brightness, effects, speed and color,
without assuming whether a board labels that area `Underglow` or `RGB ROW`.
Backlight says it configures backlight brightness and effects. All three are
summary-only.

Velocikey is not an RGB Matrix control. A Velocikey ⓘ appears only beside an
existing RGBLight Velocikey control (`id_qmk_velocikey_toggle` or the board-local
`id_qmk_custom_velocikey_enable`). No RGB Matrix page gains a Velocikey toggle
or Velocikey help merely because it shares this Lighting category.

### Labels change in JSON; command ids do not

A label-only rename that leaves the app and the firmware-local official JSON
on different names creates a larger confusion than it removes. Same rule as
`docs/PROJECT_DIRECTION.md`: a custom-app-only path is an error.

Labels live in JSON. **Channel, value id, EEPROM layout, and firmware code do
not change.** No rebuild and no firmware version bump; a keyboard already
flashed shows the new name once the new JSON is loaded.

Which definitions carry which menu is family-specific.
`tests/era-definition.test.ts` `FEATURE_COVERAGE` is canonical.

This host's H7S custom JSON suffixes TAPPING / TAPDANCE terms with `(ms)`
(`Global Tapping Term (ms)`, `Term (ms)`). The five official H7S
`json/*-VIA.JSON` files use `Global Tapping Term` and `Term`. Command ids
match. The ⓘ skip keys off the control being the submenu summary's subject,
not the suffix. Menu-name tokens `KKUK` / `MOUSE` / absence of `NKRO` and the
Badge `RGB-Only` / `Indicator-Only` labels match the firmware-local VIA JSON.
The shared SOCD, DEBOUNCE and TAPPING controls use the same concise labels and
order on both firmware families; the help matcher still accepts the older H7S
spelled-out DEBOUNCE labels for cached definitions. Both firmware families
place SLEEP under SYSTEM; H7S uses the stock 1/3/5/10/30/60-minute control while
TOMAK uses the custom exact-second control. Both families call the final reset
submenu `EEPROM`.

### VERSION is one read-only value

Both firmware families use the `VERSION` submenu, the same summary and folded
detail from `src/utils/era-feature-help.ts`, and the same `FirmwareVersion`
row in
`src/components/panes/configure-panes/custom/firmware-version.tsx`. The row is
`Current Version` plus one value in the ordinary custom-menu type scale. It has
no input, SET action, or SAVE action.

Both firmware families carry one `label` command named
`id_qmk_ver_ascii`. Twenty-five RP2040 definitions use channel 8 / id 1; the
five H7S definitions use the additive channel 8 / id 5. GET data is
NUL-terminated ASCII `YYMMDDRn`. The ATmega32U4 `brick65` definition is
excluded because it does not run the ERA common layer. H7S firmware retains
its old zero-based ids 1–4 for cached old definitions, but current official
and custom JSON expose only id 5. No dropdown adapter remains in this app.

`src/utils/era-firmware-version.ts` is the display grammar. RP2040 data must
contain printable ASCII, the NUL terminator, and a valid `YYMMDDRn` value.
Bytes after that NUL belong to the surrounding HID report and are ignored.
Malformed ASCII data renders an em dash, never a partial or guessed release.
The displayed release is always decoded from the selected keyboard's Custom
Value GET snapshot; no release string in definition JSON or component source
may stand in for firmware data. A static string goes stale as soon as another
firmware is connected, while editable dropdowns falsely promise that firmware
identity can be changed from the configurator.

## 9. Do not invent a toggle the firmware does not have

H7S five definitions expose MOUSE on channel 17. Firmware already implemented
mouse-key settings; QMK channel 13 is USB POLLING on H7S, so `via.h` assigns
`id_qmk_mousekey = 17`. The five official H7S `json/*-VIA.JSON` files carry
the same block. Editing only this host's custom JSON would show MOUSE in the
custom app and hide it on official `usevia.app`.

> **REFUSED:** an NKRO toggle on H7S.
> **WHY:** those boards are always 20-key rollover with no on/off option, so a
> toggle would present a choice the firmware does not have.
> **REOPENS:** none.

`tests/era-definition.test.ts` asserts H7S FEATURE is `SOCD`, `KKUK`,
`DEBOUNCE`, `TAPPING`, `MOUSE`; SYSTEM is `VERSION`, `USB POLLING`, `SLEEP`,
`BOOT`, `EEPROM`; channel 17 carries mouse commands; channel 18 / value 1 carries
the minute RGB sleep dropdown; and H7S has no `id_qmk_custom_nkro`. It also
rejects fixed SOCD/KKUK mode rows and locks the shared KKUK/TAPPING control
order.

## 10. Verification

This repo:

- summary / advanced copy, on-screen vs folded caveats, no verdict wording —
  `tests/diagnostics-pane.test.tsx`
- inline placement, opt-in / official-source gate, menu help, per-control ⓘ —
  `tests/custom-menu-pane.test.tsx`
- translation presence, observation verdict regexes, summary shape —
  `tests/locales.test.ts`
- help coverage, MOUSE channel, H7S SLEEP dropdown, NKRO absence,
  `FEATURE_COVERAGE` —
  `tests/era-definition.test.ts`
- VERSION decoder and the shared non-editable row —
  `tests/custom-menu-pane.test.tsx`
- VERSION definition count, H7S additive id 5, split-pair equality and
  `brick65` exclusion — `tests/era-definition.test.ts`

`test:p1` includes the locale, definition, and docs-contract files.
`test:transport` includes the pane and custom-menu files.

Automated tests do not replace hardware:

1. `USB POLLING` shows the diagnostics block under `Apply Selected Mode`; the
   icon bar has no Diagnostics icon.
2. A non-H7S keyboard, and H7S opened from official/upload, show no block and
   send no selector `0x07`.
3. A 30 s test finishes if the polling-mode dropdown is left alone; changing
   submenu saves `aborted` and recovers with `Show It`.
4. Same mode, same boot: do not compare `loop max` / stall count / queue peak
   against the retired top-level page (§1).
5. Advanced on: comparison `Spread` / `Queue` columns and `speed mismatch`
   marking are visible.
6. ko / ja / zh / de / es: summary and situation cards do not clip or overlap.
   German is the longest and fails first on the left column of the two-column
   list.
7. The summary card is fully visible without scrolling; opening ⓘ grows the
   card instead of clipping it.
8. Four advanced tabs each fit one screen; switching tabs does not flash the
   charts.
9. §4 type scale reads as hierarchy: `State: …` smaller than answer rows;
   summary headline not larger than panel titles.
10. FEATURE / TAPDANCE / SYSTEM / Lighting submenus show a one-line summary;
    ordinary VIA keyboards do not. RGB Matrix and Backlight have no redundant
    heading disclosure, and Velocikey help appears only on an actual RGBLight
    Velocikey row.
11. DEBOUNCE mode change swaps the ms row and that row's ⓘ copy; Fast and
    Advanced Release share a command id and must not share copy.
12. MOUSE on H7S five boards reads and writes and survives reconnect.
    Acceleration Off is one `Cursor Speed` row; otherwise `Cursor Start/Top
    Speed`.
