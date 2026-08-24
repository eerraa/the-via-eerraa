# ERA VIA Fork project direction

Genre: contract
Canonical for: what this fork is for, its priority order, definition ownership, the Tap Dance and
exact-millisecond UI contract, the State Sync product guarantees, and the durable non-goals

> This is the durable project brief: what the product is for and what must never be done to it.
> Where a fact lives and which side is canonical is `docs/MAP.md`. Individual decisions with
> their rejected alternatives are in `docs/adr/`. Transient state is not recorded anywhere —
> `git log` and the verification commands answer it.

## Mission

Build an unofficial, manufacturer-neutral VIA fork for ERA PCB and firmware work while retaining the experience and compatibility of upstream VIA. This is not a clean-sheet configurator and not a rebrand for SIRIND, NEWONE, Linx3, or another keyboard manufacturer. ERA/eerraa identifies the PCB/firmware platform and fork maintainer.

Priority order:

1. Firmware remains the authoritative source of keyboard state.
2. Supported keyboards work without manual JSON loading or page refreshes.
3. Ordinary VIA keyboards and existing VIA V3 definition/command paths continue to work.
4. Configurator control-plane traffic does not impair the 8 kHz input data-plane.
5. Complexity is introduced only for a demonstrated correctness, recovery, or maintenance need.

Upstream diff minimization is useful but no longer an end in itself. A well-tested core improvement is preferable to an ERA-specific workaround when VIA's existing architecture is the actual limitation.

## Established direction

### Definitions

Definition ownership is explicit:

- `era-definitions/custom/v3` in this app repository is the canonical ERA custom source. Tap Dance slots live in `tapdanceKeycodes`; `customKeycodes` remains the ordinary Custom tab and is omitted when empty. TD names must not be listed in `customKeycodes`.
- `the-via/keyboards` `v3/` is the canonical official VIA source. The installed `via-keyboards` package is a pinned build snapshot, not a second source of truth.
- QMK `keymaps/via` and H7S board-local `json` files are firmware-local compatibility, test, or release material. They are not app lookup sources and do not define official JSON ownership.
- Design uploads are a last-resort local source. They are retained for the existing UX but cannot override a bundled ERA or official definition.

Do not generate one canonical source from the other or maintain `era-definitions/v3` as a stock clone. VID/PID, command addresses, layout, and TD slot identity still require release-time compatibility review when app and firmware change together. The app manifest records only custom path, identity, split pair, and independent runtime capabilities. Normal app build and PR CI read the installed official snapshot and the ERA custom source; they do not fetch GitHub or inspect firmware repositories and do not emit remote-verifier provenance.

This fork's definition lookup order is:

1. Bundled `era-definitions/custom` (`/definitions/era/v3/{vpid}.json`).
2. Installed official VIA snapshot (`/definitions/v3/{vpid}.json`).
3. JSON the user uploaded in Design, only if neither built-in source has that version/VPID.

No definition means unresolved. Stored uploads are re-evaluated through the same priority after app updates, upload replacement/unload, device selection changes, and reconnects.

Firmware accepts both presentations: official VIA writes TD0–TD7 as `CUSTOM(n)` / `QK_KB_n`, and the custom app writes the same `QK_KB_n` bytes from `tapdanceKeycodes` via `TD(n)`.

The inventory itself — how many definitions there are, which board carries which menu, which capability each opts into — is not restated here. `config/era-definitions.manifest.json` and the definition JSON are canonical, `tests/era-definition.test.ts` binds them, and `docs/MAP.md` §2 carries the counts.

One entry is a durable product decision rather than inventory: `sirind/brick65` is the permanent ATmega32U4 exception. Its 28,672-byte flash budget keeps stock VIA only, so it claims none of the common ERA tapping, Tap Dance, exact-ms or State Sync capabilities. That is a hardware budget, not a defect, and it must not be "fixed".

`build:kbs` packages the installed official snapshot under `/definitions/v3` and emits the ERA overlay to `/definitions/era/v3/{vpid}.json`. It must preserve official files even when both sources contain the same VPID, and the merged V3 index is the unique union of the two namespaces. Generated output never replaces either canonical source and no provenance or app stock-source tree is produced.

Bundled definitions auto-load without a manual JSON upload; this has been confirmed on hardware. Do not introduce a parallel runtime loader or external definition service.

