# ERA VIA Fork — product direction

Genre: contract
Canonical for: what this fork is for, its priority order, definition ownership and
lookup order, user-facing VIA compatibility boundary, the brick65 exception,
Tap Dance and exact-ms/exact-sec product rules, QMK and H7S lighting sleep dual-surface rules,
State Sync product guarantees, LM20 app-first configuration, complete settings backup/restore,
and the durable non-goals

> Durable project brief: what the product is for and what must never be done to
> it. Where a fact lives and which side is canonical is `docs/MAP.md`. Individual
> decisions with rejected alternatives are `docs/adr/`. Transient state is not
> recorded anywhere — `git log` and the verification commands answer it.

Implementation/source ownership and verification entry points are
`docs/MAP.md` §§1–4. Wire and exact-ms requirements are
[ADR 0001](adr/0001-state-sync-protocol.md); USB polling observation and diagnostics retirement are
[ADR 0002](adr/0002-h7s-usb-diagnostics.md); user-facing ERA help and observation
UI requirements are [ADR 0003](adr/0003-era-menu-help-ui.md). This file keeps
product boundaries and reasons rather than a second implementation inventory.

## Mission

Build an unofficial, manufacturer-neutral VIA fork for ERA PCB and firmware
work while retaining the experience and compatibility of upstream VIA. This is
not a clean-sheet configurator and not a rebrand for SIRIND, NEWONE, Linx3, or
another keyboard manufacturer. ERA/eerraa identifies the PCB/firmware platform
and fork maintainer.

Priority order:

1. Firmware remains the authoritative source of keyboard state.
2. Supported keyboards work without manual JSON loading or page refreshes.
3. Ordinary VIA keyboards and existing VIA V3 definition/command paths continue
   to work.
4. Configurator control-plane traffic does not impair the 8 kHz input data-plane.
5. Complexity is introduced only for a demonstrated correctness, recovery, or
   maintenance need.

Upstream diff minimization is useful but is not an end in itself. A well-tested
core improvement is preferable to an ERA-specific workaround when VIA's existing
architecture is the actual limitation.

> **REFUSED:** optimizing for a small upstream diff at the expense of
> demonstrated correctness, or adding a speculative framework with no measured
> need.
> **WHY:** complexity is admitted only for a demonstrated correctness, recovery,
> or maintenance need; diff size is not itself a product goal.
> **REOPENS:** never.

## LM20 configuration and device management

These are approved product requirements, not claims of implemented LM20 support. The peer LM20
firmware owns wire, settings-bank encoding, mode authority and protected actions in its SPEC §9/§10.
Its PLAN owns the cross-repository two-DK implementation sequence. Do not copy numeric wire contracts
or development status into this document. Existing QMK/H7S behavior stays family-specific.

- When a dongle is selected, the default **Whole keyboard (RF)** view shows only its currently online
  units in their physical left/right positions. Keys are directly editable; show the selected key's unit and layer. No online
  units means an empty keyboard area with a connection explanation and instructions, while dongle
  settings and device management remain accessible. Disconnect removes that unit from the keyboard
  and leaves its registration visible as offline in device management; it does not delete pairing.
- Put a unit selector in a corner of the keymap tab, with **Whole keyboard (RF)** as the return option.
  Unit entries include only currently connected units whose own settings can actually be read and
  changed through the dongle; omit offline or unsupported units rather than listing disabled entries.
  Selecting a unit shows only its layout and loads its saved unit-local WIRED/BLE settings from that
  unit. This is not a per-unit RF override. Clearly label the unit and the bank being edited; do not
  enable editing until the target read completes. BLE slot choices remain subject to Q-130 below.
  Changes are sent through the dongle and saved on that unit under the peer SPEC §10.7 contract.
  Show saved values separately from the currently active settings: with **Always use dongle settings**
  ON, local edits are preserved for use after following is turned OFF in the applicable mode. Editing
  alone never turns that toggle OFF or switches the unit out of RF.
  If the selected unit loses eligibility, remove its menu entry, end its editable view and explain the
  loss when returning to the whole-keyboard view. Never apply pending edits to a replacement selection
  or claim an uncertain write succeeded. Device management retains the offline registration.
- New TRIA has no wired MAIN-to-MAIN link. USB configuration covers the directly connected unit only;
  existing H7S/EERRAA split products retain their own behavior.
- Selecting an LM20 dongle, MAIN or NUMPAD exposes the **TOMAK TRIA** keycode category. Collect its
  dedicated actions, including WIRED/RF/BLE selection, cycling and supported system/sync actions;
  explain short versus protected long press. This is a category of assignable actions, not another
  keymap bank. With no editable key, the category may remain visible but assignment is unavailable.
  Preserve the existing specialized Tap Dance editor and avoid a second definition of its slots.
