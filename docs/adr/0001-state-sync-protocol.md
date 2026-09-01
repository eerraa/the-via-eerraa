# 0001 — State Sync revision validation protocol

Status: Accepted
Genre: contract
Canonical for: selector `0x06` envelope v1, three host domains and revision-bracketed
refresh, per-path transport reservation, foreground mutation epoch, CONFIG write
authority and UI continuity, exact macro·import·continuous-control transaction,
exact-ms rules, and the refused alternatives checked against this repo

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

## Context

Ordinary VIA reads device values into Redux and, on connect, commits per-layer
keymap as each GET returns (`loadKeymapFromDevice` / `loadLayerSuccess` in
`src/store/keymapSlice.ts`). Firmware-internal writes, another host's writes, and
a split peer's durable apply do not invalidate a cache that this host already
treats as complete. The field failure on TOMAK79H:

```text
Left keymap change
  -> existing split storage durable-applies on Right
  -> Right app cache stays complete
  -> selecting Right skips keymap GET
  -> stale keymap until F5
```

The goal is automatic convergence on the value existing VIA GET returns, not
exactly-once delivery of intermediate events. Ordinary VIA definitions and
command transcripts, the official VIA client, and existing `0x16` v1 Custom Menu
grammar remain equal final conditions.

Pre-implementation coordinator defects (the opposite behavior is locked by
`tests/state-sync-transport.test.ts`, describe `State Sync freshness coordinator
regressions`):

- copying all three tokens from one query into accepted cache, so a CONFIG change
  seen during KEYMAP refresh was swallowed without a CONFIG GET
- attaching a probe revision to the stale lifecycle snapshot and marking it fresh
- permanently demoting a capable generation on one timeout/malformed
- skipping a dirty domain on the next poll because observed numbers still matched
- patching Redux from keymap layer/encoder, macro, or layout/menu reads before the
  end-revision bracket
- poll and lifecycle full refresh using separate in-flight sets for the same
  path/generation/domain

Freshness is therefore a VIA core problem of transport generation,
observed/accepted revision, and candidate commit — not a UI exception.

## Decision and rationale

The adopted host mechanism is polling-first revision validation with no
unsolicited State Sync events. `shouldPoll` in `src/store/stateSyncThunks.ts`
requires selected, ready, Configure-visible (`location === '/'` in
`src/components/state-sync-runtime.tsx`), not `document.hidden`, and
`capability === 'capable'`. The interval is `ERA_STATE_SYNC_POLL_INTERVAL_MS`
(500). Changed domains are re-read with existing VIA GET under a start/end
revision bracket (`refreshDomain`). An initial capable ERA selection is
progressive rather than a second lifecycle full read: KEYMAP is bracketed before
`markDeviceReady`, CONFIG is prefetched immediately after ready, and the first
full MACRO payload read is lazy until the Macro pane requests it. Existing VIA
GET remains the value path in every case. Later lifecycle boundaries that use
`coordinate` mode `full` do not trust revision equality. `0x16` v1 remains a
Custom Menu invalidation hint (`handleUISyncRequest`); it is not the sole
correctness basis.

> **REFUSED:** unsolicited semantic events, event-only sync, host nonce, ARM/lease,
> event sequence, descriptor queue / coalescing / overflow, and an H7S
> unsolicited-event TX dispatcher.
> **WHY:** this host's only unsolicited grammar is strict `0x16` v1
> (`src/utils/ui-sync.ts`); State Sync is a tagged `GET_KEYBOARD_VALUE` `0x02` /
> selector `0x06` query (`src/utils/era-state-sync.ts`), so a lost last event
> would still need the 500 ms revision poll, and an unsolicited advanced packet
> would reach an official VIA client.
> **REOPENS:** a later ADR if that poll interval and CONFIG refresh cost fail
> acceptance; any event then stays a hint.

> **REFUSED:** a new top-level VIA command for State Sync.
> **WHY:** `ERA_STATE_SYNC_COMMAND` is `0x02`; `APICommand` in
> `src/utils/keyboard-api.ts` has no id past the existing `0x01..0x16` set, and
> this host never sends `UI_SYNC_REQUEST`.
> **REOPENS:** never.

