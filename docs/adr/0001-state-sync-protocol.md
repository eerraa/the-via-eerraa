# 0001 — State Sync revision validation protocol

Status: Accepted
Genre: contract
Canonical for: State Sync authority, identity/capability, revision/envelope and
compatibility; transport/freshness/write coordination; exact macro, import,
continuous-control, and exact-ms requirements

Exact-ms is a 2-byte big-endian `uint16` on the existing Custom Value commands (`CUSTOM_MENU_SET_VALUE` `0x07`, `CUSTOM_MENU_GET_VALUE` `0x08`). Host encode/decode is `shiftFrom16Bit` / `shiftTo16Bit` in `src/utils/keyboard-api.ts`. `getRangeValue` in `src/components/panes/configure-panes/custom/custom-control.tsx` uses those two bytes whenever `max > 255`; both family maxima (500 and 65535) are above that. HID: command, channel, value id, then BE16. `99999` is not a uint16.

Channel and value ids are the `docs/MAP.md` §3 table. This re-measure of custom JSON `_term_exact` `content` and `scripts/build-keyboards.ts` `expectedTermKeys`:

| Control | QMK (`exactMsFamily: qmk`) | H7S (`exactMsFamily: h7s`) |
| --- | --- | --- |
| Global TAPPING term exact | channel 15 / value 5 | channel 15 / value 5 |
| TD0–TD7 term exact | channel 0 / value 72–79 | channel 16 / value 41–48 |

Nine exact `range` controls per opted-in family: `id_qmk_tapping_global_term_exact` and `id_qmk_tapdance_1_term_exact` … `_8_` (`isExactTermCommand` in `src/utils/era-exact-ms.ts`). `brick65` has no `exactMsFamily` and no term controls.

Exact value ids are additive to the legacy ids. Firmware still implements both. Global legacy is channel 15 / value 1, 1-byte × 10 ms, 100–500 / 20 ms grid. Custom JSON in this repo must not expose those legacy term dropdowns (`isLegacyTermCommand`; `scripts/build-keyboards.ts` rejects them).

### SET range and which JSON owns it

Loaded JSON `options` win (`exactTermBoundsFromOptions` in `src/utils/era-exact-ms.ts`). The host then clamps to `[1, 65535]`. Out-of-range, empty, decimal, and non-integer drafts do not write (`parseMillisecondDraft` in `src/utils/millisecond-field.ts`).

| Definition | exact `options` | Host SET |
| --- | --- | --- |
| Custom QMK (`exactMsFamily: qmk`) | `[1, 65535]` | 1–65535 inclusive. 0 and 65536 are rejected. |
| Custom H7S (`exactMsFamily: h7s`) | `[100, 500]` | 100–500 inclusive |
| Family fallback when `options` are omitted | `qmk` → `QMK_EXACT_TAPPING_TERM_BOUNDS`; otherwise `DEFAULT_TAPPING_TERM_BOUNDS` `[100, 500]` | same as that fallback |
| Stock-shaped exact range (fixture `exactGlobalTermControl`; JSON `[100, 500]` even on a `qmk` family) | `[100, 500]` | 100–500. Loaded options win over family. |
| Installed official `via-keyboards` snapshot | no `_term_exact` controls | this host does not send exact-ms on that snapshot |

H7S firmware (`eerraa-qmk-h7s-fw/src/ap/modules/qmk/quantum/via.h`, `eerraa-qmk-h7s-fw/src/ap/modules/qmk/port/tapping_term.c`, `eerraa-qmk-h7s-fw/src/ap/modules/qmk/port/tapdance.c`, `eerraa-qmk-h7s-fw/docs/contract_via.md` §3): the same ids; exact SET is 2-byte BE uint16, 100–500 only; out of range or fewer than two value bytes is refused and the store is unchanged. That matches this repo's H7S custom JSON.

### Legacy GET projection

Legacy GET returns 1-byte units of 10 ms. It floors the stored exact millisecond value onto the 100–500 / 20 ms grid and does not write the exact store. Legacy SET, not GET, is what snaps the store onto that grid.

