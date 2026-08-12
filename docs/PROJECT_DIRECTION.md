# ERA VIA Fork project direction

> This is the durable project brief. Update it when goals or accepted architecture change; use `docs/adr/` for detailed decisions and the external handover for transient session state.

## Mission

Build an unofficial, manufacturer-neutral VIA fork for ERA PCB and firmware work while retaining the experience and compatibility of upstream VIA. This is not a clean-sheet configurator and not a rebrand for SIRIND, NEWONE, Linx3, or another keyboard manufacturer. ERA/eerraa identifies the PCB/firmware platform and fork maintainer.

Priority order:

1. Firmware remains the authoritative source of keyboard state.
2. Supported keyboards work without manual JSON loading or page refreshes.
3. Ordinary VIA keyboards and existing VIA V3 definition/command paths continue to work.
4. Configurator control-plane traffic does not impair the 8 kHz input data-plane.
5. Complexity is introduced only for a demonstrated correctness, recovery, or maintenance need.

Upstream diff minimization is useful but no longer an end in itself. A well-tested core improvement is preferable to an ERA-specific workaround when VIA's existing architecture is the actual limitation.

## Established direction and completed foundation

### Definitions

`era-definitions/v3` is the canonical configurator-definition source. The build combines pinned official VIA definitions with explicit ERA definitions, validates schema and identity contracts, and emits the same decimal VID/PID index consumed by the existing VIA loader.

TOMAK79H Left/Right and H7S BRICK60 have been confirmed on hardware to auto-load without manual JSON upload. Do not introduce a parallel runtime loader, external definition service, or second manually maintained keyboard-definition repository.

Firmware repositories remain authoritative for USB identity and protocol implementation. The app verifies those contracts against explicit paths and commits without treating firmware-side JSON copies as a second configurator source.

### Identity UI

The approved global UI keeps VIA's visual language. The upper-right area contains language selection and a subtle, non-clickable `ERA` wordmark. Do not add manufacturer branding or redesign the overall interface.

### Tap Dance

TOMAK firmware and VIA V3 JSON already implement TD0–TD7, their four action slots, tapping term, storage, and the engine. The remaining work is UI quality:

- extract/reuse VIA's existing category/card keycode picker;
- make V3 `keycode` controls open that picker;
- support search, clear, modifiers, layers, Mod-Tap and Layer-Tap composition;
- preserve unknown 16-bit values as hex and retain text/hex input as an advanced escape hatch.

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

The app also contains selected-device coupling in keymap/menu thunks and a global, rather than per-device, HID write timestamp. These are core correctness issues to fix before layering more notifications on top.

### Consistency contract

The product needs current-state convergence, not exactly-once preservation of every intermediate setting event.

- A change on the selected active device normally appears immediately.
- A missed event is recovered automatically without F5.
- Device selection, Configure entry, reconnect, and tab resume validate freshness before stale cache is presented as current.
- Rapid intermediate changes may coalesce; the final readable firmware value must win.
- A split peer is considered updated only after that peer finishes applying the state and can return it.
- Hidden pages do not generate continuous traffic and catch up when active again.

### Working architecture: polling-first revision validation

```text
Selected, visible, explicitly opted-in capable device
    -> read small RAM-only domain revisions at a measured low frequency
    -> compare KEYMAP / MACRO / CONFIG equality tokens
    -> reload only mismatched domains through existing VIA GET commands
    -> commit a stable, revision-bracketed snapshot to that device's cache

Reconnect, tab resume, or uncertain connection lifecycle
    -> do not trust revision equality
    -> perform the required full authoritative refresh
```

Firmware remains the only value authority. Revision tokens indicate that an existing GET
domain changed; they never carry setting values. The initial candidate domains are:

- `KEYMAP`: dynamic keymap and encoder reads;
- `MACRO`: dynamic macro reads;
- `CONFIG`: applicable persistent keyboard values and V3 Custom Value reads.

Never expose raw EEPROM addresses in the host protocol. QMK and H7S storage layouts differ, and existing VIA reads already provide authoritative serialization and normalization.

Upstream `UI_SYNC_REQUEST 0x16 v1` remains an unchanged Custom Menu invalidation hint and
keeps its existing all, channel-command, and command-id semantics. It is not reinterpreted
as State Sync v2 and is not the sole correctness mechanism. Unsolicited advanced events,
semantic/range event kinds, nonce, ARM/lease, event sequence, descriptor queues, ACK
journals, and a second snapshot/value protocol are not part of the approved working
direction. They may be reconsidered only if polling and refresh measurements demonstrate
a concrete unmet requirement.

### Reliability boundary and staged implementation

State Sync work is split so transport correctness does not depend on an unapproved wire
allocation.

**App Transport/Cache Phase 1** establishes per-device HID ownership, one listener and one
serialized request/response queue per path, strict `0x16 v1` demultiplexing, connection
generations, fail-closed legacy timeout handling, explicit-device async operations, and
generation-guarded cache completeness. It sends no new command and adds no revision or
freshness protocol.

