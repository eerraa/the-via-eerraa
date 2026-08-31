# 0002 — H7S USB delivery diagnostics contract

Status: Accepted
Genre: contract
Canonical for: selector `0x07` wire, instrumentation bounds, normalization basis, host
persistence and comparison validity — which axes remain comparable across diagnostic runs —
the product boundary, and session lifecycle

This ADR holds wire, instrumentation, and comparison validity. Screen layout and copy
are [ADR 0003](0003-era-menu-help-ui.md).

## Context

Shipped H7S firmware used to turn SOF spacing into a heuristic score and then
downgrade 8K → 4K → 2K → FS, rewrite EEPROM BootMode, and reset. That path is
retired (`eerraa-qmk-h7s-fw/docs/contract_usb.md` §4). Firmware default is FS 1K;
faster polling modes are a user BootMode choice. This host does not reverse it.
SOF arrival is not HID report delivery.

Diagnostics `exchange` on the existing per-path WebHID serial queue, tagged
matcher, and connection-generation invalidation (`src/utils/keyboard-api.ts`,
`src/shims/node-hid.ts`). Visualization is SVG/CSS in
`src/components/panes/diagnostics-results.tsx`; `package.json` has no chart
package.

## Product boundary

Re-measured from this host. Firmware-side 0x07 observation bounds are
`eerraa-qmk-h7s-fw/docs/contract_usb.md` (0x07 product boundary). Policy
matches; the byte envelope is the Wire contract section below, not copied from
that file.

The user changes mode with the existing BootMode controls
(`id_qmk_usb_bootmode` / `id_qmk_usb_bootmode_apply`, channel 13), reboots, and
runs a separate 10 / 30 / 60 s test. `startUsbDiagnostics` SETs duration only
(`ERA_USB_DIAGNOSTICS_DURATIONS`). START OK reports polling mode and expected
interval; this host never SETs BootMode on selector `0x07`.
`src/utils/era-usb-diagnostics.ts` does not import `src/utils/era-state-sync.ts`.
No file under `src/store` sends selector `0x07`.

Firmware session state and always-on counters are RAM-only (H7S). This host
keeps long-term history in `localStorage` only
(`src/utils/usb-diagnostics-history.ts`).

Selector probe runs only when `shouldProbeUsbDiagnostics` is true: effective
source `era` and canonical metadata `usbDiagnostics: true`
(`src/utils/era-advanced-metadata.ts`). That is the five H7S definitions
(`config/era-definitions.manifest.json`). Otherwise
`UsbDiagnosticsSection` returns null and does not call
`getUsbDiagnosticsCapabilities`. Ordinary, official, and upload definitions
never get the packet. The block also requires a submenu that owns
`id_qmk_usb_bootmode` (`src/components/panes/configure-panes/custom/menu-generator.tsx`;
`tests/custom-menu-pane.test.tsx`).

> **REFUSED:** automatic downgrade, an automatic mode benchmark, EEPROM
> diagnostic history, a synthetic stability score, or coupling selector `0x07`
> to polling-mode apply/reset or State Sync recovery.
> **WHY:** mode choice is always the user's (BootMode Apply is a separate
> custom-menu SET), SOF-interval heuristics are not HID delivery, and
> observation that changes the control plane, EEPROM, or recovery contaminates
> what it measures.
> **REOPENS:** none. If more observation is needed, widen the read-only `0x07`
> session.

## Instrumentation

Always-on counters and on-demand HID / loop / histogram / timeline capture are
firmware (`eerraa-qmk-h7s-fw/docs/contract_usb.md`). This host only reads them
through the snapshot chunks in the Wire contract.

Histogram quantiles are the **upper bound of the hit bucket**, not a raw
percentile (`estimateHistogramQuantile` in
`src/utils/usb-diagnostics-history.ts`; `USB_DIAGNOSTICS_BUCKETS` 0.5 / 0.75 /
1 / 1.25 / 1.5 / 2 / 4 / > 4). `buildUsbDiagnosticsTrend` in
`src/components/panes/diagnostics-results.tsx` takes the histogram delta between
consecutive accepted snapshots as an ~1 s window p99 bound. Firmware window
maximum is plotted only when `sequence` is contiguous; a skipped read drops
that point's window maximum rather than mixing two windows.