This host's custom JSON has no legacy term commands, so it does not issue that GET. A client using a definition that still has the dropdown does. Exact GET/SET of 137 does not snap (`tests/state-sync-transport.test.ts`).

> **REFUSED:** widening official JSON exact `options` to the custom-app QMK range.
> **WHY:** official VIA plus official definitions remain required; a custom-app-only path is an error. Stock-shaped exact `options` stay `[100, 500]`.
> **REOPENS:** never.

## State authority and revision model

Existing VIA GET results from firmware are the value authority. State Sync carries
only change-detection metadata; it must not become a second value/snapshot
protocol or let one split half's intent stand in for the other half's state.

The contract has three host domains: keymap, macro, and config. They exist because
their authoritative VIA reads have different mutation and refresh boundaries;
they are host refresh domains, not EEPROM address spaces. The exact mapping from
VIA operations and storage writes belongs to current source:
`src/store/stateSyncThunks.ts` and the domain candidate readers on the host,
`qmk_firmware_eerraa/keyboards/era/common/system/era_state_sync.c` for QMK, and
`eerraa-qmk-h7s-fw/src/ap/modules/qmk/port/era_state_sync.c` for H7S.

A semantic change advances its domain token only after the corresponding
authoritative GET can return the changed value. Persistence of an already
published runtime value is not a second semantic change. Revision tokens are
opaque equality markers; hosts compare equality, not ordering.

A host may accept a domain candidate only when existing VIA GET is bracketed by
matching start/end revisions in the same valid connection context. A mismatch or
query/GET failure cannot promote candidate data. State Sync therefore detects
change while the established VIA commands remain the only value path.

For split durable apply, the target half controls publication. Its token may
advance only after the target has reloaded the applied state far enough that its
existing VIA GET returns the new value. Source-side transfer success or intent
cannot advance target freshness. The QMK durable boundary is owned by
`qmk_firmware_eerraa/keyboards/era/common/split/era_host_peer_storage.c` together
with its State Sync hook.

This model prevents a previously complete host cache from being treated as
authoritative after firmware-side or peer-side mutation, and prevents torn
multi-packet reads from becoming current. It does so without unsolicited State
Sync traffic, preserving official VIA request/response behavior. Existing
`0x16` v1 remains a Custom Menu invalidation hint, not keyboard-state authority.

## Consistency and freshness contract

Firmware-reported revision observation alone never authorizes cached data. Only
a stable revision-bracketed candidate read through existing VIA GET may become
accepted. The coordinator representation and state fields are source-owned by
`src/store/stateSyncThunks.ts` and `src/store/stateSyncSlice.ts`.

- `fresh` means that, on this connection generation, a revision-bracketed
  existing GET snapshot was consistent at the end-revision instant. It does not
  lock out future change.
- `dirty` means UI may keep the last accepted component tree for continuity, but
  must not treat it as current or as the basis for a new write. With no accepted
  snapshot, or after a lifecycle context change, the loading boundary stays
  (`getCustomMenuAvailabilityForDevice` returns `checking`).
- `refreshing` means one loop per domain owns the candidate. Further
  invalidation coalesces onto the same path/generation owner. A lifecycle full
  refresh that arrives while a domain is in flight is queued (`fullPending`) and
  that domain is read again after the in-flight bracket.
- A successful SET may update UI immediately. On an advanced device it does not
  extend `fresh` until a later revision query and authoritative GET finish.
- Change between polls is an unavoidable stale window of a distributed read.
  The bound is the poll interval; the goal is convergence on the final value.
- Hidden (`document.hidden`) has no periodic traffic (`shouldPoll`). Resume
  full-refreshes implemented domains without trusting revision equality
  (`refreshAllDomains`).
- Reconnect and connection-generation replacement do not reuse a previous
  generation's accepted snapshots. A capable ERA selection reacquires KEYMAP
  before ready, CONFIG immediately after ready, and MACRO before first Macro-pane
  use; none of those decisions trusts numeric equality with an older generation.

