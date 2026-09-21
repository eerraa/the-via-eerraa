# 0002 — H7S USB delivery diagnostics contract

Status: Accepted
Genre: contract
Canonical for: app-side selector `0x07` acceptance, observation accuracy,
normalization/comparison validity, host persistence, product boundary, and
session lifecycle

The firmware wire envelope and instrumentation safety bound are owned by
`eerraa-qmk-h7s-fw/docs/contract_via.md` §6. This ADR owns what this app may
infer, compare, persist, and control. Screen placement and user-facing wording
are [ADR 0003](0003-era-menu-help-ui.md).

## Product boundary

H7S polling mode is user-owned. The user changes BootMode with the existing
controls, applies/reboots, and runs a separate 10 / 30 / 60 s diagnostic
session. Selector `0x07` may choose only the diagnostic duration; it must not
apply/reset polling mode, write diagnostic history to firmware EEPROM, become
State Sync recovery, or emit a synthetic stability verdict.

SOF arrival is not HID report delivery. Do not restore the retired automatic
downgrade/benchmark path, add a high-resolution SOF stability score, or fold
matrix timing into this session contract. If more observation is needed, extend
the coordinated read-only diagnostic protocol instead of changing the control
plane.

Firmware session/counter state is RAM-only. Long-term history belongs only to
this host's `localStorage`. The firmware-side reasons and the retired recovery
boundary are `eerraa-qmk-h7s-fw/docs/contract_usb.md` §4.

The app may probe diagnostics only for an effective ERA definition that
explicitly opts in through `shouldProbeUsbDiagnostics` in
`src/utils/era-advanced-metadata.ts`. Official, upload, and non-opted-in
definitions must not receive selector `0x07`. The UI also requires the
existing USB polling submenu; current gating is in
`UsbDiagnosticsSection` and the custom-menu tests.

## Wire compatibility

The coordinated v1 contract is GET/SET keyboard value `0x02` / `0x03`,
selector `0x07`, protocol `0x01`, exactly 32 VIA payload bytes, and
big-endian multibyte integers. START duration is exactly 10, 30, or 60 seconds.
The protocol is request/reply only; unsolicited diagnostic packets and a
second packet length are incompatible.

This selector is not Custom Menu SET command `0x07`. Diagnostics travels on
keyboard-value GET/SET and never uses the custom-menu command as its envelope.

The following values are wire ABI and remain explicit here:

| Item | v1 requirement |
| --- | --- |
| Operations | capabilities `0x00` GET; snapshot `0x01` GET; start `0x10` SET; stop `0x11` SET; clear `0x12` SET |
| Status | OK `0x00`; unsupported version `0x01`; invalid `0x02`; busy `0x03`; no session `0x04`; stale snapshot `0x05` |
| Request header | byte 0 command, 1 selector, 2 version, 3 operation, 4..5 BE16 tag, 6 argument, 7..8 BE16 snapshot sequence; 9..31 reserved zero |
| Response header | byte 0 echoed command, 1 selector, 2 version, 3 operation, 4..5 echoed tag, 6 status, 7 state 0..3, 8..9 session id, 10..11 frozen sequence, 12 chunk index, 13 chunk count, 14..31 payload |

Capabilities require the report-timing / histogram / firmware-timing /
timeline / boot-counter feature set (`0x1f`), duration mask `0x07`, 8
histogram bins, timeline capacity 8, big-endian marker 1, microsecond time-unit
marker 1, and firmware-version ASCII length 1..9. The recommended snapshot
interval must be nonzero; the H7S v1 encoder sends 1000 ms.

START OK carries one of the 10 / 30 / 60 s durations, polling mode 0..3, and a
nonzero BE32 expected interval in µs. STOP and CLEAR carry no nonzero payload.
Snapshot chunk 0 freezes a nonzero sequence and reports mode 0..3, speed 0..2,
8 histogram bins and timeline capacity 8. A coherent snapshot has 8..12 chunks,
at most 8 events, and chunk count `8 + ceil(eventCount / 2)`; event types are
1..6. Reserved/padding bytes identified by the coordinated v1 contract are
zero.

