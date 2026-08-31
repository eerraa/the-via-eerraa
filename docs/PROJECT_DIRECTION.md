# ERA VIA Fork — product direction

Genre: contract
Canonical for: what this fork is for, its priority order, definition ownership and
lookup order, the brick65 exception, Tap Dance and exact-ms/exact-sec product rules, State
Sync product guarantees, and the durable non-goals

> Durable project brief: what the product is for and what must never be done to
> it. Where a fact lives and which side is canonical is `docs/MAP.md`. Individual
> decisions with rejected alternatives are `docs/adr/`. Transient state is not
> recorded anywhere — `git log` and the verification commands answer it.

Re-measured from this host: `src/utils/definition-priority.ts`,
`src/store/definitionsSlice.ts`, `config/era-definitions.manifest.json`,
`era-definitions/custom/v3`, `scripts/build-keyboards.ts`,
`tests/era-definition.test.ts`, `src/utils/era-exact-ms.ts`,
`src/utils/millisecond-field.ts`, `src/utils/keycode-picker.ts`,
`src/components/inputs/keycode-picker.tsx`,
`src/components/inputs/pelpi/keycode-input.tsx`,
`src/components/inputs/millisecond-input.tsx`,
`src/components/menus/external-links.tsx`. Wire, envelope, exact-ms identifiers,
and refused State Sync mechanisms: [ADR 0001](adr/0001-state-sync-protocol.md).
USB diagnostics product boundary: [ADR 0002](adr/0002-h7s-usb-diagnostics.md).
Inventory counts: `docs/MAP.md` §2 — this file does not restate them.

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

## Definitions

### Ownership

- `era-definitions/custom/v3` in this app repository is the canonical ERA
  custom source. Tap Dance slots live in `tapdanceKeycodes`. `customKeycodes`
  remains the ordinary Custom tab and is omitted when empty
  (`scripts/build-keyboards.ts`). TD names must not appear in `customKeycodes`.
- `the-via/keyboards` `v3/` is the canonical official VIA source. The installed
  `via-keyboards` package is a pinned build snapshot, not a second source of
  truth.
- QMK `keymaps/via` and H7S board-local `json` files are firmware-local
  compatibility, test, or release material. They are not app lookup sources and
  do not define official JSON ownership.
- Design uploads are a last-resort local source. They are retained for the
  existing UX but cannot override a bundled ERA or official definition.

> **REFUSED:** generating one canonical source from the other, or maintaining
> `era-definitions/v3` as a stock clone.
> **WHY:** custom and official have different ownership; generated output
> replaces neither. `scripts/build-keyboards.ts` `validateForbiddenOutputsAbsent`
> requires `era-definitions/v3` not to exist.
> **REOPENS:** never.

VID/PID, command addresses, layout, and TD slot identity still require
release-time compatibility review when app and firmware change together. The
app manifest records only custom path, identity, split pair, and independent
runtime capabilities. It must not grow cross-repository provenance fields
(`tests/era-definition.test.ts`). Normal app build and PR CI read the installed
official snapshot and the ERA custom source; they do not fetch GitHub or inspect
firmware repositories and do not emit remote-verifier provenance
(`era_definition_sources.json` is forbidden).

Firmware repositories remain authoritative for USB identity and protocol
implementation, not for official definition ownership. The app validates its
custom overlay and installed official snapshot without duplicating firmware JSON
or coupling ordinary builds to firmware Git history.

### Lookup order

`mergeDefinitionLookup` in `src/utils/definition-priority.ts` (and
`getDefinitionSourceForDevice` in `src/store/definitionsSlice.ts`) implement:

1. Bundled ERA overlay (`/definitions/era/v3/{vpid}.json`).
2. Installed official VIA snapshot (`/definitions/v3/{vpid}.json`).
3. JSON the user uploaded in Design, only if neither built-in source has that
   version/VPID.

No matching definition means unresolved. Stored uploads are re-evaluated
through the same priority after app updates, upload replacement/unload, device
selection changes, and reconnects. `tests/era-definition.test.ts` locks the
full ERA > official > upload matrix.