### Host domains and revision validity

Envelope v1 requires exactly the keymap, macro, and config host domains. Their
current host encoding and authoritative read mapping are owned by
`src/utils/era-state-sync.ts` and the domain candidate readers; the paired
firmware mappings are owned by the QMK/H7S State Sync sources named above.

Revisions are nonzero opaque equality tokens. Unknown domain shape, reserved-space
use, a zero token, or an unsupported envelope version cannot be treated as
capable. Adding or splitting a domain, or assigning meaning to currently
reserved envelope space, requires a new envelope version because v1 peers must
fail closed rather than reinterpret the payload.

## Identity and capability gates

State Sync requires two independent gates:

1. **Canonical identity opt-in.** Only an ERA overlay definition explicitly
   opted in by `config/era-definitions.manifest.json` may attempt State Sync.
   Official snapshot definitions, Design uploads, and arbitrary sideload JSON
   do not gain transport authority from matching identifiers alone. Runtime
   metadata generation is owned by `scripts/build-keyboards.ts` and
   `src/utils/era-advanced-metadata.ts`.
2. **Runtime firmware proof.** Each connection generation must return a
   well-formed capable v1 envelope before State Sync-backed advanced I/O is
   allowed. VIA protocol version or product identity alone is not capability
   proof. Parsing and capability admission are owned by
   `src/utils/era-state-sync.ts`.

An initial unhandled, malformed, or timed-out query leaves that generation
`unverified`: ordinary VIA behavior remains available, while advanced Custom
I/O that depends on State Sync stays blocked. Once a generation has proved
`capable`, a transient query failure does not silently redefine firmware
capability; freshness handling owns the resulting uncertainty.

The static gate protects ordinary VIA devices from extension probes; the runtime
gate proves the actually connected firmware rather than trusting build metadata.
`tests/era-state-sync.test.ts` and `tests/state-sync-transport.test.ts` own the
executable positive and negative cases.

## Envelope and compatibility contract

State Sync remains a read-only selector under the existing VIA
`GET_KEYBOARD_VALUE` command. Envelope v1 is a fixed 32-byte VIA payload
(excluding the WebHID report id), uses big-endian multi-byte integers, echoes a
request tag, reports the complete current domain set and nonzero domain
revisions, and keeps reserved space zero. An unhandled VIA response is not an
envelope; unsupported or malformed envelopes fail closed.

The exact byte offsets and numeric constants are owned by
`src/utils/era-state-sync.ts` and locked by `tests/era-state-sync.test.ts`.
Paired firmware encoders are
`qmk_firmware_eerraa/keyboards/era/common/system/era_state_sync.c` and
`eerraa-qmk-h7s-fw/src/ap/modules/qmk/port/era_state_sync.c`.

Changing selector meaning, payload shape, tag semantics, domain set,
version/status interpretation, integer encoding, or reserved-space use is a
protocol change and requires a new envelope version plus paired host/firmware
review. v1 does not add a new top-level VIA command or unsolicited State Sync
packet.

## App transport and refresh algorithm

Each WebHID path owns one input listener, one serialized request queue, one
pending response matcher, one per-path write timestamp, and one connection
generation (`TransportState` in `src/shims/node-hid.ts`). Selected Redux state
is not transport identity.

A generation-pinned logical reservation sits on that same FIFO.
`HID.withPathReservation` enqueues like any other command. Nested calls with the
same owner and generation run the callback without a second reservation
(`KeyboardAPI.withPathReservation` returns `callback(this)` when already
reserved). There is no
physical scheduler, priority lane, or Redux global lock. Foreground work and a
State Sync bracket wait on the same path; other paths proceed independently.

Each send re-checks the start generation. Disconnect or generation replacement
rejects the active owner, waiting owners, and pending responses
(`replaceGeneration`). Timeout, send failure, malformed response, and callback
exceptions release the owner in `finally` so later queue work can run.

Input-report order (`routeInputReport`):