The exact request/response bytes, operation/status ids, snapshot chunk fields,
counter placement, event encoding, and firmware capability payload are
`eerraa-qmk-h7s-fw/docs/contract_via.md` §6. The app implementation inventory
is source-owned by `src/utils/era-usb-diagnostics.ts`: start at
`encodeUsbDiagnosticsRequest`, `parseHeader`,
`getUsbDiagnosticsCapabilities`, `getUsbDiagnosticsSnapshot`, and the
`ERA_USB_DIAGNOSTICS_*` constants. Parser rejection details are executable
contract in `tests/era-usb-diagnostics.test.ts`; do not duplicate that list
here.

Any change to selector/version/packet size, operation semantics, units, or
snapshot identity requires a coordinated protocol change. A host-only parser
relaxation is not a compatible extension.

## Observation and measurement semantics

These diagnostics are **observations, not performance guarantees**. App tests
can prove parsing, labeling, and comparison rules; they do not prove physical
USB latency, polling stability, or hardware behavior.

The firmware reports both selected polling mode and negotiated link speed.
`expectedIntervalUs` is derived from the selected polling mode at START, not
from the enumerated speed. FS 1K expects Full Speed; HS 2/4/8K expects High
Speed. Unknown speed is not declared a mismatch. A known mismatch leaves raw
microseconds and raw counters visible, but interval-normalized values do not
describe the selected mode and must be marked non-comparable. The current
mapping is implemented by `usbDiagnosticsExpectedSpeed` and
`isUsbDiagnosticsSpeedConsistent` in
`src/utils/era-usb-diagnostics.ts`.

Histogram quantiles are upper bounds of the first bucket that reaches the
requested cumulative quantile, not raw percentiles. Bucket definitions and the
estimator are source-owned by `USB_DIAGNOSTICS_BUCKETS` and
`estimateHistogramQuantile` in
`src/utils/usb-diagnostics-history.ts`.

Trend p99 uses the histogram delta between consecutive accepted snapshots.
Firmware window maxima describe one captured window only. If snapshot sequence
is not contiguous, the app must omit that point's window maximum rather than
combine unlike windows or present the missing interval as zero. This rule is
implemented by `buildUsbDiagnosticsTrend` in
`src/components/panes/diagnostics-results.tsx`.

While a session runs, the host clamps the firmware-recommended snapshot cadence
to 500..2000 ms. The firmware v1 capability currently recommends 1000 ms; this
is sampling cadence, not a latency guarantee.

Diagnostics OFF adds no diagnostic SOF timestamp or scan-level probe. An active
session adds only the bounded firmware observation described by
`eerraa-qmk-h7s-fw/docs/contract_via.md` §6 plus the host's snapshot reads.
There is no raw 8 kHz sample stream, diagnostic heap, firmware history buffer,
or EEPROM diagnostic write. Material growth of the firmware RAM / IRQ-masked
copy / timer-read bound must be re-measured in the firmware contract rather
than inferred from this host.

### Units, denominators, and comparison validity

| Observation | Unit / denominator | Comparable when |
| --- | --- | --- |
| Raw latency min / avg / max | µs; no normalization denominator | descriptive within a run; avg/max are not cross-run ranking axes |
| Histogram p99 bound and `> 2×` share | bucket multiple of `expectedIntervalUs` | negotiated speed is consistent with selected mode |
| Spread | `(max - min) / expectedIntervalUs` | same identity group and speed-consistent |
| Queue peak | queued reports; no denominator | same identity group |
| Session drops | count; no denominator | same identity group |
| Loop max | µs main-loop gap; no denominator | same identity group |

Report release is phase-coupled to the firmware debounce tick while USB frame
phase is redrawn on enumeration. Therefore raw Avg/Max remain useful
observations but are not comparable across runs as a mode ranking. The
comparison UI leads with Spread, Queue, Drops, and Loop max; the implementation
is `DiagnosticsComparison` in
`src/components/panes/diagnostics-results.tsx`. Historical measurement
examples are intentionally not retained here; the durable requirement is the
comparison rule above.

Comparison identity is matching **VPID + firmware version + diagnostics
protocol version**. Aborted runs are excluded and the comparison view uses the
latest non-aborted run per mode. A firmware change that alters transport
behavior must therefore split comparison groups through firmware version. Do
not mix results from the retired top-level diagnostics page with the current
inline USB-polling block: their host scheduling context differs.

