# 0001 — State Sync revision validation protocol

Status: Accepted
Genre: contract
Canonical for: State Sync authority, identity/capability, revision/envelope and
compatibility; transport/freshness/write coordination; exact macro, import,
continuous-control, and exact-ms requirements

Exact-ms is a 2-byte big-endian `uint16` on the existing Custom Value commands (`CUSTOM_MENU_SET_VALUE` `0x07`, `CUSTOM_MENU_GET_VALUE` `0x08`). Host encode/decode is `shiftFrom16Bit` / `shiftTo16Bit` in `src/utils/keyboard-api.ts`. `getRangeValue` in `src/components/panes/configure-panes/custom/custom-control.tsx` uses those two bytes whenever `max > 255`; the stock-shaped and Custom maxima (500 and 65535) are above that. HID: command, channel, value id, then BE16. `99999` is not a uint16.

Channel and value ids are the `docs/MAP.md` §3 table. This re-measure of custom JSON `_term_exact` `content` and `scripts/build-keyboards.ts` `expectedTermKeys`:

| Control | QMK (`exactMsFamily: qmk`) | H7S (`exactMsFamily: h7s`) |
| --- | --- | --- |
| Global TAPPING term exact | channel 15 / value 5 | channel 15 / value 5 |
| TD0–TD7 term exact | channel 0 / value 72–79 | channel 16 / value 41–48 |

Nine exact `range` controls per opted-in family: `id_qmk_tapping_global_term_exact` and `id_qmk_tapdance_1_term_exact` … `_8_` (`isExactTermCommand` in `src/utils/era-exact-ms.ts`). `brick65` has no `exactMsFamily` and no term controls.

Exact value ids are additive to the legacy ids. Firmware still implements both. Global legacy is channel 15 / value 1, 1-byte × 10 ms, 100–500 / 20 ms grid. Custom JSON in this repo must not expose those legacy term dropdowns (`isLegacyTermCommand`; `scripts/build-keyboards.ts` rejects them).

### SET range and which JSON owns it

Loaded JSON `options` win (`exactTermBoundsFromOptions` in `src/utils/era-exact-ms.ts`). The host bounds the declared range to `[1, 65535]`; it never clamps an entered value into that range. Out-of-range, empty, decimal, and non-integer drafts do not write (`parseMillisecondDraft` in `src/utils/millisecond-field.ts`).

| Definition | exact `options` | Host SET |
| --- | --- | --- |
| Custom QMK (`exactMsFamily: qmk`) | `[1, 65535]` | 1–65535 inclusive. 0 and 65536 are rejected. |
| Custom H7S (`exactMsFamily: h7s`) | `[1, 65535]` | 1–65535 inclusive. 0 and 65536 are rejected. |
| Family fallback when `options` are omitted | `qmk` and `h7s` → `EXACT_TAPPING_TERM_BOUNDS`; unknown family → `DEFAULT_TAPPING_TERM_BOUNDS` `[100, 500]` | same as that fallback |
| Stock-shaped exact range (fixture `exactGlobalTermControl`; JSON `[100, 500]` even on a `qmk` family) | `[100, 500]` | 100–500. Loaded options win over family. |
| Installed official `via-keyboards` snapshot | no `_term_exact` controls | this host does not send exact-ms on that snapshot |

H7S firmware (`eerraa-qmk-h7s-fw/src/ap/modules/qmk/quantum/via.h`, `eerraa-qmk-h7s-fw/src/ap/modules/qmk/port/tapping_term.c`, `eerraa-qmk-h7s-fw/src/ap/modules/qmk/port/tapdance.c`, `eerraa-qmk-h7s-fw/docs/contract_via.md` §3) must accept the same nonzero uint16 range at the existing H7S IDs. Zero or fewer than two value bytes is refused and the store is unchanged. Exact storage must survive SAVE/reload; the runtime interval must remain representable beyond 65535 ms. This is a paired host/firmware requirement, not evidence from an app-only test. Older H7S firmware may reject values outside 100–500; rejection is a failed write, never permission for the host to clamp or silently send a legacy SET.

### Legacy GET projection

Legacy GET returns 1-byte units of 10 ms. It floors the stored exact millisecond value onto the 100–500 / 20 ms grid and does not write the exact store. Legacy SET, not GET, is what snaps the store onto that grid.