**Phase 2** may add opt-in definition/build metadata, runtime capability confirmation, an
as-yet-unassigned read-only `GET_KEYBOARD_VALUE` selector, three RAM-only revision tokens,
selected-visible polling, and revision-bracketed atomic domain refresh. Selector namespace,
poll interval, CONFIG refresh cost, reconnect/resume behavior, and QMK/H7S implementation
and compatibility tests remain a separate user decision gate. No selector number or 32-byte
wire layout is frozen by this document.

The poll is a recovery mechanism, not high-rate full polling. Hidden pages send no periodic
traffic, ordinary keyboards receive no capability probe, and timing values are chosen from
browser/QMK/H7S measurements instead of hard-coded guesses scattered through the app.

### App responsibility

The app should provide a small generic state-sync layer rather than scattered ERA component
hooks. Phase 1 first makes the existing transport and cache ownership deterministic:

- each WebHID path owns its timestamp, listener, input diagnostics, pending matcher,
  serialized command queue, and connection generation;
- strict `0x16 v1` packets are routed to the owning device's Custom Menu adapter without
  consuming the current command response;
- malformed or unknown reports use a bounded diagnostic/drop path and never become a future
  response;
- a legacy timeout poisons that transport generation because an untagged late response
  cannot safely be attributed to a retry;
- async keymap/menu operations capture an explicit path, API/transport, definition, and
  generation, then revalidate them before committing Redux state;
- previous-device completions may update only a still-valid cache for that same
  path/generation and never the newly selected device's ready/current state.

Per-domain `dirty | refreshing | fresh(revision)` coordination and revision-bracketed refresh
belong to Phase 2. Refactor broader Redux state only where these contracts require it.

Important code areas:

```text
src/utils/keyboard-api.ts
src/shims/node-hid.ts
src/components/Home.tsx
src/store/keymapSlice.ts
src/store/menusSlice.ts
src/store/devicesThunks.ts
```

### Firmware and split responsibility

Increment a future domain revision only after the new value is readable through the
corresponding VIA GET path. Firmware sends no unsolicited advanced State Sync packet.

For a local runtime change, this is after the semantic setter completes. For a split peer change:

```text
source change
  -> existing split/EEPROM synchronization
  -> USB-side peer staged apply
  -> write/readback or CRC success
  -> required runtime reload
  -> peer domain revision increment
  -> app readback from that peer
```

The app must not infer peer success from the source half's intent. Existing firmware remains responsible for split replication and conflict handling.

Start future peer revision bookkeeping at domain precision if the receiver no longer knows
the exact key. The initial app refresh remains atomic at full-domain precision. Add a finer
domain or changed-range optimization only if measurement shows full-domain recovery is a
real bottleneck.

Any future QMK revision bookkeeping belongs at semantic commit boundaries and must keep
configurator control traffic out of scan and interrupt hot paths.

Polling-first does not require an H7S unsolicited-event TX path. A future selector response
must retain the existing ordinary VIA request/response owner; filling the current
`raw_hid_send()` stub or adding a second producer could duplicate responses. Endpoint and
queue ownership still require read-only trace and hardware measurement before H7S changes.

## Compatibility and performance expectations

- Ordinary keyboards without the extension use the existing VIA path unchanged.
- v1-capable firmware retains Custom Menu synchronization.
- Advanced ERA firmware sends no unsolicited State Sync traffic.
- Official VIA clients continue using existing commands and never need an arm/subscription flow.
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

## Development sequence and decision gates

Natural next sequence:

1. Complete App Transport/Cache Phase 1 without new wire commands: per-device transport,
   strict demultiplexing, fail-closed generations, explicit-device thunks, and fake-device tests.
2. At the Phase 2 user gate, review the unassigned `GET_KEYBOARD_VALUE` selector namespace,
   KEYMAP/MACRO/CONFIG model, selected-visible polling policy, reconnect/resume full refresh,
   revision-bracketed atomic refresh, polling interval, and CONFIG read cost.
3. After separate approval, implement and fault-test Phase 2 app capability/revision handling
   while proving ordinary-device command transcripts remain unchanged.
4. Report a QMK/TOMAK plan for revision hooks at local and durable peer-readback boundaries,
   then use an approved clean worktree/branch only.
5. Report an H7S response-ownership plan and measure polling off/on behavior at 8 kHz before
   firmware changes.
6. Reconsider semantic/range events, ACK, or extra domains only if measured polling latency or
   refresh cost fails the acceptance criteria.

Before modifying a firmware repository or freezing a protocol, report the need, app and firmware changes, compatibility, failure behavior, and hardware test plan. Cloudflare Pages, DNS, production deployment and other external-service changes also require explicit approval.

## Durable non-goals

- Do not rebuild existing V3 Custom Value features as duplicate React state or protocols.
- Do not replace the Tap Dance engine or split EEPROM synchronization.
- Do not create an ERA-specific design system or manufacturer branding.
- Do not maintain generated definitions as source.
- Do not copy Vial implementation code without a compatible, verified license basis.
- Do not optimize for small diffs at the expense of demonstrated correctness, but avoid speculative frameworks that have no measured need.