- VIA is the main settings/control route; remappable keys are a backup when VIA is unavailable.
  Provide explicit RF/BLE pairing start and exact-target confirmation for BLE credential deletion;
  physical-key gestures remain supported. Dongle registration deletion retains its exact-role
  confirmation. UI intent never impersonates a physical hold, bypasses firmware authentication or
  automatically retries uncertain deletion. Older firmware without the new capability is unavailable
  for that operation, not a reason to try another family's command.
- Confirm a mode change only when it will lose the active app control path. Identify the unit, new
  mode and reconnection route. Settle pending configuration writes before starting it. Transport loss
  alone is not success; discard stale responses and reconcile actual state on reconnection.
- Present RF as one keyboard whose settings are dongle-authoritative. Common changes apply to all
  compatible connected units; role-specific keys keep their own geometry. Keep WIRED and BLE user
  settings unit-local and separate, with an **Always use dongle settings** toggle that defaults ON.
  BLE has no dongle coordinator. Preserve the unit's separate WIRED/BLE values while following;
  turning the toggle OFF restores those values. Following while disconnected can use only previously
  synchronized values. Remaining toggle control scope, BLE slot granularity, multiple-dongle selection
  and first-use behavior are owned by LM20 DECISIONS Q-128/Q-130, not inferred by the UI. Unit-local
  ownership does not mean WIRED and BLE share identical settings.
  Display actual apply results separately from desired stored values; no optimistic offline success.

The PCB-period target is one dongle DK plus one virtual TRIA DK, testing unit roles sequentially on
Windows Chrome/Edge. The paired app must work during real input and lifecycle workloads. Full concurrent
four-unit RF and product PCB switch/RGB, power, charging, thermal and RF qualification are later work.
Virtual input and renderer observation are test evidence, not physical-product qualification.

## Complete settings backup and restore

Extend the existing Save/Load operation for LM20, H7S and EERRAA to cover **all persistent user settings**,
including RGB and other custom settings missing from layout-only files. The app owns the file format,
coverage inventory and UX; each firmware owns truthful reads, validated writes and live application.
Definitions alone do not prove that a field can be backed up or restored. Audit all supported settings
and add missing family firmware interfaces where necessary; do not copy GPL implementation into LM20.

| Connected device | Backup scope |
|---|---|
| New TRIA unit over USB | That unit's WIRED settings plus its BLE settings when separate BLE settings are enabled. No sibling wired unit is implied. |
| LM20 RF dongle | One RF keyboard: dongle settings plus the stored RF configuration of every registered role, including offline roles. Never silently omit a registered role with missing data. |
| H7S or EERRAA | The selected keyboard's complete persistent user settings under its existing board/split semantics; the TRIA no-LINK decision does not remove those semantics. |

The complete-backup format must distinguish family, compatible board/role geometry, schema version and
settings scope. Restore the **whole selected backup**, with no keymap/macro/RGB subset checklist.
Validate compatibility and required capabilities before writing; do not silently translate a WIRED
backup into RF settings or truncate unsupported settings. Show the target and replacement scope before
restoration. Credentials, device identity, calibration, signed firmware and volatile diagnostics are
not portable user settings and are excluded. A backup does not re-pair a device.

Read current device state under one valid selection/session; do not label stale cache or mixed revisions
as a complete backup. Unreadable required settings must be reported, not omitted under a success label.
Distinguish dongle persistence, applied online units and offline units awaiting later synchronization.
Multi-device restore is not assumed atomic: an interruption must expose completed/uncertain targets and
reconcile before continuing, without claiming all-or-nothing rollback or replaying stale operations.

Keep old VIA layout files importable with their existing geometry/identity checks. A missing field in an
old file leaves that setting unchanged; call it a legacy partial backup rather than a full restore.
Complete backups may need a versioned extension/envelope; do not claim official VIA can restore fields
that it does not understand. Existing standard VIA commands and ordinary keyboard behavior remain intact.
The old layout-file compatibility rules in ADR 0004 remain valid for that old format only.

First implementation owners are `src/store/layoutFileThunks.ts`, `src/utils/layout-import.ts`,
`src/components/panes/configure-panes/save-load.tsx` and the existing family definitions. Acceptance needs
nondefault-setting round trips, legacy-file compatibility, wrong-family/geometry/schema refusal,
disconnect/revision-change/read failures, interrupted restore and regression on H7S/EERRAA as well as LM20.
Exercise the existing `tests/layout-import.test.ts`, `tests/state-sync-transport.test.ts` and
`tests/save-load-pane.test.tsx` and add bounded cases there before introducing another framework.

## Definitions

### Ownership