> **REFUSED:** range or cell hints that partial-GET a domain.
> **WHY:** `readKeymapStateSyncCandidate` in `src/store/keymapSlice.ts` reads
> every layer and encoder; `StateSyncDomain` is only `keymap` | `macro` |
> `config`; `0x16` v1 command targeting is the kept Custom Menu hint, not a
> keymap range grammar.
> **REOPENS:** after domain refresh cost is measured, in a new ADR.

> **REFUSED:** a single global revision token.
> **WHY:** the v1 envelope carries three BE32 tokens and `parseStateSyncEnvelope`
> treats any mask other than `0x07` as not capable (`src/utils/era-state-sync.ts`).
> **REOPENS:** a new envelope version, approved separately.

> **REFUSED:** a selected-layer provisional Redux patch on State Sync refresh.
> **WHY:** `commitStableKeymapCandidate` writes every layer and encoder in one
> action; `readKeymapStateSyncCandidate` does not dispatch `loadLayerSuccess`.
> Ordinary/non-opt-in and unverified connect still uses `loadKeymapFromDevice`
> per layer. A capable ERA initial selection instead commits one whole stable
> KEYMAP candidate before ready; it does not expose provisional layers.
> **REOPENS:** never.

> **REFUSED:** an ACK journal, a firmware subscription state machine, and an extra
> snapshot or value protocol beside existing VIA GET.
> **WHY:** accepted cache moves only through revision-bracketed existing GET in
> `src/store/stateSyncThunks.ts`; selector `0x07` snapshot chunks are USB
> diagnostics ([ADR 0002](0002-h7s-usb-diagnostics.md)), not keyboard-state
> authority.
> **REOPENS:** a new ADR after measured poll latency or refresh cost shows a
> concrete failure.

> **REFUSED:** exposing raw EEPROM addresses on the host protocol.
> **WHY:** this host addresses values as VIA channel/value ids and standard
> commands; State Sync bytes 8–19 are RAM equality tokens
> (`src/utils/era-state-sync.ts`), and `EEPROM_RESET` `0x0a` is the existing wipe
> command, not an address space.
> **REOPENS:** never.

> **REFUSED:** extending `UI_SYNC_REQUEST` `0x16` to bidirectional v2, or treating
> it as State Sync correctness.
> **WHY:** `parseUISyncRequest` accepts only version `0x01` and a 32-byte payload
> (`src/utils/ui-sync.ts`); version `0x02` is undefined, and this host never
> sends `0x16`.
> **REOPENS:** never. Keep the existing unsolicited v1 grammar.

> **REFUSED:** a new split exact-range transport.
> **WHY:** exact-ms uses existing `CUSTOM_MENU_SET_VALUE` /
> `CUSTOM_MENU_GET_VALUE` (`0x07` / `0x08`) as a 2-byte BE uint16
> (`src/utils/era-exact-ms.ts`); there is no split-range command in `APICommand`.
> **REOPENS:** never.

> **REFUSED:** rewriting Redux to carry this contract.
> **WHY:** `src/store/index.ts` still uses the existing slices plus
> `stateSyncSlice`; isolation is explicit path and generation on thunks.
> **REOPENS:** when VIA core actually blocks correctness or maintainability.

> **REFUSED:** putting an unmeasured five-second visible-event watchdog or a
> 15-second ARM lease on this protocol.
> **WHY:** no lease or event-watchdog symbol exists; periodic query is
> `ERA_STATE_SYNC_POLL_INTERVAL_MS` (500). The 5000 ms values in
> `src/shims/node-hid.ts` and `src/utils/keyboard-api.ts` are the existing HID
> request timeout and the macro marker deadline, not event/lease constants.
> **REOPENS:** a later ADR that cites measured timeout or rate values.

## Mechanism verdicts and five-question review

Refused mechanisms are the REFUSED three-liners above. The table keeps only what
this host kept or simplified. Each row answers the five required questions.
Now/later is whether the mechanism is required now or waits on measurement. The
last column is final convergence under loss or duplication.