## Host persistence

The storage contract is localStorage key
`era.usbDiagnostics.history.v1`, envelope `schemaVersion` 1, at most 24
runs, and at most 65 snapshots per run. Corrupt or unknown-schema entries are
ignored. Device path and raw HID identifiers must not be persisted.

The current record shape, validation, retention, and identity grouping are
source-owned by `src/utils/usb-diagnostics-history.ts`
(`UsbDiagnosticsRun`, `loadUsbDiagnosticsHistory`,
`saveUsbDiagnosticsRun`, `getComparableUsbDiagnosticsRuns`). Keep the
numeric storage limits above as compatibility requirements rather than
deriving them from prose copies of the type.

A stored result shown in place of a live result must be labeled as previously
stored and must name mode, duration, outcome, and timestamp so it cannot be
mistaken for the current session. Copy/report actions follow the result
currently on screen.

## Failure and lifecycle

All diagnostic requests use the existing per-path serialized WebHID exchange
and connection-generation ownership. The source owner is
`src/utils/era-usb-diagnostics.ts`; session ownership and polling are in
`UsbDiagnosticsSection`.

- A stale snapshot is a coherent retry condition: it resets the consecutive
  failure streak and polling continues. Timeout, malformed, unhandled, and
  non-OK status responses count as failures. Disconnect or three consecutive
  counted failures aborts the page-owned session; any captured snapshots are
  saved as an aborted partial run.
- Page, device, or connection-generation change cancels local ownership. If the
  same connection generation is still current, cleanup requests STOP before
  saving any partial run and releases the local Start lock.
- A leftover firmware session that is still running is not attached to host
  history. The user stops it and starts a new test.
- STOP of a session owned by this page reads one final coherent snapshot. STOP
  of a session the page did not start does not synthesize that final read.
- CLEAR is refused while this page owns an active run. CLEAR resets device RAM
  session state only; it must not clear host history or firmware boot counters.
- A complete/stopped result that survived in keyboard RAM across reload,
  sleep, or reconnect may be read for display and Copy. It is **not** written
  to history because the page no longer knows the real start timestamp. The UI
  must identify it as a result read from the keyboard, not a test this page
  recorded. A report may derive an approximate start time from elapsed duration
  for display/copy, but that approximation must not be persisted.

Unhandled selector response and unsupported protocol version are graceful
unsupported states, not permission to probe ordinary devices.

## State Sync relationship

Diagnostics opt-in and State Sync opt-in are separate protocol gates. The
current Custom pane checks State Sync availability first; when that pane is
withheld, the inline USB diagnostics block is not reachable. That screen-level
dependency does not permit selector `0x07` to become State Sync recovery or
share its wire semantics. The current availability owner is
`getCustomMenuAvailabilityForDevice()` in `src/store/menusSlice.ts`.

## Verification

For this app-side contract, use the source-owned tests rather than a documentary
parser/counter inventory:

- `tests/era-usb-diagnostics.test.ts` — v1 request/reply, malformed/stale,
  control operations, snapshot reconstruction, speed consistency, opt-in gate.
- `tests/usb-diagnostics-history.test.ts` — storage bounds, corruption,
  comparison identity, report caveats.
- `tests/diagnostics-pane.test.tsx` — observation rendering, phase-independent
  comparison, speed-mismatch non-comparability.
- `tests/custom-menu-pane.test.tsx` — placement and probe gating.
- `tests/docs-contract.test.ts` — local document paths, links, scope, routing.

Firmware wire/status/chunk behavior is separately owned and tested by
`eerraa-qmk-h7s-fw/docs/contract_via.md` §6 and its host fixtures. App tests
do not substitute for those firmware tests or for physical HIL.

Hardware acceptance remains separate and may not be claimed from these tests:
for FS 1K and HS 2/4/8K, compare diagnostics OFF/ON keyboard interval, queue
drops, and VIA response latency across representative host controllers, hubs,
and cables. Until that is run, those physical latency/stability concerns remain
unverified. Historical measurement examples belong to Git history, not this
active contract.