Source locations and build ownership are mapped in `docs/MAP.md` §§1, 2, 4.
The product boundary is that ERA overlays, official VIA definitions, and
managed external stock definitions remain distinct ownership domains. Generated
output replaces none of them. Firmware-local JSON is compatibility/release
material rather than an app lookup source, and Design uploads remain a
last-resort local source that cannot override a bundled definition.

Tap Dance remains a separate presentation contract: TD names belong to
`tapdanceKeycodes`, not the ordinary Custom-tab `customKeycodes` surface.

> **REFUSED:** generating one canonical source from the other, or maintaining
> `era-definitions/v3` as a stock clone.
> **WHY:** custom and official have different ownership; generated output
> replaces neither. `scripts/build-keyboards.ts` `validateForbiddenOutputsAbsent`
> requires `era-definitions/v3` not to exist. The narrowly curated
> `era-definitions/external/v3` registry is manifest-bound, collision-checked,
> and is not an official-tree clone.
> **REOPENS:** never.

VID/PID, command addresses, layout, and TD slot identity still require
release-time compatibility review when app and firmware change together. The
app manifest records only custom path, identity, split pair, and independent
runtime capabilities. It must not grow cross-repository provenance fields
(`tests/era-definition.test.ts`). Normal app build and PR CI read the installed
official snapshot, ERA custom source, and managed external source; they do not
fetch GitHub or inspect firmware repositories and do not emit remote-verifier
provenance (`era_definition_sources.json` is forbidden).

Managed external V3 paths use `era-definitions/external/v3/*/*.json`, with the
directory naming the maintainer and the filename holding `<vid>-<pid>`. The
build requires the filename, manifest, and JSON identity to agree; rejects
duplicate, official, or ERA VPID collisions; and preserves every official
output byte. If the pinned official snapshot later supplies the same VPID, the
external entry must be retired instead of silently overriding upstream.
Redistribution permission and an accountable maintainer are admission
requirements outside the JSON schema.

Firmware repositories remain authoritative for USB identity and protocol
implementation, not for official definition ownership. The app validates its
custom overlay and installed official snapshot without duplicating firmware JSON
or coupling ordinary builds to firmware Git history.

### Lookup order

Implementation anchors and the lookup matrix are in `docs/MAP.md` §4. The
product order remains:

1. Bundled ERA overlay (`/definitions/era/v3/{vpid}.json`).
2. Bundled stock V3 (`/definitions/v3/{vpid}.json`): installed official VIA
   snapshot plus non-colliding managed external definitions.
3. JSON the user uploaded in Design, only if neither built-in source has that
   version/VPID.

No matching definition means unresolved. Stored uploads are re-evaluated
through the same priority after app updates, upload replacement/unload, device
selection changes, and reconnects. `tests/era-definition.test.ts` locks the
full ERA > bundled stock > upload matrix.

Firmware accepts both presentations: official VIA writes TD0–TD7 as
`CUSTOM(n)` / `QK_KB_n`; the custom app writes the same `QK_KB_n` bytes from
`tapdanceKeycodes` as `TD(n)` (`tests/keycode-picker.test.ts`).

Which boards exist, which menus they carry, and which capabilities they opt
into are not restated here. `config/era-definitions.manifest.json` and the
definition JSON are canonical, and `tests/era-definition.test.ts` binds them.

### brick65

`sirind/brick65` (`id`: `brick65` in the manifest) is a durable product
decision, not inventory. It remains the ATmega stock-feature exception: no
FEATURE menu, no `tapdanceKeycodes`, no term controls, no State Sync, and no
`exactMsFamily`. RGB Sleep is the one cross-family exception because the board
has RGB Matrix hardware: its SYSTEM/SLEEP page contains only the common master
toggle and uses QMK's existing 2-byte keymap-config storage.

> **REFUSED:** putting common ERA tapping, Tap Dance, exact-ms, or State Sync
> capability on `sirind/brick65`.
> **WHY:** 28,672 B flash budget; permanent ATmega32U4 exception that keeps
> those larger ERA feature families out. The tiny RGB Sleep master has separate
> measured budget and does not reopen them.
> **REOPENS:** never. Hardware budget, not a defect.

Sibling ids `brick65s` and `brick65-h7s` are not this exception.

### Build overlay

`build:kbs` packages the installed official snapshot and managed external stock
definitions under `/definitions/v3`, then emits the ERA overlay to
`/definitions/era/v3/{vpid}.json`. External definitions cannot collide with
official or ERA VPIDs. Official files must remain byte-identical even when an
ERA overlay has the same VPID. The merged V3 index is the unique union of all
three sources. Generated output never replaces any canonical source.

Bundled definitions auto-load without a manual JSON upload; this has been
confirmed on hardware.