| Mechanism | Verdict | 1. Field failure it addresses | 2. Why existing GET/lifecycle alone is not enough | 3. Now / later | 4. Extra state | 5. Convergence under loss/duplication |
| --- | --- | --- | --- | --- | --- | --- |
| Canonical definition/build metadata opt-in | **Keep** | Stops extension probes on ordinary keyboards and arbitrary sideload JSON. | GET must already be on the wire before the host knows the device is safe to probe. | Required now. | App build: opt-in boolean and generated trusted identity list (`config/era-definitions.manifest.json` → `era_advanced.json`). No firmware state. | Without opt-in there is no advanced path; ordinary VIA remains. |
| Runtime capability confirmation | **Simplified** | Confirms, per connection generation, that an opt-in ERA VPID actually answers State Sync. | Build metadata does not prove the flashed image; silence alone does not tell old firmware from a comms error. | No separate CAPABILITIES command. The first well-formed capable revision query is confirmation (`probeStateSyncForDevice`). | One value per generation: `unknown \| probing \| unverified \| capable`. | Initial unhandled/malformed/timeout on a new generation is `unverified` and blocks Custom I/O. Once `capable`, a transient failure leaves capability and marks freshness dirty. |
| New read-only selector on existing `GET_KEYBOARD_VALUE` (`0x02`) | **Keep** | One small request/response for capability and domain revisions. | GET-everything every poll would reread large keymap/macro buffers. | The only adopted wire extension. | Firmware: three RAM tokens. App: observed/accepted tokens. | Query failure leaves cache dirty. The next visible poll or lifecycle refresh retries. |
| 16-bit request tag (inside the new selector) | **Keep** | Stops a late query response after timeout from resolving a newer query. | Echoed command prefix cannot tell query generations apart. | Required now. | App: per-path incrementing tag (`nextStateSyncTag` in `src/utils/era-state-sync.ts`), skip 0 on wrap. Firmware echoes bytes 4–5. | Unmatched/late tags fail the pending matcher and drop. The tags `Map` is not cleared on generation change (only `resetStateSyncTagsForTesting`). Wrap-around alias after 65534 queries on the same path without reconnect is remaining. |
| Visible-event watchdog | **Simplified** | Finds a lost last event and firmware-originated change on the selected device. | Lifecycle full read does not observe change during the same visible session. | Adopted as the 500 ms revision poll on an eligible connection, not an event watchdog. | One app timer (`syncPolling`) and a path/generation coordinator owner. No firmware timer. | Each poll reads current tokens; there is no event to lose. A failed poll does not extend fresh. |
| Four domains (`KEYMAP`, `MACRO`, `CUSTOM_MENU`, `KEYBOARD`) | **Simplified** | Isolates different read costs. | One global token rereads large keymap and macro on a small config change. No measurement requires splitting `CUSTOM_MENU` from `KEYBOARD`. | Start with three host domains; CONFIG cost is remaining measurement. | Three counters/caches, not four. No `KEYBOARD` adapter. | Each domain is an independent equality token and converges by final GET. |
| Per-device transport ownership and connection generation | **Keep** | Stops A/B device traffic, old listeners, and late async completion from poisoning each other's cache/response. | Sending more GETs enlarges global timestamp and selected-coupling races. | Implemented core correction. | Per-path listener, serialized queue, pending matcher, write timestamp, generation (`src/shims/node-hid.ts`). | Disconnect and untagged legacy timeout discard the generation. Tagged State Sync timeout ends that request only and marks freshness dirty. |
| Legacy command timeout poisoning | **Keep** | Stops a late previous response from matching a retry of the same untagged legacy command. | Two responses with the same prefix cannot be told apart by the app. | Required now. | Timeout of a WebHID session is terminal for that generation (`poison-generation`). | No automatic retry on the same generation until `close`/`open` flushing the USB pipe is proven on browser and hardware. Reconnect then full-refreshes. |
| Revision-bracketed refresh and atomic cache commit | **Keep** | Stops a torn multi-packet GET from being accepted as fresh. | A single lifecycle read does not detect a race during the read. | Implemented correctness boundary. | Per-domain observed/accepted revision, `unknown \| dirty \| refreshing \| fresh`, isolated candidate. | Start/end token mismatch discards the candidate and retries up to `ERA_STATE_SYNC_REFRESH_RETRIES` (3). Still churning stays dirty for the next poll. |
| TOMAK post-readback/post-reload revision hook | **Keep** | Stops writing source intent into the target cache, and stops missing the target's actual durable apply. | Source GET does not prove target success. Waiting only for target lifecycle full read delays detection on a selected target. | QMK durable boundary (`qmk_firmware_eerraa/keyboards/era/common/split/era_host_peer_storage.c`). | Existing seven storage domains map to three host domains; token increments after target commit. | No wire notification. Revision query reads the token the target actually incremented. Lifecycle full read is a recovery path, not permission to omit the hook. |

