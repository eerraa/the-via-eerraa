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
debounce or anti-ghosting timings are not silently included. A representative non-step value
such as `137 ms` must round-trip, persist, and drive runtime behavior without being snapped to
the legacy 20 ms grid.

This is an app-and-firmware compatibility change, not a cosmetic replacement of the existing
dropdown. Preserve every legacy value ID and existing JSON behavior for stock
`www.usevia.app`, add an exact-millisecond path only after the identifier/protocol audit, and
express the new definition with standard VIA V3 controls rather than a fork-only JSON schema.
The custom app should show a numeric `ms` input by default for these controls. Reuse that input
for future TAPPING time fields only after their storage and wire semantics have been audited.

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

The original freshness coordinator conflated firmware-observed revisions with revisions whose
VIA GET snapshots had actually been accepted. It also let loaders publish candidates before the
end bracket and gave poll and lifecycle refresh separate in-flight ownership. The implemented
coordinator separates those responsibilities and uses a single path/generation owner.

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
domain changed; they never carry setting values. The accepted domains are:

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

### Reliability boundary and implemented architecture

The transport layer owns one listener, serialized request/response queue, pending matcher,
write timestamp, and connection generation per WebHID path. Strict `0x16 v1`
demultiplexing and explicit-device async operations remain independent of State Sync.
Untagged legacy-command timeout is fail-closed for that transport generation; the tagged
State Sync query can reject one timed-out request without discarding an otherwise confirmed
connection because a late response cannot match a later request tag.

State Sync adds canonical definition/build opt-in, runtime capability confirmation through
`GET_KEYBOARD_VALUE` selector `0x06`, three RAM-only revision tokens, a 500 ms recovery poll,
and revision-bracketed domain refresh. The freshness coordinator has one owner per
path/connection generation across poll, selection, reconnect, and resume work. It keeps
firmware-observed revision separate from the revision of the snapshot actually accepted into
Redux. A revision observed for one domain may dirty another domain, but only that other
domain's own stable GET bracket may advance its accepted revision.

Capability confirmation never blesses data loaded before the probe. It is followed by a full
bracketed refresh before any implemented domain becomes fresh. After capability is confirmed,
one malformed response or timeout keeps the connection capable, marks freshness dirty, and is
retried by the next eligible poll. Only an initial probe failure in a new generation selects
quiet legacy fallback.

The poll is a recovery mechanism, not high-rate full polling. It runs only while the device is
selected and ready, Configure is visible, the document is visible, and that connection is
capable. Hidden pages send no periodic traffic, ordinary keyboards receive no capability
probe, and reconnect/resume perform full authoritative refresh without trusting revision
equality.

Physical-device validation is deferred until software-only evidence leaves a concrete question
that cannot be answered by deterministic simulation, host tests, captured transcript replay, or
static ownership proof. Lack of hardware data must remain an explicit uncertainty and must not
be replaced by assumptions about browser close/open, USB endpoint flushing, response latency,
or 8 kHz performance.

### App responsibility

The app provides a small generic state-sync layer rather than scattered ERA component hooks:

- each WebHID path owns its timestamp, listener, input diagnostics, pending matcher,
  serialized command queue, and connection generation;
- strict `0x16 v1` packets are routed to the owning device's Custom Menu adapter without
  consuming the current command response;
- malformed or unknown reports use a bounded diagnostic/drop path and never become a future
  response;
- an untagged legacy timeout poisons that transport generation because a late response cannot
  safely be attributed to a retry, while the tagged State Sync query uses request-local timeout;
- async keymap/menu operations capture an explicit path, API/transport, definition, and
  generation, then revalidate them before committing Redux state;
- previous-device completions may update only a still-valid cache for that same
  path/generation and never the newly selected device's ready/current state;
- each domain has `unknown | dirty | refreshing | fresh` status plus distinct observed and
  accepted revisions;
- keymap including encoders, macros, and CONFIG layout/menu values are read into isolated
  candidates and committed once only after a stable start/end revision bracket;
- a churned domain retries immediately three times, remains dirty after that bound, and is
  retried even when the next observed revision number equals the last observation;
- a successful SET may update the visible value optimistically but invalidates advanced
  freshness until a later query and authoritative GET verify it.

Refactor broader Redux state only where these contracts require it.

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

Increment a domain revision only after the new value is readable through the
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

Peer revision bookkeeping is domain-precise when the receiver no longer knows the exact key.
The app refresh remains atomic at full-domain precision. Add a finer
domain or changed-range optimization only if measurement shows full-domain recovery is a
real bottleneck.

QMK revision bookkeeping belongs at semantic commit boundaries and must keep
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

## Remaining decision gates

1. Preserve the accepted `0x02`/`0x06`/v1 wire envelope, three-domain model, 500 ms eligibility
   policy, existing VIA value authority, and exact-millisecond identifiers.
2. Complete physical TOMAK split convergence and official-client transcript checks without
   treating the automated firmware builds as a substitute for flashing or device observation.
3. Keep H7S read-only until its response ownership and 8 kHz poll-off/on evidence support a
   separately approved implementation plan.
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