> **REFUSED:** a parallel runtime loader or an external definition service.
> **WHY:** bundled definitions already auto-load without a manual JSON upload.
> **REOPENS:** never.

## Identity UI

The fork keeps VIA's visual language and ordinary workflow. ERA identifies the
fork/platform; it is secondary product identity, not keyboard-manufacturer
branding and not a separate design system. Global language selection remains a
user-facing shell capability; exact placement, components, and styling are
source-owned. The firmware download surface groups releases by keyboard maker
with plain text selectors; that is distribution, not manufacturer branding
([ADR 0004](adr/0004-firmware-distribution.md)).

Configuration panes and the keycode palette use centred content columns and
centred category tabs. Keep this alignment consistent across ordinary and ERA
configuration menus and the firmware download surface.

Palette keycaps share the keyboard's inward hover motion and brightness effect.
Unavailable keycaps are darkened without added symbols and do not animate on hover.

Configure, the key tester, Design, Debug and board firmware pages share one
keyboard-area height at the same window width. Size that area for the ordinary
tester and mounted keyboard layouts so navigation or the test mode does not
shrink keys or move the boundary above the controls. Routes without a keyboard
stage do not reserve one.
Short windows allow the page to scroll so the shared keyboard stage and the
controls below it remain reachable without shrinking the keys further.

This project is an unofficial VIA fork, not official VIA. Ordinary VIA keyboards
keep the upstream workflow. ERA-only help and diagnostics are additive and
capability-gated, so they may exist only in this fork without implying that
official VIA provides the same host UI. Stock VIA supports the controls it can
present correctly and simply. Features it cannot support correctly, or that
require complicated explanations or awkward controls, are reduced in official
JSON and supported in the Custom app at usekb.cc; usevia.txt explains that boundary.
Preserve existing wire meanings and the stock basic configuration path. Do not
force equal UI exposure, stale status labels, or firmware restarts for UI refresh.
In particular, stock LINK keeps selection and Apply without runtime/saved/result
TEXT; stock H7S polling keeps Boot Polling Mode and Apply without polling TEXT.
[ADR 0003](adr/0003-era-menu-help-ui.md) owns the
custom help/diagnostics support, wording, localization, and accessibility
boundaries.

The key tester starts with the ordinary browser key test for every keyboard.
Matrix testing is an explicit toggle for a connected keyboard with the existing
VIA matrix-read command; enabling it shows that keyboard's own layout. Its
permission explanation uses the ordinary menu helper's presentation. Matrix
permission is firmware-owned. A zero response cannot distinguish an idle board
from a protected read, and must not be presented as proof that VIA_INSECURE is
disabled. A failed read returns to the ordinary test with an explanation.

> **REFUSED:** manufacturer branding, an ERA-specific design system, or a
> redesign of the overall interface.
> **WHY:** this fork is neither a clean-sheet configurator nor a manufacturer
> rebrand; preserving VIA's interaction language keeps ordinary VIA users and
> keyboards on a familiar path.
> **REOPENS:** never.

## Tap Dance and exact-ms

TOMAK firmware and VIA V3 JSON implement TD0–TD7, four action slots, tapping
term, storage, and the engine. This host does not replace that engine.

Tap Dance follows this support policy in both QMK and H7S:
stock VIA supports basic Legacy Tap Dance only; the Custom app also supports
advanced settings. Stock VIA's menu model cannot adequately support the
complex advanced editor and its interdependent choices. Official V3 menus
therefore edit mode-0 slots through their four actions and legacy term controls.
Advanced slots show only the usekb.cc guidance and direct users to the Custom app for
editing; opening stock VIA must preserve those slots without resetting them or
silently converting them to Legacy. Input modes, separate hold timing, and
hold-on-other-key are edited only in the Custom app. This presentation policy changes
client editing support, not the firmware-owned execution, storage, or shipped
Custom Value ABI. Other features retain the official-VIA compatibility rule.

KEYMAP and every V3 `keycode` control use one keycode palette: KEYMAP shows it
under the keyboard, a `keycode` control opens it as a bottom dock. Search, clear,
modifiers, layers, Mod-Tap, Layer-Tap, and the QMK/hex code input remain
available. Unknown 16-bit values are preserved rather than silently rewritten.

The palette serves every keyboard, not only ERA ones. It keeps VIA's
select-a-key-then-pick flow and draws keycaps in the keyboard theme, so it is a
renewal of one component inside VIA's shell, not the overall redesign refused
under Identity UI. Like the keyboard drawing, it names keys for the OS layout
picked in VIA's layout badge, and a `keycode` control's button shows the key as
the palette draws it, with the QMK code only in its tooltip.