While a session is running, the page polls SNAPSHOT at
`clamp(recommendedSnapshotMs, 500, 2000)` ms
(`src/components/panes/configure-panes/custom/usb-diagnostics-section.tsx`).
Capability fixtures and the H7S encoder send 1000.

> **REFUSED:** SOF high-resolution instrumentation, and a matrix timing probe
> on this session contract.
> **WHY:** this host has no `0x07` operation for either; SOF is not HID
> delivery and would recreate the retired heuristic; matrix timing is a
> separate firmware compile flag.
> **REOPENS:** none.

## Wire contract

Re-measured from `src/utils/era-usb-diagnostics.ts` and
`tests/era-usb-diagnostics.test.ts`. Existing `GET_KEYBOARD_VALUE`
(`ERA_USB_DIAGNOSTICS_COMMAND_GET` `0x02`) /
`SET_KEYBOARD_VALUE` (`ERA_USB_DIAGNOSTICS_COMMAND_SET` `0x03`) + selector
`ERA_USB_DIAGNOSTICS_SELECTOR` `0x07`. Protocol
`ERA_USB_DIAGNOSTICS_PROTOCOL_VERSION` `0x01`. Layout is the 32-byte VIA
payload with WebHID report id `0` stripped (`ERA_USB_DIAGNOSTICS_PACKET_SIZE`).
Integers are big-endian.

This selector is not `APICommand.CUSTOM_MENU_SET_VALUE` `0x07`. Diagnostics
rides on keyboard-value GET/SET; custom-menu SET is a different command.

The host encodes with `encodeUsbDiagnosticsRequest`, prepends report id `0`,
and matches on length 32, command (`0x02`/`0x03` or `0xFF`), selector, and
echoed tag. Per-path tag is incrementing BE16, skip 0 on wrap. Reserved
request bytes `9..31` are 0.

> **REFUSED:** an unsolicited `0x07` producer, or a second packet length.
> **WHY:** this host only `exchange`s a tagged 32-byte GET/SET
> (`src/utils/era-usb-diagnostics.ts`); `0xFF` is `unhandled`, and any other
> length fails the matcher / `parseHeader`.
> **REOPENS:** a new protocol version, approved separately.

### Request

|    Byte | Field |
| ------: | ----- |
|     `0` | GET `0x02` or SET `0x03` |
|     `1` | `0x07` |
|     `2` | `0x01` |
|     `3` | operation |
|  `4..5` | host tag, BE16 |
|     `6` | argument: START duration seconds, or SNAPSHOT chunk index; else 0 |
|  `7..8` | snapshot sequence, BE16; chunk 0 GET sends 0 |
| `9..31` | `0` |

| Operation | Id | Command |
| --------- | -- | ------- |
| capabilities | `ERA_USB_DIAGNOSTICS_OPERATION_CAPABILITIES` `0x00` | GET |
| snapshot | `ERA_USB_DIAGNOSTICS_OPERATION_SNAPSHOT` `0x01` | GET |
| start | `ERA_USB_DIAGNOSTICS_OPERATION_START` `0x10` | SET |
| stop | `ERA_USB_DIAGNOSTICS_OPERATION_STOP` `0x11` | SET |
| clear | `ERA_USB_DIAGNOSTICS_OPERATION_CLEAR` `0x12` | SET |

START argument is one of `ERA_USB_DIAGNOSTICS_DURATIONS`: 10, 30, 60.

### Response

|     Byte | Field |
| -------: | ----- |
|      `0` | echoed command |
|      `1` | `0x07` |
|      `2` | `0x01` |
|      `3` | echoed operation |
|   `4..5` | echoed tag, BE16 |
|      `6` | status |
|      `7` | state: idle 0, running 1, complete 2, stopped 3 |
|   `8..9` | session ID, BE16; none is 0 |
| `10..11` | frozen snapshot sequence, BE16 |
|     `12` | chunk index |
|     `13` | chunk count |
| `14..31` | 18 B operation payload |

`parseHeader` requires length 32, selector `0x07`, version `0x01`, echoed
operation and tag, state `0..3`, and status `≤ 5`. Status `> 5`, a state
outside `0..3`, or a length other than 32 is not this packet (`malformed`).
Command `0xFF` is `unhandled`, not a status code.