This host's custom JSON has no legacy term commands, so it does not issue that GET. A client using a definition that still has the dropdown does. Exact GET/SET of 137 does not snap (`tests/state-sync-transport.test.ts`).

> **REFUSED:** widening official JSON exact `options` to the custom-app range.
> **WHY:** official VIA plus official definitions remain required for basic controls. Stock-shaped exact `options` stay `[100, 500]`; the stock/Custom support policy is owned by `docs/PROJECT_DIRECTION.md`.
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
  (`getCustomMenuAvailabilityForDevice` returns `checking`, or `failed` after
  an unhandled read).
- `refreshing` means one loop per domain owns the candidate. Further
  invalidation coalesces onto the same path/generation owner. A lifecycle full
  refresh that arrives while a domain is in flight is queued (`fullPending`) and
  that domain is read again after the in-flight bracket unless the firmware
  answered the in-flight read as unhandled.
- A successful SET may update UI immediately. On an advanced device it does not
  extend `fresh` until a later revision query and authoritative GET finish.
- Change between polls is an unavoidable stale window of a distributed read.
  The bound is the poll interval; the goal is convergence on the final value.
- Hidden (`document.hidden`) has no periodic traffic (`shouldPoll`). Resume
  full-refreshes implemented domains without trusting revision equality
  (`refreshAllDomains`).
- A domain read that the firmware answers as unhandled (`0xFF`) is its settled
  answer, not a transient failure, so neither a poll nor a full refresh repeats
  it, and CONFIG reports `failed` instead of `checking`/`reconciling`, until the
  domain's revision changes, a foreground write touches it, or the selection,
  definition or connection is replaced.
- Reconnect and connection-generation replacement do not reuse a previous
  generation's accepted snapshots. A capable ERA selection reacquires KEYMAP
  before ready, CONFIG immediately after ready, and MACRO before the first use of
  its contents (the Macro pane, saving a layout file); none of those decisions
  trusts numeric equality with an older generation. The selection also reads
  the layout options once with the existing GET before ready, which grants no
  CONFIG freshness, and writes none until this connection has read them.

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

## Tap Dance input modes and timing

H7S channel 16 / values 49..56 and QMK keyboard channel 0 / values 80..87
use existing Custom Value GET/SET/SAVE. Payload byte 0 is the per-slot input
mode (0 legacy, 1 after-decision, 2 on-press). GET and SET echo append `0xD2`
in byte 1 as explicit support evidence. An absent/invalid marker retains the
old editor. The custom app sends the same two bytes; firmware reads the mode
byte. The payload encoding remains compatible with a one-byte V3 control, but
official VIA exposes basic Legacy editing only and directs advanced editing to
the Custom app (`docs/PROJECT_DIRECTION.md`, Tap Dance and exact-ms). Read-only
mode bindings may inform that guidance without exposing mode SET. CONFIG
invalidation and authoritative rereads include this control.

Modes 1/2 reserve additional-action `KC_TRNS` for inheritance and `KC_NO`
for explicit silence. Mode 2 requires Hold = `KC_TRNS`. Saving sends changed
actions/term before entering a mode, but leaves mode 2 before writing a new
first-hold action. A refusal stops the batch and keeps the remaining draft.
The inheritance sentinel passes action eligibility only in these additional
fields; it does not become a selectable executable Tap Dance keycode.

H7S storage and runtime contracts are in
`eerraa-qmk-h7s-fw/docs/contract_via.md` and
`eerraa-qmk-h7s-fw/docs/contract_eeprom.md`. QMK persistence and same-image
split requirements are in
`qmk_firmware_eerraa/keyboards/era/common/docs/contracts/era_host_peer_storage_contract.md`.

Tap Dance advanced timing adds hold-term IDs 57..64 / hold-other IDs 65..72
on H7S channel 16, and 88..95 / 96..103 on QMK channel 0. The term is BE16
0..65535 (zero follows the existing decision term); the flag is byte 0/1.
The existing mode response retains value byte 1 `0xD2`, adds byte 2 `0xD3`,
and gates queries for the new IDs. Hold-term replies carry value byte 2
`0xD3`; hold-other replies carry value byte 1 `0xD3`. This extends Custom
Value payloads, not the State Sync envelope. Both settings belong to CONFIG.