## Consistency and freshness contract

The only authoritative values are those existing VIA GET returns. The new
selector carries no values. It reports which host domain changed, as equality
tokens.

- `observedRevision` is the last token firmware reported on any query
  (`observePathRevisions` in `src/store/stateSyncSlice.ts`). An end query during
  another domain's refresh that shows a new token marks that other domain dirty
  and does not advance its `acceptedRevision`.
- `acceptedRevision` is the revision of an authoritative GET candidate that
  passed the same start/end token and was committed to Redux in one action
  (`acceptStableRevision`).
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

### Initial three host domains

A host domain is a GET-family boundary, not an EEPROM address.

| Bit | Mask | Domain | Authoritative existing reads |
| --: | ---- | ------ | ---------------------------- |
| `0` | `0x01` | `keymap` | `0x11` layer count, `0x12` keymap buffer, `0x14` encoder GET |
| `1` | `0x02` | `macro` | `0x0c` count, `0x0d` size, `0x0e` buffer |
| `2` | `0x04` | `config` | `GET_KEYBOARD_VALUE` + `LAYOUT_OPTIONS` (`0x02`); V3 Custom Value GET `0x08` (menus and per-key RGB) |

CONFIG refresh does not GET `UPTIME` (`0x01`), `SWITCH_MATRIX_STATE` (`0x03`), `FIRMWARE_VERSION` (`0x04`), or `DEVICE_INDICATION` (`0x05`).

Each revision is a 32-bit big-endian RAM equality token. Comparison is equality, not magnitude. Capable requires mask `0x07` and three nonzero tokens. Extra mask bits fail parse. A subset mask or a zero token is not capable.

H7S firmware tokens start at `1` and skip `0` on wrap. A no-op SET does not bump. SAVE of an already-published runtime is not a second bump.

> **REFUSED:** a fourth host domain, extra mask bits, or a later revision slot without raising envelope version.
> **WHY:** the host parser treats bits outside `0x07` as malformed and treats any mask other than `0x07` as not capable.
> **REOPENS:** a new envelope version, approved separately.

## Capability gates

The two gates have different jobs. Both stay.

1. A canonical entry in `config/era-definitions.manifest.json` with
   `stateSync: true`. `scripts/build-keyboards.ts` writes trusted runtime
   metadata to `era_advanced.json`. VIA V3 JSON schema and arbitrary sideload
   JSON do not gain a transport flag.
2. Only a connection whose effective definition source is `'era'`
   (`getDefinitionSourceForDevice`) and whose VPID is opt-in
   (`isStateSyncOptIn`) sends the revision selector. Capability confirmation is
   a capable envelope only: version `0x01`, status `ERA_STATE_SYNC_STATUS_OK`
   (`0x00`), mask `0x07`, echoed tag, reserved bytes 0, three nonzero tokens
   (`isCapableStateSyncEnvelope`).

Probe is not callable from generic device scan, protocol-version check, or
ordinary definition load. Official snapshot or Design upload as effective source
does not probe, even for the same VPID. Non-opt-in fake-device transcripts
without selector `0x06` are an acceptance gate
(`tests/state-sync-transport.test.ts`, `tests/era-state-sync.test.ts`).

