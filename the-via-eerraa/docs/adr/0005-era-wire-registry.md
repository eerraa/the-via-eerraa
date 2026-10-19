# 0005 — ERA VIA wire registry and connection profile

Status: Accepted
Genre: contract
Canonical for: ERA wire-number ownership, allocation and retirement, generated
app/firmware interfaces, official VIA collision checks, and connection protocol decisions

## Ownership

`config/era-wire.json` is the machine-readable owner of VIA versions, the
official VIA command/keyboard-value/channel tables, and ERA wire allocations.
`scripts/generate-era-wire.ts` validates it and generates
`src/utils/era-wire.generated.ts` and the same `era_wire.h` for both firmware
repositories. Generated files are not edited independently. The digest is
SHA-256 of the original registry file bytes, including whitespace.
The generated banner names the registry, generator and this ADR with the
`the-via-eerraa/` foreign-repository prefix so firmware document checkers do
not resolve app paths against a firmware checkout.

The official tables contain exactly the three upstream-shaped enums in
EERRAA `quantum/via.h`, not H7S's ERA additions. Official channel zero is a
shared Custom Value surface, not an ERA channel allocation. ERA values on it
belong to their value-ID namespaces. Ordinary VIA keyboards retain all
official meanings.

Registry groups describe feature numbers, `users` identify app/EERRAA/H7S
consumers (including historical consumers), and `namespace` defines where
uniqueness applies. Per-channel value IDs and payload enums are separate
namespaces. The mutually exclusive EERRAA backlight, Tomak and Odessey
keyboard-channel handlers have distinct board namespaces: their shipped
overlap is not a collision on one keyboard. Common keyboard-channel values
and Tap Dance share one namespace. H7S and EERRAA channels have separate
namespaces because the same channel has different shipped meanings.

State authority, envelope semantics and exact-ms behavior remain owned by
[ADR 0001](0001-state-sync-protocol.md). Diagnostics retirement remains owned
by [the polling/diagnostics ADR](0002-h7s-usb-diagnostics.md). This registry
does not authorize new probes, change payloads, or renegotiate firmware ABI.

## Status and reservation

Every entry has a status:

- `current`: shipped and supported at this address. Included in both the TS
  module and C header.
- `legacy`: still understood for a named older protocol/firmware. Kept in TS
  for compatibility, excluded from the current firmware header.
- `retired`: reserved forever; not a new feature or probe target. Historical
  TS decoders may still name it; current firmware does not implement it.

Legacy/retired entries require a note naming their firmware/protocol and
forbidding reuse. In particular, State Sync's current and legacy selectors are
`STATE_SYNC_SELECTORS`; the legacy entry overlaps official keycodes-version
only on old VIA firmware. `USB_DIAGNOSTICS_SELECTORS.RETIRED` is retired,
not another State Sync fallback. H7S also reserves its retired polling-monitor
value ID. Do not infer a free allocation from an absent implementation.

`era.reserved` owns inclusive ranges. ERA keyboard values occupy the vendor
high-byte band; ERA channels occupy the allocated vendor channel band. The
registry contains the exact range endpoints and per-feature value-ID bands,
including all current shipped values. Legacy/retired addresses may sit outside
the current bands. Every ERA entry is one wire byte. Commands, keyboard values,
channels and value IDs are addressed namespaces: a current entry there must sit
inside a reservation, and no ERA command band is reserved, so a current command
needs one first. Payload enums, markers and statuses are not addressed but are
still one byte. The validator rejects malformed hex, values above `0xFF`,
duplicate numeric values within a namespace (even with different hex spelling),
current official collisions, unreserved current addresses, and missing notes.
No compaction or renumbering of shipped values is permitted.

## Adding or retiring a number

1. Edit the registry first. Select the real wire namespace, check both
   firmwares and definition surfaces, and add a new unused address inside its
   reservation. Never reuse a legacy/retired allocation.
2. Run `bun run era-wire:generate`. Consume its typed app constants; the
   connection profile, not a firmware date string, chooses protocol behavior.
3. Generate both firmware headers with explicit roots:
   `bun run era-wire:generate --eerraa <EERRAA-root> --h7s <H7S-root>`.
   EERRAA receives `qmk_firmware_eerraa/keyboards/era/common/system/era_wire.h`;
   H7S receives `eerraa-qmk-h7s-fw/src/ap/modules/qmk/port/era_wire.h`.
   Commit each generated header with its
   consuming firmware change; their bytes must agree.
4. Run `bun run era-wire:check` and repeat it with both root options. Check
   mode regenerates in memory and compares bytes without writing. Run
   `bun run test:p1`, the affected app tests, and both firmware wire/
   host checks before releasing a coordinated change.

Retirement changes the status and records the historical users and non-reuse
note, rather than deleting the entry. Keep the existing meaning until every
supported consumer has a compatibility path. Removed runtime implementations
must continue to refuse retired requests.

Firmware checks must expand `ERA_WIRE_VIA_OFFICIAL_COMMANDS(X)`,
`ERA_WIRE_VIA_OFFICIAL_KEYBOARD_VALUES(X)` and
`ERA_WIRE_VIA_OFFICIAL_CHANNELS(X)` against their actual `via.h` enum symbols
with compile-time assertions, and compare their official name sets to reject
missing/extra official entries. H7S's registered ERA extensions are excluded
from that official-set comparison, not mistaken for upstream allocations.
Version assertions use the generated protocol/keycodes macros. A stale header
check alone does not prove that a firmware dispatcher uses the right value:
the firmware's own checks must bind its aliases/handlers to generated macros.

## Per-connection decisions

`src/utils/connection-profile.ts` owns protocol/keycodes facts, dictionary and
macro-encoding selection, import-only legacy key names, and State Sync
selector selection. Facts are supplied by the existing connection/version
readers; the profile does not add reads or capability guesses. Protocol-13
keycodes stay unknown until a keycodes version arrives. Rendering may use an
empty dictionary while waiting; macro encoding still refuses an unknown one.

Probe current State Sync first. Only a complete exact `id_unhandled` echo
permits the legacy selector. Only a capable envelope pins a selector, scoped
to WebHID path and connection generation. Timeouts, malformed packets and
unsupported envelopes do not permit fallback. Reconnection discards the
choice; selection changes within one connection do not.