A combined key begins only after the user opens the builder; a key picked while
it is open becomes its operand instead of reassigning the keyboard key, and
nothing is placed until the user puts the result in. The builder offers the same
categories as the ordinary palette and Tap Dance editor. Layer-Tap, Mod-Tap and
modifier combinations require an encodable 8-bit keycode, regardless of its
category. The palette shows the categories the connected definition enables and
the keyboard has. Exact component structure and layout values are source-owned.

Combined-key and Tap Dance selection keep unavailable keys in enabled categories
visible but disabled, with darkened keycaps, native disabled semantics and reason
tooltips instead of added prohibition marks. Macro and Tap Dance slots are
generated from the connected keyboard's declared capacities. Selection,
search, direct code input and writes use the same eligibility checks. Tap Dance
checks the connected definition and keyboard capacities and forbids recursive
Tap Dance actions. An unchanged unknown loaded action is preserved; editing
another action or its term must not silently rewrite it.

Tap Dance actions and terms are edited from KEYMAP's Tap Dance category, not from
a Configure menu. Edits stay a draft until Save, an action may come from any
category, and Cancel or Save returns to the category the edit started from.
Like a Configure menu draft, a slot's draft belongs to the keyboard: leaving the
editor keeps it without a prompt until Save, Cancel or disconnection ends it.
Save writes only the changed fields, in slot order, and stops at the first write
the keyboard refuses, which stays a draft with the fields after it.

Supported H7S and QMK keyboards use one Tap Dance editor with Base key and
inline add buttons for Hold, Double Tap and Tap+Hold. Only configured action
slots are visible; each missing action has a one-click text button.
Removing an action inherits the base behavior; choosing No input suppresses
that gesture. Input start exposes After decision and On press as two directly
selectable, underlined radio choices, and Decision time
keeps the existing integer term. Timing and Input start each have an independent
contextual information disclosure next to their controls, using the same help
component as other menus. A separate Preview disclosure shows the four outcomes
and fallback rules below the actions; its results follow the current draft before
Save. Its button stays beside Put in, so the action row does not wrap around it.
Each disclosure starts closed. The basic
editor contains controls rather than explanatory rows. Write
errors and invalid-field feedback remain visible. With no additional
actions the new modes behave as a normal key and hide Decision time. An On
press slot keeps Input start accessible so it can return to After decision
before adding a separate Hold action.

On press sends the first physical base key immediately, including its release
and a long first hold. Only the second press waits; the first input remains
even if a double-tap or tap+hold action follows. A separate first-hold action
requires After decision, because exclusive replacement cannot retract an input
already sent. Incompatible selections are disabled with an explanation; the
app never changes input timing automatically to resolve a conflict.

Support requires the firmware response marker, not just a current definition.
Unsupported firmware retains the four-action editor and an update hint inside
its help disclosure.
Opening a legacy slot preserves its values and timing. An explicit action or
input-mode edit stages the new semantics, converting only legacy empty fallback
fields to inheritance; unknown assigned actions stay unchanged. Save/Cancel,
per-device drafts and refusal handling include the mode. A newly added action
must receive a key before Save. Backup includes the mode and preserves the
inheritance/silence distinction. Importing unsupported or contradictory modes
is refused before any write; a pre-mode backup restores legacy semantics.
Official V3 definitions retain the basic Legacy editing path and direct
advanced-mode editing to the Custom app under the support policy above.

Independent Tap Dance timing has its own Advanced settings disclosure with an
expand/collapse indicator beside the time fields and before their information
control. Its two checkboxes expand directly below that timing row without
repeating their labels as explanatory text. Settings, time help, input-start help
and preview open independently. Time help explains the timing values and their
effects; input-start help compares the two choices in one sentence each.
The reason an input-start choice is unavailable stays on that choice. Help does
not contain editable settings. Dots beside action names, time fields,
input-start choices and checkboxes indicate unsaved changes, not selected or
enabled states. They clear when a change is saved, cancelled or restored to the
keyboard's value. The settings control also summarizes each pending advanced
timing field with a vertically stacked dot, hold time above hold-on-other-key.
The Save action reflects all pending changes.
An action removed from the draft is summarized by the slot and category dots;
its Add action button stays unmarked because it is an editing command.
By default a single Decision time drives both consecutive-press and hold
judgments. Enabling Separate hold decision time reveals Hold decision beside Tap interval
in a dedicated timing row above the input-start choices. Both values remain
visible and editable when Advanced settings is closed; disabling separation
restores one Decision time field in the same row. The interval runs from the
preceding press. The optional
Hold when another key is pressed resolves an assigned hold before that key's
layer lookup; with On press only the second press can resolve to Tap+Hold.
Both settings are captured for the active gesture and are ignored in legacy mode.
Editing them explicitly stages the new semantics, as action edits do.
Preview sits before Put in in the right-hand button group; a divider with equal
spacing separates that row from Cancel/Save below. The group is vertically
centered within the editor, with a single horizontal row below the controls on
narrow screens. Selecting the Tap Dance
category during editing returns to its list while retaining the keyboard's draft,
with focus on the slot's Edit button. Other categories remain action pickers.

