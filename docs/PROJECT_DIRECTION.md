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

### Working architecture: semantic event plus revision recovery

```text
Firmware semantic commit
    -> increment RAM-only domain revision
    -> emit a compact semantic invalidation event
    -> app reuses existing VIA GET to read authoritative values
    -> patch only the affected per-device cache/UI region

Lost event, browser freeze, reconnect, or device switch
    -> compare domain revisions
    -> reload only mismatched domains through existing GET commands
```

Events describe what changed rather than carrying the new value. Candidate targets include:

- `CUSTOM_MENU(channel, command)`
- `KEYMAP(layer, row, column)` or logical range
- `MACRO_RANGE(offset, length)`
- encoder or keyboard-value identifiers
- `DOMAIN_INVALIDATED(domain)` when exact scope is unavailable

Never expose raw EEPROM addresses in the host protocol. QMK and H7S storage layouts differ, and existing VIA reads already provide authoritative serialization and normalization.

### Reliability boundary

The initial extension should contain only the mechanisms needed to make the fast path safe and the cache recoverable:

- opt-in definition/build metadata plus runtime capability confirmation;
- a simple `ARM_SYNC(client nonce, timeout)` concept so old clients receive no unsolicited v2 traffic;
- a short event sequence number to detect gaps;
- RAM-only revisions for a small set of state domains;
- bounded event coalescing and domain invalidation on descriptor overflow;
- a low-frequency revision watchdog while the relevant page is visible;
- immediate revision checks at lifecycle and device-selection boundaries.

The exact command ID and 32-byte wire layout are not frozen. Specify them in a short ADR and review them with the user before firmware implementation. Keep upstream `0x16 v1` as a Custom Menu compatibility adapter.

The watchdog is a recovery mechanism, not high-rate full polling. A provisional five-second interval is small control-plane traffic and must stop while hidden; final intervals come from hardware measurements.

Do not initially add:

- ACK/retransmission for every event;
- a firmware event journal retained until ACK;
- a complex subscription-mask/renew state machine;
- a second snapshot value protocol;
- a wholesale Redux redesign;
- continuous background reads for every authorized device;
- a new split exact-range transport.

Reconsider ACK only if fault injection or hardware testing shows repeated event loss while the page is active, or if the bounded revision recovery delay is unacceptable.

### App responsibility

The app should provide a small generic state-sync layer rather than scattered ERA component hooks. The first implementation needs:

- per-device HID timing and deterministic event/response demultiplexing;
- per-device freshness such as `fresh | dirty | refreshing` for implemented domains;
- a revision check when selecting a device instead of trusting a complete cache;
- semantic refresh adapters that call existing GET methods and patch Redux state;
- race handling when an event arrives during a multi-packet read or write.

Only the selected capable device needs an active sync arm initially. Non-selected device caches may remain dirty and are validated when selected. Refactor broader Redux state only where this contract requires it.

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

Emit an event only after the new value is readable through the corresponding VIA GET path.

For a local runtime change, this is after the semantic setter completes. For a split peer change:

```text
source change
  -> existing split/EEPROM synchronization
  -> USB-side peer staged apply
  -> write/readback or CRC success
  -> required runtime reload
  -> peer revision/event
  -> app readback from that peer
```

The app must not infer peer success from the source half's intent. Existing firmware remains responsible for split replication and conflict handling.

Start peer notification at domain precision if the receiver no longer knows the exact key. Refresh the visible layer first and mark the remainder dirty. Add changed-range accumulation inside the existing apply pass only if measurement shows domain recovery is a real bottleneck.

QMK notifications belong in deferred housekeeping/task code, never scan or interrupt hot paths.

H7S requires a native unsolicited-event TX path. Its current `raw_hid_send()` is a stub while ordinary VIA responses use `usbHidEnqueueViaResponse()`; filling the stub blindly can duplicate responses. Use a separate event enqueue or a TX dispatcher with explicit response/event ownership, lower priority than keyboard reports, backpressure, and queue instrumentation.

## Compatibility and performance expectations

- Ordinary keyboards without the extension use the existing VIA path unchanged.
- v1-capable firmware retains Custom Menu synchronization.
- v2 firmware sends advanced events only after the ERA fork arms them.
- Official VIA clients can continue using existing commands against ERA firmware without enabling v2 events.
- Revision counters remain in RAM and never increase EEPROM wear.
- No synchronization send occurs in scan/ISR paths.
- Hidden pages stop watchdog traffic.
- H7S validation compares sync-on/off report interval, jitter and queue overflow under 8 kHz input.

## Acceptance criteria for State Sync

- Same-unit physical changes appear without F5.
- A change committed from the opposite TOMAK half converges on the USB-side UI without F5.
- Rapid changes settle on the final firmware value.
- Deliberately dropped events recover through revision or lifecycle checks.
- Device switch, unplug/replug and tab hide/show never leave stale cache labeled as current.
- Ordinary VIA and v1-only firmware behavior remains intact.
- Hidden state has no ongoing watchdog traffic.
- H7S input timing and queues show no meaningful 8 kHz regression.

Treat timeout and rate values as measured parameters rather than permanent guesses.

## Development sequence and decision gates

Natural next sequence:

1. Write a concise ADR for the consistency contract, capability operations and proposed wire format.
2. Establish app transport demultiplexing and per-device freshness with automated fake-device tests.
3. After user approval, prototype same-unit semantic events in an isolated QMK worktree.
4. Connect TOMAK split notification at its durable peer-commit boundary.
5. Fault-test lost events, rapid changes, lifecycle transitions and device switching.
6. Add exact-range or ACK complexity only if evidence calls for it.
7. Implement the same logical protocol through the H7S native TX path and measure 8 kHz behavior.

Before modifying a firmware repository or freezing a protocol, report the need, app and firmware changes, compatibility, failure behavior, and hardware test plan. Cloudflare Pages, DNS, production deployment and other external-service changes also require explicit approval.

## Durable non-goals

- Do not rebuild existing V3 Custom Value features as duplicate React state or protocols.
- Do not replace the Tap Dance engine or split EEPROM synchronization.
- Do not create an ERA-specific design system or manufacturer branding.
- Do not maintain generated definitions as source.
- Do not copy Vial implementation code without a compatible, verified license basis.
- Do not optimize for small diffs at the expense of demonstrated correctness, but avoid speculative frameworks that have no measured need.