An opt-in identity running old firmware may still receive one probe. Stock QMK
`via.c` (both `qmk_firmware_eerraa` and `eerraa-qmk-h7s-fw`) sets `id_unhandled`
(`0xFF`) for an unknown `GET_KEYBOARD_VALUE` selector when `via_command_kb`
returns false. Current QMK with `ERA_VIA_SYSTEM_ENABLE` routes selector `0x06`
through `era_state_sync_via_command` in
`qmk_firmware_eerraa/keyboards/era/common/system/era_via_system.c`. This host
does not distinguish old firmware from a comms error: the first selector query
on a new generation that is unhandled, malformed, or timed out becomes
`unverified` and is not probed again (`probeStateSyncForDevice`). The Custom
pane still exists; `getCustomMenuAvailabilityForDevice` returns `unverified` and
`src/components/panes/configure-panes/custom/menu-generator.tsx` replaces the
whole pane with
`Unable to verify feature support. Reconnect the keyboard. If the problem persists, update to the latest firmware.`
Custom GET/SET/SAVE and per-key RGB I/O require availability `'available'`. The
same errors on an already-capable generation are transient poll failures:
capability stays, freshness goes dirty, the next poll retries. Deployed-image
transcripts remain hardware evidence.

## Accepted 32-byte wire contract

Existing read-only `GET_KEYBOARD_VALUE` (`ERA_STATE_SYNC_COMMAND = 0x02`) + selector `ERA_STATE_SYNC_SELECTOR = 0x06`. Envelope version `ERA_STATE_SYNC_ENVELOPE_VERSION = 0x01`. Layout is the 32-byte VIA payload with WebHID report id `0` stripped. Integers are big-endian. Periodic query interval is `ERA_STATE_SYNC_POLL_INTERVAL_MS = 500` when the device is selected, ready, Configure-visible, not `document.hidden`, and capability is `capable`.

Host `KeyboardValue.KEYCODES_VERSION` is also `0x06`; that GET is protocol ≥ 13 and is a 4-byte version, not this envelope. H7S `id_era_state_sync` is `0x06` and `VIA_PROTOCOL_VERSION` is `0x000C`.

### Request

|    Byte | Meaning |
| ------: | ------- |
|     `0` | `GET_KEYBOARD_VALUE` (`0x02`) |
|     `1` | `0x06` |
|     `2` | `0x01` |
|     `3` | `0` |
|  `4..5` | host request tag, BE16 |
| `6..31` | `0` |

### Response

|     Byte | Meaning |
| -------: | ------- |
|      `0` | `0x02` |
|      `1` | `0x06` |
|      `2` | `0x01` (firmware writes envelope version, not the request version byte) |
|      `3` | status. Capable requires `ERA_STATE_SYNC_STATUS_OK` (`0x00`). Firmware also defines `UNSUPPORTED_VERSION = 0x01`, `INVALID = 0x02` |
|   `4..5` | echoed tag, BE16 |
|      `6` | domain mask; capable requires `0x07` |
|      `7` | `0` |
|  `8..11` | keymap revision, BE32 |
| `12..15` | macro revision, BE32 |
| `16..19` | config revision, BE32 |
| `20..31` | `0` |

`0xFF` is not an envelope.

> **REFUSED:** `BUSY`, extra status codes, a second report shape, or a transaction id on this selector.
> **WHY:** v1 has status `0`/`1`/`2` and one 32-byte layout; a second shape would be another protocol.
> **REOPENS:** a new envelope version, approved separately.

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
Default timeout uses `poison-generation`: that transport generation is terminal,
pending/queued work is rejected, and the same generation is not retried. Whether
`close`/`open` flushes the USB pipe is remaining hardware; fail closed until
then.

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
uninitialised MACRO domain (`acceptedRevision == 0`, no local mutation); entering
the Macro pane requests that first full stock-VIA macro snapshot explicitly.

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

## TOMAK durable peer boundary