Advanced timing requires the extra `0xD3` mode-response capability and valid
markers on both new fields. Older firmware is not queried for unknown timing
IDs. Per-device drafts, write refusal retention and backup include these values.
Older backups restore shared time (zero) and the disabled interruption option;
non-default values cannot be imported to unsupported firmware. These advanced
timing controls belong to the Custom app; official VIA does not edit them.

Tapping-family time values must be directly editable as integer milliseconds.
The initial scope is the global TAPPING term and the TD0–TD7 terms. Boolean
tapping toggles and unrelated debounce or KKUK timings are not silently included.
A representative non-step value such as `137 ms` must round-trip, persist, and
drive runtime behavior without snapping to the legacy 20 ms grid. Out-of-range,
empty, decimal, and non-integer drafts do not write. Reuse the exact integer
editor for another timing only after that field's storage and wire semantics have
been audited.

Firmware must keep working with the official VIA app (`www.usevia.app`) plus
the official V3 definition.

Stock support is a usability boundary, not mandatory feature parity. Advanced
Tap Dance and automatically refreshed observations belong to the Custom app;
stock controls retain their supported basic workflow and existing wire meanings.

Official VIA continues to use the existing legacy 1-byte dropdown (100–500 ms /
20 ms grid); a stock-shaped exact range retains its loaded `options: [100, 500]`.
Custom VIA JSON for both QMK and H7S uses exact `options: [1, 65535]`
(uint16 maximum; `99999` does not fit) on the existing family-specific BE16 IDs.
Official definitions remain legacy dropdowns; widening the Custom presentation
does not widen or remove them. Firmware must preserve the exact value through
SAVE/reload and must use an execution clock wide enough to expire the maximum term.
Loaded JSON `options` win; channel and value ids, encode/decode, SET validation, and
legacy GET projection are [ADR 0001](adr/0001-state-sync-protocol.md) — not
restated here.

This is an additive exact-ms path on existing Custom Value commands, not removal
of firmware legacy compatibility. Preserve every legacy value ID and official
VIA behavior. ERA custom JSON exposes the exact controls without duplicating
their corresponding legacy dropdowns; generic official or uploaded definitions
may still contain legacy controls. Custom JSON may add `tapdanceKeycodes` as an
app extension; official JSON must not. Custom JSON keeps each TD's settings on
its `tapdanceKeycodes` entry instead of a TAPDANCE menu, because the custom app
edits Tap Dance from KEYMAP; the firmware-local stock JSON keeps its TAPDANCE menu
for basic editing in official VIA. Shared controls address the same Custom Value
commands; advanced editing follows the support policy above. Source
validation owns the current field handling rather than this document.

### QMK lighting sleep exact-sec

Every QMK ERA definition except brick65 exposes each light's persisted idle
timeout in two client-compatible forms. For RGB, firmware-local stock VIA
definitions use SYSTEM channel 9 / value 10 as a one-byte fixed-minute dropdown
(1/3/5/10/30/60), and custom ERA definitions use value 11 as a two-byte
big-endian exact-second range, 1..65535 inclusive. A board with a backlight has
the same pair for the backlight's own timeout: value 14 (stock minutes) and
value 15 (custom exact seconds). Both setters of a pair update the same firmware
value; exact GET/SET does not snap to the stock menu, while stock GET only
projects the exact value down to the nearest supported preset and never mutates
it. A zero SET is refused. Firmware defaults each timeout, including legacy zero
migration, to 600 seconds / 10 minutes.

Both clients also expose one master per light, each defaulting on: RGB Sleep on
SYSTEM channel 9 / value 12 and Backlight Sleep on value 13. Turning a master off
preserves its stored timeout and gates **all** automatic sleep reasons for that
light: its input-idle timeout, explicit USB suspend, and host-frame-loss sleep.
Its timeout row is hidden with V3 `showIf` until the master is on again. Sleep
only darkens the output; lighting settings are unchanged. Compile-time
`keyboard.json` `rgb_matrix.sleep: true` / `rgblight.sleep: true` stays enabled
because it is the capability; the VIA master decides whether that capability may
darken RGB at runtime.

This is the same dual-surface compatibility principle as exact-ms, but the two
encodings require separate value ids because a V3 Custom Value request does not
identify which definition/client produced it. The exact id is additive, not a
custom-app-only substitute: official/usevia-compatible firmware JSON still
offers the complete feature through the preset id.