1. Unsolicited handlers: `parseUISyncRequest` requires length 32, command `0x16`,
   version `0x01`, and valid type/count (`src/utils/ui-sync.ts`). Unused bytes
   inside those 32 are not required to be zero.
2. The current serialized request's pending matcher.
3. Bounded diagnostic drop (`MAX_DIAGNOSTIC_REPORTS` 32).

`APICommand` is `0x01..0x16`. This host never sends `UI_SYNC_REQUEST` (`0x16`).
The State Sync pending matcher in `queryStateSync` checks command `0x02`,
selector `0x06`, and the request tag. Version and capability are checked after
match (`parseStateSyncEnvelope` / `isCapableStateSyncEnvelope`). Probe `0xFF` is
an explicit fallback for that query only. Capable `0x16` dirties CONFIG and runs
`coordinate(..., 'config')`. Ordinary non-opt-in uses
`syncCustomMenuValuesFromRequest`. Opt-in that is not `capable` records CONFIG
invalidation and does not send Custom GET/SET/SAVE.

Untagged legacy commands match on command plus immutable echoed arguments.
Default timeout uses `poison-generation`: the session is terminal and
pending/queued work is rejected until device disconnect/reconnect. Enumeration
and reauthorization preserve poison. Rotating the JS generation and reopening
the WebHID handle cannot distinguish an old firmware reply delivered to the new
listener. The [WebHID close algorithm](https://wicg.github.io/webhid/#dom-hiddevice-close)
releases host resources; it does not cancel a command already received by the
firmware. Automatic recovery requires evidence of a device-side response boundary.

State Sync queries pass `{timeoutBehavior: 'preserve-generation'}`. A timed-out
tag cannot resolve the next tag, so only that pending request is rejected.
Transport generation and an already-confirmed `capable` stay. An initial probe
timeout/unhandled/malformed is `unverified` for that generation only and does
not distinguish missing firmware from a comms error.

Thunks capture path, API, definition identity, selection generation, and start
connection generation, and re-check before Redux commit
(`isSelectedContextCurrent`). Late completion of a previous device may update
only still-valid cache for that path/generation. It cannot mark a newly selected
device ready (`markDeviceReady`). A previous selection generation cannot mark
the new selected device ready.

Poll, initial confirmation, selection, reconnect, and resume share one
path/generation coordinator owner (`coordinate` / `coordinatorOwners`). Domain
refresh (`refreshDomain`):

1. Start query. Record all three tokens as observed. Capture that domain's
   `mutationEpoch`. Observation does not advance any `acceptedRevision`.
2. Mark the domain `refreshing`. Read existing VIA GET into an isolated
   candidate (`readKeymapStateSyncCandidate` / `readMacrosStateSyncCandidate` /
   layout + V3 menu). No Redux current-state patch before the bracket ends.
   Ordinary/non-opt-in and unverified connect still uses
   `loadKeymapFromDevice` per layer. Capable ERA initial selection uses the same
   whole-domain candidate path for KEYMAP before `markDeviceReady`.
3. End query. Record all three observed tokens again.
4. Commit the whole candidate in one action iff start/end revision match, the
   captured mutation epoch is unchanged, and connection/selection generation,
   path, and definition identity are still current. Status becomes `fresh`.
5. Otherwise discard and retry immediately, up to `ERA_STATE_SYNC_REFRESH_RETRIES`
   (3). Exhausted or failed GET/query leaves the accepted snapshot and stays
   `dirty`. A dirty domain is retried even when observed numbers still match.

KEYMAP candidate is every layer and encoder map. MACRO is the whole macro
buffer. CONFIG is layout options plus applicable V3 menu / per-key RGB.
Coordinator preference is KEYMAP, CONFIG, then MACRO. Revision polling skips an
unrequested MACRO domain (`acceptedRevision == 0`, no local mutation, and
`macroReadRequested == false`). Entering the Macro pane or requesting a full
refresh records demand for that path and connection generation before any
revision query, including when joining another coordinator owner. A failed first
query or exhausted read therefore remains eligible for the next visible poll.
The flag is read intent only: it never grants freshness or write authority, and a
new connection generation resets it. Merely observing a revision keeps an
untouched macro buffer lazy.

### Foreground mutation epoch and CONFIG authority

Each `path:generation:domain` has a monotonic `mutationEpoch`
(`beginForegroundMutation`). Macro save/reset/import, dynamic keymap bulk
write/import, encoder import, and capable CONFIG SET/SAVE increment it and mark
the domain dirty before the first packet. A candidate that finished reading
under an older epoch cannot commit. Other paths and new connection generations
have separate epoch spaces.

Advanced CONFIG writes go through `getCustomMenuAvailabilityForDevice` in
`src/store/menusSlice.ts`. For ERA overlay + opt-in:

- `unverified` stays `unverified` (not treated as ordinary VIA)
- otherwise `'available'` requires `capability == capable`, current
  path/connection/selection generation, current definition identity,
  `acceptedRevision !== 0`, current accepted selection generation and
  definition identity, and either (`status == fresh` and
  `acceptedRevision == observedRevision`) or `foregroundWriteDepth > 0`
- no accepted snapshot → `'checking'`
- depth 0 and not that fresh/equal pair → `'reconciling'`

`updateCustomMenuValue` and the other discrete/continuous starts return false
unless availability is `'available'`. A continuous interaction that already
holds `hasContinuousHIDTransaction` does not re-check availability for later
SETs. Ordinary non-opt-in returns `'available'` immediately (no advanced gate).

Each discrete SET/SAVE that starts under that gate owns a
`path:generation:config` local-write session (`beginForegroundWriteSession`).
Later discrete writes on the same current selection/definition join while depth
> 0 and bump `mutationEpoch` again before the packet. Depth 0 external-only
`dirty`/`refreshing` does not open write authority. Depth closes in `finally`
regardless of refresh success. `endForegroundWriteSession` no-ops if generation
no longer matches.

The session does not replace firmware authority. UI may show an optimistic
value; `fresh` is still only a bracketed GET. Equal authoritative menu bytes
keep object identity (`isSameCustomMenuData`); otherwise the candidate commits
atomically. Rollback of an earlier SET applies only to fields still holding that
SET's optimistic value (`rollbackCustomMenuData`). A refresh that sees a
mutation-epoch mismatch returns `'retry'`, drops the reservation, and lets FIFO
foreground writes run first.

### Exact macro and full import transaction

Macro buffer size `B` includes the last completion-marker byte
(`src/utils/keyboard-api.ts`). `B < 1` is invalid. Payload capacity and read
result length are `B-1`. `B=1` allows only an empty payload. Read assembles
exactly `B` logical bytes from offset 0, max 28 bytes per GET
(`MAX_VIA_BUFFER_PAYLOAD`); the last GET requests only the remaining length.
32-byte report padding is not payload (`getMacroBuffer` slices `response[4, 4+size]`).
Byte `B-1` must be zero before bytes `0..B-2` go to the macro parser.

Save transcript (one):

```text
buffer size GET
→ RESET
→ marker 0xFF SET
→ sequential payload SET
→ marker 0x00 SET once
→ marker GET verification
```

RESET is a standalone mutation. RESET, opener, or payload failure does not send
the final zero. Final-zero failure does not retry the transcript. After zero
acknowledgement, marker GET is immediate once, then delays
`MACRO_CLOSE_RETRY_DELAYS_MS` `[25, 50, 100, 200]` and then
`MACRO_CLOSE_RETRY_CAP_MS` (250), capped by
`MACRO_CLOSE_VERIFICATION_DEADLINE_MS` (5000) from the zero acknowledgement.
Short, malformed, timeout, disconnect, generation replacement, and a marker that
stays `0xFF` through the deadline are failure. Redux does not commit the macro
cache before successful verification (`saveMacros`). Same generation then
requests one authoritative reconciliation. Marker zero is this host transcript's
observable completion. It is not a generic QMK power-loss durability proof.

Full layout import (`importLayoutToDevice`) runs macro write/verification,
keymap write, and encoder write as one outer reservation and one foreground
operation. Nested helpers reuse that owner. Independent `Promise.all` owners are
not created. Macro failure does not start keymap/encoder. Partial failure stops
remaining steps, dirties affected domains, and requests one reconciliation on
the same generation. UI success waits for every stage.

### Verified continuous-control SET/SAVE shaping

Only controls with a verified completion lifecycle use an interaction
transaction: custom range/color (`custom-control.tsx`) wrapping `AccentRange`,
`ColorPicker`, `ArrayColorPicker`, and the lighting range/color wrappers.
Pending SAVE lives in the path/generation registry
(`src/utils/continuous-hid-transaction.ts`), not component local state. Each
control has its own reservation. Consecutive identical values are dropped.
Pointer/touch release, keyboard commit, blur, cancel/close, and unmount send
SAVE once per affected channel/object. Channels are not merged.

Device switch flushes pending interaction for the previous path/generation while
that generation is still usable (`completeContinuousHIDTransactionsForPath` in
`src/components/state-sync-runtime.tsx`). Disconnect/generation replacement
fails the reservation (`failContinuousHIDTransactionsForPath` in
`src/components/Home.tsx`) and dirties capable CONFIG. Controls that already
have a completion event do not gain a trailing timer or long-drag maximum-age
SAVE (those symbols are absent). TAPPING/TAPDANCE `DeferredApply`,
toggle/dropdown/button/keycode, unknown custom controls, and the per-key painter
(`use-color-painter.tsx`) stay discrete.

The window after the end-revision response and before Redux commit exists in any
lock-free read. That snapshot was consistent at the end query. The next visible
poll sees a token mismatch and goes dirty.

## Lifecycle policy without a subscription state machine

- Configure-visible is `location === '/'`. `selectConnectedDevice` confirms the
  read-only capability selector before advanced ERA I/O. If capable, it reads
  only macro count metadata, brackets a whole KEYMAP candidate while the
  selection is not yet UI-ready, then calls `markDeviceReady`. CONFIG is queued
  immediately afterwards without delaying that first interactive keymap frame.
  The first full MACRO buffer read is deferred until the Macro pane opens.
- A selected ready device that still has capability `unknown` may also be probed
  by `StateSyncRuntime`. The legacy `probeStateSyncForDevice` recovery entry
  point keeps its conservative full-refresh behavior; it is not the normal
  capable initial-selection path.
- Returning to a capable path after another selection does not attach cache from
  the old selection generation. KEYMAP is reacquired before ready, CONFIG after
  ready, and MACRO remains lazy until first use.
- Leaving Configure (`location !== '/'`) stops the poll (`shouldPoll`). Re-entering
  restores eligibility and runs the revision poll (`syncPolling`), not a
  separate full refresh.
- `document.hidden` stops periodic requests. Resume from hidden on a capable
  selected ready device calls `refreshAllDomains` (full, ignoring revision
  equality).
- Disconnect replaces the transport generation (`replaceGeneration` in
  `src/shims/node-hid.ts`), rejects listener and pending work, and drops path sync.
  The next `ensurePathSync` on the new generation starts domains at `unknown`.
  Reconnect repeats the progressive acquisition above even if revision numbers
  happen to match the previous generation.
- Firmware has no subscription state for client replacement. A new client starts
  at the opt-in gate and the read-only query. The official VIA client is not
  sent advanced unsolicited packets.

Recovery from reboot assumes USB disconnect/re-enumeration, which increments
generation. An in-place silent reset that the host cannot observe would be a
counterexample (same revision numbers). No boot/session token is added to this
envelope until that path is measured.

## Convergence proof and counterexamples

For a supported domain `d`, eventual convergence uses these premises, which match
this host and the QMK/H7S token bumpers that exist:

1. Every semantic commit that changes firmware-readable `S_d` changes token
   `R_d` exactly once after GET can return the new value (QMK/H7S skip 0 on
   wrap; a no-op SET does not bump).
2. While selected and visible, the revision poll is retried. A domain required
   for initial or foreground use is revision-bracketed and retryable; later
   lifecycle full refresh remains a recovery path.
3. After some time `T`, state is stable.
4. Two comparable queries do not see a full 32-bit wrap of `R_d`.
5. Uncertain connection boundaries never reuse an accepted snapshot from the
   previous connection generation. Each domain is reacquired before that domain
   is exposed as current; numeric revision equality alone is insufficient.

A successful query after `T` that differs from the cached token brackets existing
GET with start/end `R_d`. Stable state makes those tokens equal, so the candidate
is final `S_d` and the atomic commit installs it. Transient query/GET failure
leaves dirty and repeats. Missing firmware increment hooks are not repaired by
events or ACKs.

| Fault | Advanced-capable device | Legacy `0x16` v1-only device |
| --- | --- | --- |
| Lost last event | No advanced events. Next revision poll reads the current token. | **Counterexample:** without a later `0x16` or lifecycle reload, the last Custom Menu change does not auto-recover. Kept as v1 compatibility. |
| Duplicate `0x16` | Same CONFIG invalidation coalesces. GET is authority. | Duplicate GET may occur; values still converge. |
| Reordered `0x16` | Hint carries no value. | Each hint only narrows; GET reads current. |
| Event overflow/coalescing | No advanced event queue. The revision token coalesces intermediate change. | Losing the last v1 hint is the counterexample above. |
| Change during refresh | Start/end mismatch discards the candidate. Change after end is the next poll. | A further v1 hint queues another pass. Without a last hint, nothing is guaranteed until lifecycle. |
| Revision wrap | Exact full wrap between polls is an equality-alias counterexample. No commit-rate limiter exists in this host. Remaining. | Not applicable. |
| Firmware reboot | Re-enumeration generation plus progressive reacquisition ignores numeric equality. In-place silent reset is remaining. | Recovers if lifecycle reload runs. |
| Reconnect / device switch | Freshness is per path+generation. KEYMAP is reacquired before ready, CONFIG immediately after, and MACRO before first use; none trusts old-generation equality. | Only ordinary VIA lifecycle load. |
| Hidden / resume | Hidden poll count is 0. Resume full-refresh does not trust equality. | Recovers if the same app-core resume full refresh runs. |

## TOMAK durable peer authority

On split durable apply, the target half owns State Sync publication. A target
domain revision may advance only after target readback/reload has made the new
state observable through the target's existing VIA GET. Transfer readiness,
source-side success, or source intent is not sufficient; a failed target
readback must not be represented as a published target state.

This keeps the revision token aligned with the same firmware authority the host
will subsequently read, rather than turning split transport progress into a
second source of truth. The implementation owners are
`qmk_firmware_eerraa/keyboards/era/common/split/era_host_peer_storage.c` and
`qmk_firmware_eerraa/keyboards/era/common/system/era_state_sync.c`. No separate
split State Sync event or value transport is required.

## H7S response ownership and 8 kHz boundary

H7S VIA responses have one producer.
`eerraa-qmk-h7s-fw/src/ap/modules/qmk/port/via_hid.c`: USB RX is copied into a
bounded queue; the main loop calls `raw_hid_receive` then
`usbHidEnqueueViaResponse` once on that buffer. `raw_hid_send` in the same file
is an empty stub. `eerraa-qmk-h7s-fw/src/hw/driver/usb/usb_hid/usbd_hid.c`
owns the ordinary VIA response queue. Keyboard input reports use a separate
send path (`usbHidSendReport` / `HID_EPIN_ADDR` `0x81`).

Polling-first has no unsolicited State Sync event, so H7S does not add a second
VIA-IN producer. `era_state_sync_via_command` fills the existing request buffer
and returns; `via_hid_task` enqueues once. Filling `raw_hid_send` or enqueueing
a second time would duplicate the response.

`USBD_LL_Transmit` in `usbd_hid.c` is called with `HID_VIA_EP_OUT` (`0x04`)
while the busy acquire uses `HID_VIA_EP_IN` (`0x84`). That is a source
discrepancy. It is not corrected in this ADR because hardware works is not
evidence for a guessed patch. Direction handling and completion/busy ownership
stay read-only until traced and confirmed on hardware.

A revision poll is one ordinary request/response. H7S 20 ms VIA dequeue pacing
is open in `eerraa-qmk-h7s-fw/docs/state_open.md` (D-2):
`usbHidEnqueueViaResponse` refreshes a delay on enqueue, and SOF waits 20 ms
from last enqueue. Poll off/on A/B against HS 8 kHz input (interval/jitter,
input queue overflow, VIA latency/timeout) is remaining hardware measurement.

## Compatibility requirements

- **Ordinary VIA keyboards and definitions without canonical opt-in:** no State
  Sync probe or advanced State Sync traffic. Existing VIA definition and command
  behavior remains the baseline.
- **ERA opt-in with unverified firmware:** ordinary VIA behavior continues, but
  State Sync-dependent Custom I/O is not enabled without runtime capability
  proof.
- **Official VIA client with advanced ERA firmware:** firmware emits no
  unsolicited State Sync packet. A client that never requests the selector sees
  existing command meanings and responses.
- **Existing `0x16` v1 Custom Menu sync:** its packet grammar and role remain
  unchanged. State Sync does not redefine it or make it keyboard-state
  authority.
- **VIA protocol version:** it is not State Sync capability evidence; canonical
  identity opt-in plus a capable envelope is required.

Official `usevia.app` operation with official VIA V3 definitions remains a
required compatibility path. A feature that works only through this custom app
is not an acceptable replacement for that path. Host compatibility entry points
are `src/utils/era-state-sync.ts`, `src/utils/ui-sync.ts`, and
`src/utils/era-advanced-metadata.ts`; paired firmware response ownership remains
in the QMK/H7S State Sync sources.

## Consequences

Initial firmware/app state is three revision tokens, a read-only query, and
per-device freshness. Official-client safety is the absence of unsolicited
advanced traffic, not a lease timeout. Selected visible devices therefore show
change with poll-interval latency. Combined CONFIG refresh cost and H7S
control-plane effect remain to be measured.

Legacy v1-only devices (no State Sync opt-in) keep existing behavior and do not
auto-recover a lost last `0x16`. An opt-in ERA overlay connection that cannot
confirm capability keeps ordinary VIA keymap flow, blocks Custom I/O, and shows
the unverified message. Only advanced-capable devices get bounded automatic
convergence.

## Verification

Executable detail belongs to the tests rather than a duplicate case ledger here:

- `tests/era-state-sync.test.ts` owns v1 request/envelope parsing, capability
  rejection cases, and canonical definition opt-in behavior.
- `tests/state-sync-transport.test.ts` owns runtime capability gating,
  revision-bracketed refresh, and the transport/freshness integration.
- `tests/docs-contract.test.ts` owns active document links, scope declarations,
  and entry-chain reachability.

The paired firmware paths named above establish a source-level compatibility
pair only when both current working trees are inspected. This repository's test
runner does not execute those firmware sources and a path/link check is not a
paired runtime proof. Firmware-local host suites and HIL measurements remain
owned by their firmware repositories and by the hardware evidence list below.

## Remaining hardware evidence

Automated tests do not replace hardware. Still open:

- TOMAK left/right flash, opposite-half durable apply, and UI convergence
- `0x16` v1 transcript on official VIA clients and shipped firmware
- USB reconnect and in-place silent reset
- After EEPROM CLEAN, QMK `ERA_STORAGE_QUIET_DEFER_MS` (500) /
  `ERA_VIA_SYSTEM_RESTART_DEFER_MAX_MS` (2000) versus when this host resumes
  polling
- Endpoint flush after a legacy timeout (fail closed until then)
- H7S 8 kHz poll off/on A/B, and the 20 ms VIA dequeue pacing in H7S D-2
- `USBD_LL_Transmit(HID_VIA_EP_OUT)` versus `HID_VIA_EP_IN` busy acquire

Flashing hardware or changing firmware is not auto-approved because this ADR's
host implementation exists.