`qmk_firmware_eerraa/keyboards/era/common/split/era_host_peer_storage.c` sets
`ERA_HOST_PEER_STORAGE_RUNTIME_FLAG_APPLY_WRITE` around each bounded slice
`eeprom_update_block` so those writes do not bump host revision. After the
slices, pull (`era_host_peer_storage_apply_write_finish`) and push
(`era_host_peer_storage_push_apply_finish`) full-read the domain, compare CRC to
the episode expected value, and on success call
`era_split_eeprom_sync_reload_domain_kb` then
`era_state_sync_note_storage_domain`. Publish/rotation/close after that may
still fail; GET-readable target state has already changed, so the increment
stays. Readback CRC failure does not increment. Deferred abort after
readback/reload success still incremented.

```text
full readback CRC success
  -> runtime reload finished (including keymap/macro no-op)
  -> target host-domain revision increment
  -> remaining split publish/rotation/close
```

The boundary is target GET readability, not split-episode success.
`TRANSFER_VERIFIED` / `APPLY_READY` do not bump the target host token.

`era_state_sync_note_storage_domain` maps seven storage domains onto the three
host domains (keymap, macro, config). No split exact-range transport is added.
There is no wire event, so there is no peer-notification loss on this path. The
app queries the target and reads the token that target incremented. Lifecycle
full refresh can mask a missing hook forever; that is not accepted as
correctness.

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

## Compatibility conclusion

| Target | Conclusion and invariant |
| --- | --- |
| Ordinary VIA keyboard | No canonical opt-in metadata, so no capability selector and no new command. Existing V3 definition load and `0x01..0x15` host transcript must match upstream. |
| ERA opt-in definition + unverifiable firmware | One read-only selector probe. `0xFF` unhandled, malformed, or timeout → `unverified`. No poll and no Custom I/O. Custom pane remains, with the reconnect/update message. |
| Official VIA client + advanced ERA firmware | Firmware sends no unsolicited advanced packet. Official client does not request the new selector, so existing command meaning and responses stay. |
| `0x16` v1 | Packet grammar stays. Capable device: coordinator CONFIG invalidation. Ordinary non-opt-in: existing Custom GET adapter. Unverified opt-in: invalidation only, no I/O. |
| Protocol versions 7–13 | Protocol version is not State Sync capability. Only canonical opt-in plus a capable selector response is. |

A filename search of `qmk_firmware_eerraa` and `eerraa-qmk-h7s-fw` found no
`ui_sync` / `UI_SYNC` emitter or parser. Keeping v1 grammar is an app
compatibility conclusion. Deployed ERA image v1 transcripts, and coexistence
with advanced firmware, remain hardware evidence.

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

### App fake-device and transport tests

`tests/state-sync-transport.test.ts`, `tests/transport-phase1.test.ts`, and
`tests/era-state-sync.test.ts` lock:

1. Non-opt-in ordinary keyboard transcripts have no selector `0x06`.
2. Opt-in old firmware: one tagged `0xFF`, malformed, or initial timeout →
   `unverified`, zero Custom GET/SET/SAVE, late responses do not consume the next
   command.
3. Envelope version, status, tag, mask, reserved bytes, and nonzero big-endian
   revisions.
4. Capability confirmation does not attach its revision to stale lifecycle
   data. The progressive initial path brackets KEYMAP before ready, then CONFIG,
   while macro count metadata does not expose a full MACRO snapshot.
5. A revision for another domain observed during one domain's refresh dirties
   that other domain and does not advance its accepted revision.
6. Capable timeout/malformed keeps capability; dirty domains retry without
   trusting observed equality.
7. Three churning candidates are discarded; a later stable poll bracket
   converges.
8. Keymap layer/encoder, macro, and layout/menu/per-key RGB candidates stay
   private until a stable bracket.
9. Poll and lifecycle full refresh share one path/generation owner; a lifecycle
   request after an in-flight domain forces a reread.
10. Device A/B, selection generation, and reconnect generation are isolated.
    Hidden periodic traffic stays 0. Resume full-refreshes.
11. Strict `0x16` v1 all/channel-command/command-id grammar; Custom pane remains;
    Custom GET/SET/SAVE stay 0 after initial confirmation failure.
12. Logical reservation same-path exclusion, nested direct execution, other-path
    independence, timeout/malformed/disconnect release, generation replacement
    reject of active/waiting work, later queue progress.