The custom client edits exact seconds as an integer. The SLEEP timeouts use the
same deferred-Apply contract as TAPPING and the Tap Dance editor: editing does
not write immediately, Apply is disabled while the valid draft matches the
authoritative value, and it becomes available only for a different valid
1..65535-second draft. The masters remain independent immediate controls;
changing a timeout never stages or rewrites a master. In the Configure menus such
a draft belongs to the keyboard rather than the screen, because a change lost on
leaving is lost silently and a prompt on every exit breaks the flow: it survives
tab, pane and page changes and ends only when Apply writes it, Cancel drops it or
the keyboard disconnects. Apply writes a page's drafts in row order and stops at
the first one the keyboard refuses, which stays a draft.

### H7S RGB sleep exact-sec

H7S definitions use the same dual-surface rule as the QMK family without sharing
its channel numbers. Firmware-local official VIA JSON keeps SYSTEM channel
18 / value 1 (`id_qmk_rgb_sleep_timeout`) as the one-byte minute dropdown
1/3/5/10/30/60. The ERA overlay uses additive channel 18 / value 2
(`id_qmk_rgb_sleep_timeout_exact`) as two-byte big-endian exact seconds,
1..65535 inclusive. Firmware stores one uint16-second value (default 600 / 10
minutes); both setters update it and SAVE persists it. Official GET floors an
exact value onto the preset list without writing, so reading the keyboard in
official VIA never snaps a custom 137-second value.
The custom client keeps the same exact-second integer and deferred-Apply
behavior. User help describes the same input-idle timeout object as the QMK family;
current editor and help-source details remain source-owned.

Both H7S clients add the RGB Sleep master `id_qmk_rgb_sleep_enable` on channel
18 / value 3. It defaults on, preserves the timeout while off, and the timeout
row uses `showIf` so it appears only while the master is enabled. OFF gates all
automatic RGB sleep reasons: inactivity, explicit USB suspend, and host-SOF
loss. H7S still compiles `RGBLIGHT_SLEEP`; that is the capability used by the
single `rgb_sleep.c` owner, while the VIA master decides whether the owner may
enter RGB sleep. The enable bit is additive and does not replace the shipped
value-1 official timeout contract.

> **REFUSED:** moving H7S RGB sleep onto QMK channel 9 / value 11, or replacing
> the official value-1 preset with the exact encoding.
> **WHY:** H7S already shipped channel 18 / value 1 to official VIA; additive
> value 2 adds precision without changing the shipped official wire contract.
> **REOPENS:** never.

### RGB Sleep master

Every definition whose keyboard actually has RGB exposes exactly one master:
the QMK and H7S families keep their established master controls. Definitions
with no RGB hardware expose neither the master nor a timeout.
`tests/era-definition.test.ts` owns the coverage set.

Firmware must compile the native QMK sleep capability wherever RGB exists.
The firmware audit therefore treats missing `rgb_matrix.sleep: true` or
`rgblight.sleep: true` as a defect, not as a user preference. Runtime master OFF
then covers the user who never wants automatic RGB sleep, including during USB
suspend or host loss; master ON covers the user who does.

> **REFUSED:** representing RGB Sleep OFF as timeout `0`, or disabling the
> compile-time QMK/H7S RGB sleep capability to represent a user preference.
> **WHY:** zero is already legacy/default migration for timeout storage, while
> compile-time sleep support must exist before the runtime master can choose
> whether USB suspend, host loss, or idle timeout may darken RGB.
> **REOPENS:** only if the firmware families replace the timeout encoding or
> remove runtime configurability entirely.

Use Vial only to study interaction design.

> **REFUSED:** copying license-incompatible or unclear Vial implementation
> source.
> **WHY:** Vial is a reference for interaction design; this host implements in
> VIA React independently.
> **REOPENS:** when a compatible, verified license basis exists.

> **REFUSED:** replacing the Tap Dance engine or split EEPROM synchronization
> in this app.
> **WHY:** firmware remains the authority for keyboard state; TOMAK firmware
> and VIA V3 JSON already implement the engine, slots, and storage.
> **REOPENS:** never.

## State Sync

VIA updates its cache when the UI writes a value, but keyboard-originated
changes do not generally invalidate that cache. Upstream `UI_SYNC_REQUEST
0x16 v1` can request selective V3 Custom Menu reads; it does not cover keymaps
or provide lifecycle recovery. The TOMAK split field failure and the host
mechanism are [ADR 0001](adr/0001-state-sync-protocol.md). This file does not
restate the selector `0x06` envelope, domain mask, or refresh algorithm.

### Product guarantees

