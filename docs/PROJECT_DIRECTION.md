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

The app manifest currently contains 26 QMK ERA custom variants:

| Family    | VIA definitions                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `comm`    | `classicd_a1`, `classicd_a1_ug`, `classicd_core`, `classicd_coreless`, `et_tkl`                                             |
| top-level | `divine`, `era65`                                                                                                           |
| `linx3`   | `fave65s`, `n86`, `n87`, `n8x`                                                                                              |
| `newone`  | `a1`, `h1`, `odessey60h`, `odessey60s`                                                                                      |
| `sirind`  | `brick65`, `brick65s`, `chickpad`, `klein_hs`, `klein_sd`, `tomak` Left/Right, `tomak79h` Left/Right, `tomak79s` Left/Right |

Twenty-five RP2040 variants opt into the common tapping, Tap Dance, exact-ms, and State Sync units. `sirind/brick65` is the permanent ATmega32U4 exception: its 28,672-byte flash budget keeps stock VIA only and does not claim the common ERA tapping, Tap Dance, exact-ms, or State Sync capabilities. Its custom-tree definition therefore remains a separate stored file but exposes only what that firmware actually supports.

`build:kbs` packages the installed official snapshot under `/definitions/v3` and emits the ERA overlay to `/definitions/era/v3/{vpid}.json`. It must preserve official files even when both sources contain the same VPID, and the merged V3 index is the unique union of the two namespaces. Generated output never replaces either canonical source and no provenance or app stock-source tree is produced.

TOMAK79H Left/Right and H7S BRICK60 have been confirmed on hardware to auto-load without manual JSON upload. Do not introduce a parallel runtime loader or external definition service.

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
debounce or anti-ghosting timings are not silently included. A representative non-step value
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
retried by the next eligible poll. An initial unhandled, malformed, or timed-out probe cannot
distinguish old firmware from a communication failure, so it marks only that connection
generation as unverified rather than unsupported.

For the effective State-Sync ERA overlay, the tagged probe runs before any Custom Value GET.
While confirmation is pending, raw Custom menu navigation remains visible and its panes show a
loading state. If confirmation is unverified, the same panes remain visible and show “Unable to
verify feature support. Reconnect the keyboard. If the problem persists, update to the latest
firmware.” All Custom Menu GET/SET/SAVE, dynamic-name reads, and per-key RGB operations are
blocked for that generation. A successful probe enables controls only after the first stable
CONFIG candidate is accepted. Official definitions and Design uploads retain ordinary VIA
behavior and are not put behind this ERA gate.

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
- each candidate also owns the definition identity/epoch used to interpret it, and a
  sideload replace or unload that changes the selected device's effective definition
  invalidates freshness and requests a full authoritative refresh;
- a churned domain retries immediately three times in that owner/request, remains dirty
  after that bound, and is retried by the next poll or a new lifecycle/full request even
  when the next observed revision number equals the last observation;
- a successful SET may update the visible value optimistically but invalidates advanced
  freshness until a later query and authoritative GET verify it. Failed SET/SAVE rolls
  back or keeps the domain dirty for readback rather than leaving intended values as
  current.

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
3. H7S State Sync selector `0x06`은 기존 물리 검증 전까지 별도 범위로 유지한다. 승인된
   USB Diagnostics selector `0x07`은 [ADR 0002](adr/0002-h7s-usb-diagnostics.md)의
   read-only, opt-in, RAM-only 계약을 유지하고 polling mode나 recovery에 결합하지 않는다.
4. Reconsider semantic/range events, ACK, extra domains, or a second value protocol only through
   a new ADR after measured polling latency or refresh cost demonstrates a concrete failure.

Before modifying a firmware repository or freezing a protocol, report the need, app and firmware changes, compatibility, failure behavior, and hardware test plan. Cloudflare Pages, DNS, production deployment and other external-service changes also require explicit approval.

## H7S USB Diagnostics

H7S USB Diagnostics는 State Sync와 독립된 read-only subsystem이다. Canonical ERA
metadata에서 명시적으로 opt-in한 다섯 H7S definition만 versioned selector `0x07`을
probe한다. Firmware는 실제 HID request-to-IN-completion timing, main-loop gap, queue drop,
USB hard event를 RAM에서 aggregate하고 app은 약 1 Hz coherent snapshot만 읽는다.

Mode 선택은 언제나 사용자 소유다. Firmware와 app은 automatic downgrade, automatic
mode benchmark, EEPROM diagnostics history, synthetic stability score를 만들지 않는다.
Host history는 device/firmware/protocol identity가 같은 수동 test끼리만 비교한다. 전체
wire, failure, persistence, UX 계약은 [ADR 0002](adr/0002-h7s-usb-diagnostics.md)를 따른다.

## Durable non-goals

- Do not rebuild existing V3 Custom Value features as duplicate React state or protocols.
- Do not replace the Tap Dance engine or split EEPROM synchronization.
- Do not create an ERA-specific design system or manufacturer branding.
- Do not maintain generated definitions as source.
- Do not copy Vial implementation code without a compatible, verified license basis.
- Do not optimize for small diffs at the expense of demonstrated correctness, but avoid speculative frameworks that have no measured need.