Firmware repositories remain authoritative for USB identity and protocol implementation, but not for official definition ownership. The app validates its custom overlay and installed official snapshot without duplicating firmware JSON or coupling ordinary builds to firmware Git history.

### Identity UI

The approved global UI keeps VIA's visual language. The upper-right area contains language selection and a subtle, non-clickable `ERA` wordmark. Do not add manufacturer branding or redesign the overall interface.

### Tap Dance

TOMAK firmware and VIA V3 JSON implement TD0–TD7, their four action slots, tapping term, storage, and the engine. The custom-app UI contract is:

- extract/reuse VIA's existing category/card keycode picker;
- make V3 `keycode` controls open that picker;
- support search, clear, modifiers, layers, Mod-Tap and Layer-Tap composition;
- preserve unknown 16-bit values as hex and retain text/hex input as an advanced escape hatch.

Keycode composition is a Layers-only, progressive flow. The user first chooses Layer-Tap,
Mod-Tap, or Modifier, then explicitly selects a compatible Basic tap key and the required hold
action. Picking that tap key from the grid only fills the composer; it never assigns the selected
keyboard key. The Special-category Any card remains the advanced QMK/hex escape hatch. Do not
infer a compose base from the previously assigned grid card or expose a permanent compose form in
ordinary categories.

V3 `keycode` action controls use a stable wide dialog with the same left-side category navigation
and card grid as the ordinary keymap picker; dialog width must not depend on the selected category's
content. The action picker exposes every keycode category enabled by the connected definition,
including layer cards such as `MO(n)`, while retaining Any/hex as the advanced escape hatch. This
does not relax the Basic-key-only operand rule inside `LT`/`MT`, and firmware remains authoritative
for the runtime semantics of the selected 16-bit action.

Tapping-family time values must also be directly editable as integer milliseconds. The first
scope is the global TAPPING term and the TD0–TD7 terms; boolean tapping options and unrelated
debounce or KKUK timings are not silently included. A representative non-step value
such as `137 ms` must round-trip, persist, and drive runtime behavior without being snapped to
the legacy 20 ms grid.

Firmware must keep working with the official VIA app (`www.usevia.app`) plus
the official V3 definition. A path that only the custom app can speak is an error.
Official VIA continues to use the existing legacy 1-byte dropdown (100–500 ms /
20 ms grid) and the official exact range `options: [100, 500]`. Custom VIA JSON
for QMK boards uses exact `options: [1, 65535]` (the uint16 maximum; 99999 does
not fit) on the same 2-byte exact IDs. H7S stays on 100–500 in the official
definition and app-owned custom JSON until its firmware is approved to match.

This is an additive exact-millisecond wire path, not removal of firmware legacy
compatibility. Preserve every legacy value ID and official VIA behavior, while ERA custom
JSON exposes only the nine exact controls and does not duplicate their legacy dropdowns.
Generic official or uploaded definitions may still contain legacy controls. Custom JSON may add
`tapdanceKeycodes` as an additional field; official JSON must not. The custom app should show a numeric `ms` input by default
for these controls. Reuse that input for future TAPPING time fields only after
their storage and wire semantics have been audited.

Use Vial only to study interaction design. Implement independently in VIA React code and do not copy license-incompatible or unclear source.

## State synchronization

### Observed failure

VIA updates its cache when the UI writes a value, but keyboard-originated changes do not generally invalidate that cache. Upstream `UI_SYNC_REQUEST 0x16 v1` can request selective V3 Custom Menu reads, but it does not cover keymaps or provide lifecycle recovery.

The reproduced TOMAK case is concrete:

```text
L keymap change
  -> existing EEPROM SYNC commits it to R
  -> R's previously loaded app cache remains marked complete
  -> selecting R skips the keymap read
  -> stale keymap remains until F5
```

### Consistency contract

The product needs current-state convergence, not exactly-once preservation of every intermediate setting event.

- A change on the selected active device normally appears immediately.
- A missed event is recovered automatically without F5.
- Device selection, Configure entry, reconnect, and tab resume validate freshness before stale cache is presented as current.
- Rapid intermediate changes may coalesce; the final readable firmware value must win.
- A split peer is considered updated only after that peer finishes applying the state and can return it.
- Hidden pages do not generate continuous traffic and catch up when active again.

### Implemented mechanism