| Status | Id |
| ------ | -- |
| OK | `ERA_USB_DIAGNOSTICS_STATUS_OK` `0x00` |
| unsupported version | `ERA_USB_DIAGNOSTICS_STATUS_UNSUPPORTED_VERSION` `0x01` |
| invalid | `ERA_USB_DIAGNOSTICS_STATUS_INVALID` `0x02` |
| busy | `ERA_USB_DIAGNOSTICS_STATUS_BUSY` `0x03` |
| no session | `ERA_USB_DIAGNOSTICS_STATUS_NO_SESSION` `0x04` |
| stale snapshot | `ERA_USB_DIAGNOSTICS_STATUS_STALE_SNAPSHOT` `0x05` |

OK continues into the payload parser. Stale snapshot is kind `stale`. The
other defined codes are kind `status`.

Capabilities, START, STOP, and CLEAR require sequence 0, chunk index 0, and
chunk count 0.

### Capabilities payload

Packet byte 14 is payload byte 0. Host requires every bit of
`ERA_USB_DIAGNOSTICS_REQUIRED_CAPABILITIES` `0x1f`. Extra flag bits are
allowed. Duration mask bits outside `ERA_USB_DIAGNOSTICS_DURATION_MASK`
`0x07` fail parse. Mask bits 0, 1, 2 map to 10, 30, 60 seconds.

| Payload byte | Field |
| -----------: | ----- |
|          `0` | flags: report timing `0x01`, histogram `0x02`, firmware timing `0x04`, timeline `0x08`, boot counters `0x10` |
|          `1` | duration mask |
|          `2` | histogram buckets; host requires `ERA_USB_DIAGNOSTICS_HISTOGRAM_BUCKETS` 8 |
|          `3` | timeline capacity; host requires `ERA_USB_DIAGNOSTICS_TIMELINE_CAPACITY` 8 |
|       `4..5` | recommended snapshot interval ms, BE16; host requires nonzero (capability fixture and H7S encoder send 1000) |
|          `6` | endian; host requires 1 (big) |
|          `7` | time unit; host requires 1 (microseconds) |
|          `8` | firmware version length; host requires 1–9 |
|     `9..17` | ASCII `0x20..0x7e` of that length, then 0 |

### START / STOP / CLEAR payload

START OK: packet `14` duration (10 / 30 / 60), `15` polling mode `0..3`,
`16..19` expected interval µs BE32 nonzero, `20..31` 0.

STOP and CLEAR: packet `14..31` 0.

### Snapshot chunks

`getUsbDiagnosticsSnapshot` GETs chunk 0 with argument 0 and sequence 0.
Host requires response chunk index 0, sequence ≠ 0, and chunk count in
`ERA_USB_DIAGNOSTICS_BASE_CHUNKS` 8 .. `ERA_USB_DIAGNOSTICS_MAX_CHUNKS` 12.
It then GETs each later chunk with argument = index and sequence = that
frozen sequence, one in flight. Identity (state / session / sequence /
index / count) that changes mid-read is `malformed`. Stale snapshot aborts
that read as kind `stale`.

Parse also requires snapshot state ≠ idle (0), session ID ≠ 0, event count
`≤ 8`, and `chunkCount === 8 + ceil(eventCount / 2)`. Event type is `1..6`.
Odd last event: packet bytes `23..31` of that chunk are 0. Chunks 2, 3, 5, 6:
packet `30..31` are 0. Chunk 7: packet `26..31` are 0.

| Chunk | 18 B payload (packet `14..31`) |
| ----: | ------------------------------ |
|   `0` | mode U8, speed U8, duration U8, event count U8, elapsed ms U32, expected interval µs U32, report samples U32, histogram buckets U8, timeline capacity U8 |
|   `1` | latency min / average / max / window max U32×4, queue peak U16 |
| `2..3` | histogram U32×4 each |
|   `4` | loop samples / max / window max / stall count U32×4, stall threshold U16 |
|   `5` | boot drops / resets / configurations / suspends U32×4 |
|   `6` | boot speed changes, session drops / resets / configurations U32×4 |
|   `7` | session suspends / speed changes / timeline overwrites U32×3, then 0 |
| `8..11` | two events each: type U8 + relative ms U32 + value U32 |