The product needs current-state convergence, not exactly-once preservation of
every intermediate setting event.

- A change on the selected active device normally appears immediately.
- A missed event is recovered automatically without F5.
- Device selection, Configure entry, reconnect, and tab resume validate
  freshness before stale cache is presented as current.
- Rapid intermediate changes may coalesce; the final readable firmware value
  must win.
- A split peer is considered updated only after that peer finishes applying
  the state and can return it. This host must not write an unapplied peer
  value into the other side's UI cache.
- Hidden pages do not generate continuous traffic and catch up when active
  again.

Ordinary keyboards without the extension use the existing VIA path unchanged.
v1-capable firmware retains Custom Menu synchronization. Advanced ERA firmware
sends no unsolicited State Sync traffic. Official VIA clients continue using
existing commands and never need an arm/subscription flow. Current firmware
remains a valid device for official VIA plus the official definition. Revision
counters remain in RAM and never increase EEPROM wear. No synchronization send
occurs in scan/ISR paths. Hidden pages stop revision-poll traffic.

Acceptance bar (same guarantees, including hardware):

- Same-unit physical changes appear within the measured visible polling bound
  without F5.
- A change committed from the opposite TOMAK half converges on the USB-side UI
  without F5.
- Rapid changes settle on the final firmware value.
- Missed `0x16 v1` hints recover through revision or lifecycle checks on
  advanced-capable firmware.
- Device switch, unplug/replug, and tab hide/show never leave stale cache
  labeled as current.
- Ordinary VIA and v1-only firmware behavior remains intact.
- Hidden state has no ongoing revision-poll traffic.
- H7S input timing and queues show no meaningful 8 kHz regression with polling
  enabled.

Timeout and rate values are measured parameters, not permanent guesses. Poll
interval and remaining hardware evidence live in
[ADR 0001](adr/0001-state-sync-protocol.md); `docs/MAP.md` §3 routes to that
owner without restating the values.

Three product boundaries constrain work that is not itself State Sync. The
REFUSED three-liners are [ADR 0001](adr/0001-state-sync-protocol.md):

- Do not expose raw EEPROM addresses on the host protocol.
- `UI_SYNC_REQUEST 0x16 v1` keeps its existing meaning. It is not State Sync
  correctness and is not reinterpreted as v2.
- Refactor broader Redux state only where these contracts require it.

Physical-device validation is deferred until software-only evidence leaves a
concrete question that deterministic simulation, host tests, captured
transcript replay, or static ownership proof cannot answer. Lack of hardware
data must remain an explicit uncertainty. It must not be replaced by
assumptions about browser close/open, USB endpoint flushing, response latency,
or 8 kHz performance. Automated firmware builds are not a substitute for
flashing or device observation.

USB diagnostics selector `0x07` is retired and receives no app probes.
Coupling it to polling-mode apply/reset or to State Sync recovery is refused.
Mode selection is always the user's.
[ADR 0002](adr/0002-h7s-usb-diagnostics.md) owns that boundary.

> **REFUSED:** rebuilding existing V3 Custom Value features as duplicate React
> state or as a second value protocol.
> **WHY:** existing VIA GET/SET and V3 Custom Value remain the value path;
> State Sync is invalidation plus authoritative reread, not a second store.
> **REOPENS:** [ADR 0001](adr/0001-state-sync-protocol.md) REFUSED blocks.

## Standing approvals

Before modifying a firmware repository or freezing a protocol, report the need,
app and firmware changes, compatibility, failure behavior, and hardware test
plan. Cloudflare Pages, DNS, production deployment, and other external-service
changes also require explicit approval.

## Durable non-goals

Three-liners sit next to the decision. This section names the remaining
product non-goals that are not already a REFUSED block above.

- Manufacturer branding / overall redesign — Identity UI.
- Generating one canonical definition source from the other, or treating
  generated output as source — Definitions.
- Parallel definition loader or external definition service — Definitions.
- Common ERA tapping / Tap Dance / exact-ms / State Sync on `sirind/brick65` —
  brick65.
- Forced stock/Custom UI parity at the cost of correctness or usability — Identity UI.
- Vial implementation copy — Tap Dance.
- Replacing the Tap Dance engine or split EEPROM synchronization — Tap Dance.
- Duplicate V3 Custom Value React state or a second value protocol — State
  Sync.
- Raw EEPROM addresses, `0x16` as State Sync correctness, extra domains, ACK,
  or unsolicited advanced events — [ADR 0001](adr/0001-state-sync-protocol.md).
- Coupling selector `0x07` to polling mode or State Sync recovery —
  [ADR 0002](adr/0002-h7s-usb-diagnostics.md).
- Small-diff optimization or a speculative framework — Mission.