The mechanism that satisfies the contract above — polling-first revision validation over
`GET_KEYBOARD_VALUE` selector `0x06`, three host domains, revision-bracketed atomic refresh,
per-path transport ownership, and every rejected alternative with the reason it was rejected —
is [ADR 0001](adr/0001-state-sync-protocol.md). It is not restated here.

Three boundaries stay in direction rather than in the record, because they constrain work that
has nothing to do with State Sync.

- **Never expose raw EEPROM addresses in the host protocol.** QMK and H7S storage layouts
  differ, and existing VIA reads already provide authoritative serialization and normalization.
- **`UI_SYNC_REQUEST 0x16 v1` keeps its existing meaning** — all, channel-command and
  command-id semantics unchanged. It is not reinterpreted as State Sync v2 and is not the sole
  correctness mechanism. Unsolicited events, semantic/range event kinds, nonce, ARM/lease, event
  sequence, descriptor queues, ACK journals and a second snapshot/value protocol are outside the
  approved direction. Reconsider them only through a new ADR, and only after measurement shows a
  concrete unmet requirement.
- **Refactor broader Redux state only where these contracts require it.**

Physical-device validation is deferred until software-only evidence leaves a concrete question
that cannot be answered by deterministic simulation, host tests, captured transcript replay, or
static ownership proof. Lack of hardware data must remain an explicit uncertainty and must not
be replaced by assumptions about browser close/open, USB endpoint flushing, response latency,
or 8 kHz performance.

## Compatibility and performance expectations

- Ordinary keyboards without the extension use the existing VIA path unchanged.
- v1-capable firmware retains Custom Menu synchronization.
- Advanced ERA firmware sends no unsolicited State Sync traffic.
- Official VIA clients continue using existing commands and never need an arm/subscription flow.
- Current firmware remains a valid device for official VIA + the official definition. Custom-app-only
  value IDs, ranges, or encodings are not acceptable substitutes.
- Revision counters remain in RAM and never increase EEPROM wear.
- No synchronization send occurs in scan/ISR paths.
- Hidden pages stop revision-poll traffic.
- H7S validation compares polling off/on report interval, jitter and queue overflow under 8 kHz input.

## Acceptance criteria for State Sync

- Same-unit physical changes appear within the measured visible polling bound without F5.
- A change committed from the opposite TOMAK half converges on the USB-side UI without F5.
- Rapid changes settle on the final firmware value.
- Missed `0x16 v1` hints recover through revision or lifecycle checks on advanced-capable firmware.
- Device switch, unplug/replug and tab hide/show never leave stale cache labeled as current.
- Ordinary VIA and v1-only firmware behavior remains intact.
- Hidden state has no ongoing revision-poll traffic.
- H7S input timing and queues show no meaningful 8 kHz regression with polling enabled.

Treat timeout and rate values as measured parameters rather than permanent guesses.

## Remaining decision gates

1. Preserve the accepted `0x02`/`0x06`/v1 wire envelope, three-domain model, 500 ms eligibility
   policy, existing VIA value authority, and exact-millisecond identifiers.
2. Complete physical TOMAK split convergence and official-client transcript checks without
   treating the automated firmware builds as a substitute for flashing or device observation.
3. Keep USB Diagnostics selector `0x07` read-only, opt-in and RAM-only per
   [ADR 0002](adr/0002-h7s-usb-diagnostics.md), and **never couple it to polling mode or to
   State Sync recovery.** Mode selection is always the user's; firmware and app do not produce
   automatic downgrade, automatic mode benchmarks, EEPROM diagnostics history, or a synthetic
   stability score. Host history compares only manual tests with identical device, firmware and
   protocol identity.
4. Reconsider semantic/range events, ACK, extra domains, or a second value protocol only through
   a new ADR after measured polling latency or refresh cost demonstrates a concrete failure.

Before modifying a firmware repository or freezing a protocol, report the need, app and firmware changes, compatibility, failure behavior, and hardware test plan. Cloudflare Pages, DNS, production deployment and other external-service changes also require explicit approval.

## Durable non-goals

- Do not rebuild existing V3 Custom Value features as duplicate React state or protocols.
- Do not replace the Tap Dance engine or split EEPROM synchronization.
- Do not create an ERA-specific design system or manufacturer branding.
- Do not maintain generated definitions as source.
- Do not copy Vial implementation code without a compatible, verified license basis.
- Do not optimize for small diffs at the expense of demonstrated correctness, but avoid speculative frameworks that have no measured need.