Firmware accepts both presentations: official VIA writes TD0–TD7 as
`CUSTOM(n)` / `QK_KB_n`; the custom app writes the same `QK_KB_n` bytes from
`tapdanceKeycodes` as `TD(n)` (`tests/keycode-picker.test.ts`).

Which boards exist, which menus they carry, and which capabilities they opt
into are not restated here. `config/era-definitions.manifest.json` and the
definition JSON are canonical, `tests/era-definition.test.ts` binds them, and
`docs/MAP.md` §2 carries the counts.

### brick65

`sirind/brick65` (`id`: `brick65` in the manifest) is a durable product
decision, not inventory. Re-measured custom JSON is stock VIA: no FEATURE menu,
no `tapdanceKeycodes`, no term controls. The manifest has `stateSync: false`
and no `exactMsFamily`.

> **REFUSED:** putting common ERA tapping, Tap Dance, exact-ms, or State Sync
> capability on `sirind/brick65`.
> **WHY:** 28,672 B flash budget; permanent ATmega32U4 exception that keeps
> stock VIA only.
> **REOPENS:** never. Hardware budget, not a defect.

Sibling ids `brick65s` and `brick65-h7s` are not this exception.

### Build overlay

`build:kbs` packages the installed official snapshot under `/definitions/v3`
and emits the ERA overlay to `/definitions/era/v3/{vpid}.json`. Official files
must be preserved even when both sources contain the same VPID
(`ERA overlay changed, removed, or added an official definition file.`). The
merged V3 index is the unique union of the two namespaces. Generated output
never replaces either canonical source.

Bundled definitions auto-load without a manual JSON upload; this has been
confirmed on hardware.

> **REFUSED:** a parallel runtime loader or an external definition service.
> **WHY:** bundled definitions already auto-load without a manual JSON upload.
> **REOPENS:** never.

## Identity UI

The approved global UI keeps VIA's visual language.
`src/components/menus/external-links.tsx` puts language selection and a
non-interactive `ERA` wordmark (`EraMark` / `EraWordmark`; no click handler;
`user-select: none`) in the upper-right of the global menu.

> **REFUSED:** manufacturer branding, an ERA-specific design system, or a
> redesign of the overall interface.
> **WHY:** this fork is neither a clean-sheet configurator nor a manufacturer
> rebrand; the approved global UI keeps VIA's visual language.
> **REOPENS:** never.

## Tap Dance and exact-ms

TOMAK firmware and VIA V3 JSON implement TD0–TD7, four action slots, tapping
term, storage, and the engine. This host does not replace that engine.

Custom-app UI contract, re-measured from `src/utils/keycode-picker.ts`,
`src/components/inputs/keycode-picker.tsx`,
`src/components/inputs/pelpi/keycode-input.tsx`, and
`tests/keycode-picker.test.ts`:

- V3 `keycode` controls open VIA's existing category/card picker
  (`PelpiKeycodeInput` → `KeycodePicker`).
- Search, clear, modifiers, layers, Mod-Tap, and Layer-Tap composition stay.
- Unknown 16-bit values are preserved as hex. The Special-category Any card
  and `KeycodeModal` remain the advanced QMK/hex escape hatch.
- Composition is Layers-only (`isComposerCategory`). The user chooses
  Layer-Tap, Mod-Tap, or Modifier first, then a compatible Basic tap key and
  the hold action. A grid pick while `pickingBase` fills the composer; it does
  not call `onSelect` for the selected keyboard key.
- Compose base is resolved from explicit input only, not from the previously
  assigned grid card (`resolveComposeBaseCode`). Ordinary categories do not
  expose a permanent compose form.
- The action dialog is a stable wide overlay (`width: min(1600px, calc(100vw -
  40px))`); width does not depend on the selected category's content. It
  exposes every keycode category enabled by the connected definition, including
  layer cards such as `MO(n)`.
- That does not relax the Basic-key-only operand rule inside `LT`/`MT`.
  Firmware remains authoritative for the runtime semantics of the selected
  16-bit action.