13. State Sync bracket and foreground owner do not interleave. Macro/keymap/CONFIG
    mutation epoch rejects a pre-mutation candidate. Other paths and new
    generations are independent.
14. Macro `B=0`/`B=1`, marker boundary, exact GET length/padding, save
    transcript, no-zero-after-failure, bounded marker verification, permanent
    `0xFF` deadline. Delay array `[25, 50, 100, 200]` / cap 250 is in
    `src/utils/keyboard-api.ts`; tests lock deadline and retry count, not those
    millisecond literals.
15. Full import: macro await, failure stop, truthful keymap completion, encoder
    owner reuse, partial-failure reconciliation.
16. Range/color interaction: changed SET, identical-value dedup, one SAVE per
    completion, pointer/touch/keyboard/blur/cancel/unmount wiring, disconnect
    failure, discrete/`DeferredApply`/unknown-control preserved.
17. Consecutive discrete Custom writes keep the pane and run SET/SAVE in order
    during the first reconciliation. Earlier-write failure does not roll back a
    later optimistic value. Equal authoritative readback keeps menu object
    identity. External-only dirty keeps accepted controls and blocks new writes.
    Loading boundary until the first accepted snapshot.
18. A disconnecting discrete SET before SAVE sends neither SAVE nor a
    stale-generation refresh and closes local-write depth. Reconnect generation
    starts a separate progressive reacquisition lifecycle.
19. Progressive capable initial load: macro count metadata issues no macro-buffer
    GET; KEYMAP can reach `fresh` before device ready; the first visible poll
    accepts CONFIG while the uninitialised MACRO payload remains unread; an
    explicit Macro-pane refresh then reads and accepts the stock macro buffer.

`tests/custom-menu-pane.test.tsx` covers State Sync menu continuity.
`tests/deferred-apply.test.ts` covers continuous-control lifecycle wiring. It is
not in `test:p1` / `test:transport` (`tests/docs-contract.test.ts` lists it as
the known unrun file).

### QMK and H7S peer source (not this repo's test runner)

QMK `era_state_sync.c` starts tokens at 1, skips 0 on wrap, maps seven storage
domains onto three host domains, and bumps from `era_state_sync_note_eeprom_span`
or `era_state_sync_note_storage_domain`. Split durable tail is the readback CRC
+ reload + `era_state_sync_note_storage_domain` order in
`era_host_peer_storage.c`. Exact-ms in that tree is
`qmk_firmware_eerraa/tests/era_via_exact_ms`.
H7S single-producer is
`eerraa-qmk-h7s-fw/tools/era_via_host_tests/check_single_producer.py`. H7S
exact-ms host test is
`eerraa-qmk-h7s-fw/tools/era_via_host_tests/test_era_via_exact_ms.c`.

Official VIA + official JSON exact-ms on **this** host: exact GET/SET 137 does
not snap; widening official `options` is refused (exact-ms section above).

> **REFUSED:** claiming `qmk_firmware_eerraa/tests/` contains a State Sync
> envelope host suite, or that an ERA protected local-policy range is verified
> there.
> **WHY:** that `tests/` tree has `era_via_exact_ms` (and other ERA tests); no
> `era_state_sync` test directory. `ERA_STATE_SYNC_TEST` is an ifdef in
> `era_state_sync.c` / `.h` only. No local-policy range test was found.
> **REOPENS:** if that tree adds a host test compiled with `ERA_STATE_SYNC_TEST`.

## Probe targets and what the app shows

This host probes only connections whose effective source is ERA overlay and
whose manifest entry has `stateSync: true`. That is 31 of 32 custom definitions
(`brick65` is the exception — `docs/MAP.md` §2). The five H7S boards are among
the 31.

When probe ends `unverified`, `getCustomMenuAvailabilityForDevice` replaces the
whole Custom pane with the unverified message. Ordinary VIA keymap flow remains.
Custom GET/SET/SAVE and per-key RGB I/O stay blocked for that connection
generation. USB diagnostics render inside the Custom pane, so they disappear
with it ([ADR 0002](0002-h7s-usb-diagnostics.md)).

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