An optional Tap Dance input-mode probe may return an exact `id_unhandled`
echo from older firmware. Only that explicit unsupported response means the
new mode/timing features are unavailable; existing action, term, lighting and
feature reads still populate CONFIG. An unmarked mode reply also leaves those
extensions unavailable. Advertised advanced timing requires the complete mode
and timing markers. Missing required values, timeouts, disconnects, and malformed
replies remain failures and retain their transport/error handling; the optional
probe must not turn them into a default setting or a fresh snapshot.

## App transport, lifetime, and refresh coordination

Transport lifetime is per WebHID path; selected Redux state is not transport
identity. Queue/listener/matcher/generation mechanics are owned by
`src/shims/node-hid.ts`. State Sync coordination and freshness state are owned
by `src/store/stateSyncThunks.ts` and `src/store/stateSyncSlice.ts`.
`tests/transport-phase1.test.ts` and `tests/state-sync-transport.test.ts` own
the executable race, cancellation, late-reply, and freshness counterexamples.

The transport contract is:

- Work sharing one path is serialized. A generation-pinned logical reservation
  uses the same FIFO; it creates neither a priority lane nor a Redux-global
  lock. Different device paths remain independent.
- Disconnect or device replacement invalidates that transport lifetime and
  rejects active, pending, and waiting work. Timeout, send/response failure, or
  callback failure must not strand a reservation or block later queue work.
  Inside a reservation, callers await every response before issuing the next
  command; the reservation bypasses the outer FIFO and is not an inner command
  queue. CONFIG menu readers obey this even while probing optional capabilities.
  Transport regression fixtures deliver multi-value replies asynchronously, so
  synchronous fake input reports cannot hide overlapping requests.