Chunk 0 mode is `0..3` (FS 1K / HS 2K / HS 4K / HS 8K). Speed is `0..2`
(Unknown / Full Speed / High Speed). Duration is 10 / 30 / 60. Chunk 0
histogram buckets / timeline capacity must be 8 / 8.

## Normalization basis and negotiated speed

Firmware computes `expectedIntervalUs` from the polling mode at START, not from
the enumerated link speed. Snapshot chunk 0 already carries both mode and
speed. This host judges consistency
(`usbDiagnosticsExpectedSpeed` / `isUsbDiagnosticsSpeedConsistent` in
`src/utils/era-usb-diagnostics.ts`): FS 1K expects Full Speed; HS 2/4/8K
expect High Speed. Speed Unknown (`0`) does not raise a mismatch. A mismatch
(example: HS 8K on a Full Speed hub) leaves raw microseconds and counters
valid; multipliers, quantile bounds, and trend do not describe the selected
mode.

The wire is unchanged. On mismatch the host:

- shows the caveat "Normalized values do not describe this mode" on the result
- puts a WARNING in `Copy Diagnostic Report`
- tags the comparison row `speed mismatch` so its normalized columns are not
  compared with other rows

Numbers stay visible. Mode is not changed
(`tests/diagnostics-pane.test.tsx`, `tests/usb-diagnostics-history.test.ts`).

## Comparison axes are phase-independent

Report release is tied to the firmware debounce **1 ms tick**. The offset
between that tick and the host USB frame is **redrawn every enumeration**.
Hardware: the same firmware and mode moved min/avg FS 166/231 → 512/558 µs
across replugs; FS / HS 2K / HS 4K averages sat near 231/224/232 µs while
normalized values ranked FS best and HS 4K worst (0.23× / 0.45× / 0.93×).
`min` on two runs in one boot is that phase.

The mode comparison table therefore leads with axes that do not include that
offset (`DiagnosticsComparison` in
`src/components/panes/diagnostics-results.tsx`):

| Column | Definition | Why |
| --- | --- | --- |
| `Spread` | (Max − Min) / interval | extra polling intervals waited |
| `Queue` | queue depth peak | transmit wait actually queued |
| `Drops` | session report-queue drop | actual loss |
| `Loop max` | main-loop maximum gap | firmware stalled |

`Avg` / `Max` stay, captioned that they carry a constant offset redrawn on
every replug and are not comparable across runs. Normalized columns (p99
bound, > 2×) stay — they answer whether **that mode stayed inside its own
interval budget**, a different question. Empty comparison copy tells the user
to change polling mode **manually** and run another test.

### Do not put in the same comparison group

- Firmware before versus after per-endpoint IN busy isolation. Isolation lets
  keyboard and EXK fly at once and lowers delivery-latency and queue-depth
  baselines. This host groups only on VPID + firmware version + protocol
  version; a firmware bump is what splits those groups.
- Loop timing from the retired top-level diagnostics page versus the present
  inline block under `USB POLLING`. The latter shares the per-path serial
  queue with the State Sync 500 ms poll ([ADR 0003](0003-era-menu-help-ui.md)
  §1).

## Host persistence and comparison

Local storage key `era.usbDiagnostics.history.v1`, envelope `schemaVersion` 1
(`USB_DIAGNOSTICS_HISTORY_KEY` /
`USB_DIAGNOSTICS_HISTORY_SCHEMA_VERSION`). Each run stores VPID, product
name, firmware version, diagnostics protocol, mode/speed, duration, start/end
ISO timestamps, `complete` / `stopped` / `aborted` outcome, optional abort
reason, and at most `USB_DIAGNOSTICS_HISTORY_POINT_LIMIT` (65) snapshots.
At most `USB_DIAGNOSTICS_HISTORY_LIMIT` (24) runs. Corrupt or unknown-schema
records are ignored. Device path and raw HID identifiers are not stored.

`getComparableUsbDiagnosticsRuns` drops aborted runs and keeps only matching
**VPID + firmware version + protocol version**. The table shows the latest
non-aborted run per mode among that set.