Tapping-family time values must be directly editable as integer milliseconds.
The first scope is the global TAPPING term and the TD0–TD7 terms
(`isExactTermCommand` in `src/utils/era-exact-ms.ts`). Boolean tapping toggles
and unrelated debounce or KKUK timings are not silently included. A
representative non-step value such as `137 ms` must round-trip, persist, and
drive runtime behavior without snapping to the legacy 20 ms grid
(`tests/millisecond-field.test.ts`, `tests/state-sync-transport.test.ts`).
Out-of-range, empty, decimal, and non-integer drafts do not write
(`parseMillisecondDraft`). Exact `range` controls render `MillisecondInput` by
default. Reuse that input for other TAPPING time fields only after their
storage and wire semantics have been audited.

Firmware must keep working with the official VIA app (`www.usevia.app`) plus
the official V3 definition.

> **REFUSED:** a path that only the custom app can speak.
> **WHY:** official VIA plus official definitions remain required; custom-app-only
> value IDs, ranges, or encodings are not acceptable substitutes.
> **REOPENS:** never.

Official VIA continues to use the existing legacy 1-byte dropdown (100–500 ms /
20 ms grid) and the official exact range `options: [100, 500]`. Custom VIA JSON
for QMK boards uses exact `options: [1, 65535]` (uint16 maximum; `99999` does
not fit) on the same 2-byte exact IDs. H7S stays on `[100, 500]` in the official
definition and in app-owned custom JSON until its firmware is approved to match.
Loaded JSON `options` win; channel and value ids, encode/decode, SET clamp, and
legacy GET projection are [ADR 0001](adr/0001-state-sync-protocol.md) — not
restated here.

This is an additive exact-ms path on existing Custom Value commands, not removal
of firmware legacy compatibility. Preserve every legacy value ID and official
VIA behavior. ERA custom JSON exposes only the nine exact controls and must not
duplicate their legacy dropdowns (`isLegacyTermCommand`;
`scripts/build-keyboards.ts` rejects them). Generic official or uploaded
definitions may still contain legacy controls. Custom JSON may add
`tapdanceKeycodes` as an additional field; official JSON must not.
`splitTapDanceKeycodesFromRaw` strips that field so official V3 validation can
run.

### TOMAK RGB sleep exact-sec

The six TOMAK split definitions expose the same persisted RGB idle timeout in
two client-compatible forms. Firmware-local stock VIA definitions use SYSTEM
channel 9 / value 10 as a one-byte fixed-minute dropdown (1/3/5/10/30/60).
Custom ERA definitions use value 11 as a two-byte big-endian exact-second range,
1..65535 inclusive. Both setters update the same firmware value; exact GET/SET
does not snap to the stock menu, while stock GET only projects the exact value
down to the nearest supported preset and never mutates it. Firmware defaults the
setting, including legacy zero migration, to 600 seconds / 10 minutes.

This is the same dual-surface compatibility principle as exact-ms, but the two
encodings require separate value ids because a 32-byte V3 Custom Value request
does not identify which definition/client produced it. The exact id is additive,
not a custom-app-only substitute: official/usevia-compatible firmware JSON still
offers the complete feature through the preset id. `src/utils/era-exact-sec.ts`
selects the exact control; `src/components/inputs/integer-input.tsx` supplies the
shared integer editor used by the seconds field and the millisecond wrapper.
The SLEEP submenu uses the same deferred-Apply contract as TAPPING/TAPDANCE:
editing the field does not write immediately, Apply is disabled while the draft
matches the authoritative value, and becomes available only for a different
valid 1..65535-second draft. It also participates in the normal ERA submenu
summary + folded-detail help surface.

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
[ADR 0001](adr/0001-state-sync-protocol.md) and `docs/MAP.md` §3.

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

USB diagnostics selector `0x07` is read-only, opt-in, and RAM-only.
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
- Custom-app-only path — Tap Dance and exact-ms.
- Vial implementation copy — Tap Dance.
- Replacing the Tap Dance engine or split EEPROM synchronization — Tap Dance.
- Duplicate V3 Custom Value React state or a second value protocol — State
  Sync.
- Raw EEPROM addresses, `0x16` as State Sync correctness, extra domains, ACK,
  or unsolicited advanced events — [ADR 0001](adr/0001-state-sync-protocol.md).
- Coupling selector `0x07` to polling mode or State Sync recovery —
  [ADR 0002](adr/0002-h7s-usb-diagnostics.md).
- Small-diff optimization or a speculative framework — Mission.