- An untagged legacy request timeout fails closed for that generation. Reopening
  a handle, enumeration, or reauthorization is not evidence that an old
  firmware reply can no longer reach the current listener. The
  [WebHID close algorithm](https://wicg.github.io/webhid/#dom-hiddevice-close)
  releases host resources but does not cancel a command already received by
  firmware, so legacy recovery waits for an observable device lifecycle
  boundary.
- A reply whose first byte is `0xFF` (`id_unhandled`) and whose other bytes
  echo the request fails that request without poisoning the generation: it is
  the firmware's answer, so no late reply is left to match a later request.
- A uniquely tagged State Sync query may abandon only its timed-out request
  without poisoning the generation because that delayed tag cannot satisfy the
  next query. Failure of the initial proof leaves that generation `unverified`;
  a transient query failure after capability was proved does not redefine the
  firmware as incapable, but it also grants no freshness.
- A result may become current UI state only while path, connection generation,
  selection generation, and definition identity still match. Late work from an
  older selection must not make a newly selected device ready or fresh.

Legacy menu reads keep GET and cache acceptance inside one path reservation.
They pin the existing foreground mutation epoch before joining the FIFO; an edit
may publish its optimistic value while its SET is still queued. If an edit
crosses the read, the read releases its reservation and rejoins behind that edit
before accepting existing VIA GET results. A transport failure is not retried by
this path. This also applies to full menu loads and individual label reads, so
neither a partial hint nor a slower read can replace a later accepted value.
Writes waiting for CONFIG or their FIFO turn retain their original definition
and selection until the first SET; changing context cancels the unsent write.
Once SET starts, its SAVE may finish on the original valid connection.
A failed SET may roll back only its own optimistic fields. A later accepted
full read or subsequent edit supersedes that rollback, even for equal bytes.

The freshness contract is:

- Revision observation alone never promotes cached data. A whole-domain
  candidate becomes `fresh` only after matching start/end revisions, no
  intervening foreground mutation, and a still-current selection/lifetime
  context. Candidate data is not partially applied before that decision.
- Refresh requests for the same path/generation coalesce. A lifecycle full
  refresh requested while a domain is already in flight must still cause a read
  after that in-flight boundary rather than be lost, unless the firmware
  answered the in-flight read as unhandled.
- Foreground mutation makes the affected domain dirty before its first packet so
  an older candidate cannot overwrite it. Transiently failed or unstable
  reconciliation keeps the last accepted snapshot only for display continuity;
  it remains dirty and retryable, not write authority.
- Exact coordinator fields, domain read composition/order, lazy MACRO demand,
  and retry counts are source/test-owned implementation details rather than a
  second algorithm in this contract.

For advanced CONFIG, the exact availability predicate is owned by
`src/store/menusSlice.ts`. The persistent constraints are that `unverified`
never falls through to ordinary VIA, a new write requires a capable accepted
CONFIG snapshot for the current context that is still fresh against observation,
and external-only dirty/refreshing state cannot bootstrap write authority. An
already-open foreground write session that entered through that gate may finish
its interaction. A discrete write asked for while CONFIG reconciles is not
dropped, because its control still looks usable: it requests that authoritative
re-read, waits for it and then passes the same gate, and choosing another
keyboard meanwhile abandons it.

Optimistic UI does not create freshness: authoritative reconciliation still
comes from revision-bracketed existing VIA GET. A failed optimistic write must
not roll back a newer value, and a candidate is applied atomically only while
its ownership/freshness guards still hold. Ordinary definitions without the ERA
State Sync opt-in keep the existing VIA path.

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

A payload over `B-1` bytes or holding a value outside 0-255 is refused before
RESET, so a write that cannot finish never erases the macros. RESET is a
standalone mutation. RESET, opener, or payload failure does not send
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

Editor saves and layout imports validate every macro expression before RESET;
byte-range checks alone cannot reject an embedded terminator or an untypeable
character. Macro write admission belongs to the device connection, survives
pane changes, and remains held through cache commit or failure reconciliation.
An overlapping write is refused with its draft intact, because serializing HID
packets alone would still allow an older whole-buffer snapshot to erase a
completed edit. A slot edit rebuilds its set from the current store at admission.

Full layout import (`importLayoutToDevice`) runs macro write/verification,
keymap write, encoder write, and the file's Custom Values (Tap Dance) as one
outer reservation and one foreground operation over every domain it touches.
Nested helpers reuse that owner. Independent `Promise.all` owners are not
created. Custom Values are SET in order and SAVEd once per channel after the last
SET. Macro failure does not start the later stages. Partial failure stops
remaining steps, dirties affected domains, and requests one reconciliation on
the same generation. UI success waits for every stage.

A write that replaces every macro (`replaceMacros`, used by layout import) needs
only the macro count, so it does not pull the lazy MACRO buffer first. A write
rebuilt from the macros on screen (`saveMacros`) needs them read. Whatever needs
the contents asks through one store operation (`ensureMacroContents`), not a
pane-local rule; the operations that read or write a layout file live in
`src/store/layoutFileThunks.ts`, so the pane holds no State Sync knowledge.

### Continuous-control write ownership

Only controls with an explicit completion lifecycle may hold a multi-SET
interaction reservation and defer SAVE to the interaction boundary. Pending
ownership is scoped to path/generation, not component-local state; device switch
may finish the previous still-valid generation, while disconnect or generation
replacement cancels that ownership and leaves capable CONFIG dirty. Controls
without a reliable completion boundary remain discrete, and no trailing timer or
maximum-drag SAVE is invented. The one timer guards a lost completion: an entry
still waiting after several idle seconds with no pointer pressed is completed
once, so a control that drops its completion cannot stall every later write on
its path. The exact control set and event plumbing are owned
by `src/utils/continuous-hid-transaction.ts` and its UI call sites; integration
counterexamples live in `tests/state-sync-transport.test.ts`.

The lock-free interval between the end-revision response and Redux commit does
not extend the meaning of the snapshot: it was consistent at the end query, and
a later change is discovered by the next eligible reconciliation.

## Lifecycle boundary and convergence

Selection, visibility, and reconnect wiring is source-owned by
`src/components/state-sync-runtime.tsx`, `src/store/devicesSlice.ts`, and the
State Sync thunks. Those transitions must enforce the freshness and generation
rules above; they do not establish a firmware subscription state machine or a
second value protocol. Official VIA clients therefore receive no advanced
unsolicited State Sync traffic.

A reboot is safely distinguished when USB disconnect/re-enumeration replaces the
connection generation. An in-place silent reset that the host cannot observe is
a remaining counterexample if its revision values alias the prior generation.
No boot/session token is added to this envelope until that path is measured.

For a supported domain `d`, eventual convergence depends on five durable
premises: a semantic firmware change advances `R_d` only after existing GET can
return the new `S_d`; eligible reconciliation is retried; the state eventually
stops changing; comparable queries do not alias a full revision wrap; and an
uncertain connection boundary never reuses an accepted snapshot from the prior
generation. Under those premises, a stable revision bracket installs the final
`S_d`; transient query/GET failure stays dirty and retryable. Missing firmware
revision hooks cannot be repaired by host events or acknowledgements.

The remaining semantic counterexamples are deliberately explicit: a legacy
v1-only device can lose its final `0x16` invalidation hint until a later hint or
lifecycle reload, a full revision wrap can alias equality between polls, and an
in-place silent reset can evade a generation boundary. Duplicate/reordered hints
do not become value authority because existing VIA GET remains authoritative.
Executable reconnect, device-switch, refresh-race, hidden/resume, and legacy
late-reply cases belong to `tests/state-sync-transport.test.ts` and
`tests/transport-phase1.test.ts`, not to a duplicate case ledger here.

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
- **QMK VIA protocol 13:** it gives GET keyboard-value `0x06` to
  `id_keycodes_version`, which official VIA and this app read from protocol-13
  devices only. ERA firmware stays at protocol 12, so selector `0x06` never
  meets that read. Before ERA firmware adopts protocol 13 or merges QMK code
  carrying it, State Sync and H7S diagnostics (`0x07`) move to new selectors;
  the app then probes the new selector first and keeps `0x06` for shipped
  firmware.

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
- `tests/transport-phase1.test.ts` owns per-path FIFO/reservation lifetime,
  timeout poisoning, disconnect/replacement cancellation, and late legacy reply
  isolation.
- `tests/state-sync-transport.test.ts` owns runtime capability gating,
  revision-bracketed refresh, selection/reconnect freshness, and UI write
  authority.
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

## MOUSE precision

V261004R1 stores integer report counts and real millisecond ramp durations.
Custom VIA offers one local **Advanced settings** switch at the bottom of MOUSE;
it changes presentation only, never SET/SAVE or drafts. Stock VIA retains the
six basic dropdown controls. A read projects to the nearest preset without
changing stored precision; ties choose the lower preset. Wheel acceleration
projects zero ramp to Off, otherwise the nearest Mild/Strong target count,
ignoring duration for this classification. Choosing a preset writes that preset.

The existing V3 Custom Value channel is QMK 13 / H7S 17. IDs 1–6 keep their
legacy byte payloads. ID 7 is read-only capability: payload `E4 01`. IDs 8–14
carry BE16; GET adds `E4` after the two value bytes:

| ID | Value | Integer range |
| --- | --- | --- |
| 8 | Cursor start report count | 1–127 |
| 9 | Cursor target report count | 1–127 |
| 10 | Cursor ramp ms | 0–65535 |
| 11 | Cursor interval ms | 1–255 |
| 12 | Wheel interval ms | 1–255 |
| 13 | Wheel target report count | 1–127 |
| 14 | Wheel ramp ms | 0–65535 |

Zero ramp uses constant start count (wheel: one step). A smaller target than
start ramps down. Counts are HID report units, not guaranteed screen pixels;
OS pointer/scroll processing still applies. Ramps use elapsed time from the
first held direction, independently for cursor and wheel. Adding an axis does
not restart a ramp; releasing the last direction or clearing starts the next
press fresh. Existing cadence, diagonal correction and acceleration keys remain.

Probe support on the current connection before querying exact fields. Only
unhandled or an all-zero legacy H7S reply means unsupported. Timeout, malformed
and disconnect remain errors. Once advertised, exact fields are required CONFIG
values, subject to the existing device/definition/generation candidate lifetime.
The date version is not a capability. Invalid exact SET is unhandled and leaves
runtime/storage unchanged. SET changes runtime; SAVE acknowledges persistence.
A failed SAVE remains retryable even if a GET already equals the draft.

MOUSE v2 remains 16 bytes with version at byte 10 and signature at byte 12.
V261004R1 changes both global EEPROM reset keys: the first boot from an older
storage identity resets **all** keymaps, macros and settings. Back up first;
backup formats do not necessarily contain every feature. No v1 migration is
performed. Split units must use matching firmware, as required by the existing
storage contract.