When live snapshots are empty and the view falls back to a stored run, the
caveat "Previously stored result — not this session" names mode, duration,
outcome, and timestamp. Silent fallback used to show an unmatched-session
banner next to a previous run's "State: Complete", and Copy followed that
previous run. Copy now follows the run on screen
(`recoveredRun ?? currentRun ?? comparableRuns[0]`).

## Failure and lifecycle

- Unhandled `0xFF` or unsupported-version status is graceful unsupported UI
  (`capabilityState === 'unsupported'`). Ordinary devices never probe.
- Every request uses the existing per-path WebHID queue with
  `timeoutBehavior: 'preserve-generation'`.
- Snapshot poll: `stale` resets the failure streak and continues. Timeout,
  malformed, unhandled, and non-OK status increment it. Disconnect, or three
  consecutive counted failures, abort the session and save a partial run if
  any snapshot was captured (`createUsbDiagnosticsRun` needs at least one).
- Page, device, or connection-generation change cancels the polling owner and,
  if the generation is still current, queues STOP. The cleanup then saves any
  partial snapshots as aborted and clears `activeRef`, so Start is not left
  locked when only the generation changed.
- A leftover **running** firmware session (`sessionState === 1`) is not
  attached to history. The user stops it, then starts a new test.
- STOP of a session this page owns reads one final coherent snapshot. STOP of
  a session this page did not start does not. CLEAR is refused while
  `activeRef` is set; it zeros the device RAM session and does not clear
  local history or boot counters.

### Finished sessions are read back from the keyboard

A sleep or reload can leave no page-side record while firmware still holds
complete (`2`) / stopped (`3`) until CLEAR or the next START.
`handleReadDeviceResult` reads that snapshot for display and Copy.

- **Not written to local history.** The page does not know the real start
  time; a history entry must keep a known start time and identity. The Copy
  helper may synthesize an approximate `startedAt` from `elapsedMs` and must
  not call `saveUsbDiagnosticsRun`.
- The label says the result was read from the keyboard, not from a test this
  page ran.
- `Copy Diagnostic Report` follows the run on screen.

## State Sync opt-in coupling

The five H7S definitions also have `stateSync: true`. This host probes
selector `0x06` first. When that probe ends `unverified`,
`getCustomMenuAvailabilityForDevice()` replaces the whole Custom pane
(`src/store/menusSlice.ts`,
`src/components/panes/configure-panes/custom/menu-generator.tsx`). `USB POLLING`
is not rendered, so the diagnostics block inside it disappears.

The two selector opt-in gates are independent. The screen path is not. Missing
diagnostics on H7S: check `0x06` capability first. Wire coupling of `0x07` to
State Sync recovery remains refused above.

## Consequences

Diagnostics OFF on firmware has no SOF timestamp and no scan-level probe;
always-on counters increment on hard events. ON adds session-active timer
reads at report request/completion and this host's ~1 Hz multi-chunk SNAPSHOT
GET while a test runs. No raw 8 kHz sample stream, heap, firmware history
buffer, or EEPROM write.

This app adds no chart dependency. SVG/CSS uses VIA theme variables.
Placement, copy, and observation wording are [ADR 0003](0003-era-menu-help-ui.md).

## Verification

This repo:

- exact request, capability, sequential chunk read, stale/malformed,
  unsupported/timeout/disconnect, SET control —
  `tests/era-usb-diagnostics.test.ts`
- history schema / corruption / bounds / identity grouping / aborted
  exclusion / report text — `tests/usb-diagnostics-history.test.ts`
- result render, no synthetic score, speed-mismatch caveat, stored-run
  label, phase-independent Spread — `tests/diagnostics-pane.test.tsx`
- inline placement and opt-in / official-source gate —
  `tests/custom-menu-pane.test.tsx`
- observation keys with no verdict wording — `tests/locales.test.ts`
  `DIAGNOSTIC_OBSERVATION_KEYS`

`test:p1` includes the history and locale files. `test:transport` includes the
wire, pane, and custom-menu files.

Peer firmware (not this runner): H7S host tests and absence of the retired
monitor/downgrade/reset/EEPROM symbols, as named from
`eerraa-qmk-h7s-fw/docs/contract_usb.md`.

Automated build and host fixtures do not replace hardware. FS 1K and HS
2/4/8K still need diagnostics off/on keyboard interval, queue drop, and VIA
response latency compared across host controllers, hubs, and cables.
