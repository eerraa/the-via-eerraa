# 0002 — H7S USB polling observation and diagnostics retirement

Status: Accepted
Genre: contract
Canonical for: app-side polling TEXT support, observation lifetime, legacy
compatibility and the retired selector boundary

The wire owner is `eerraa-qmk-h7s-fw/docs/contract_via.md` §6. Screen placement
and wording are [ADR 0003](0003-era-menu-help-ui.md).

## Product boundary

Keyboard-value selector `0x07` is retired: current firmware answers
`id_unhandled`. The shipped app does not mount the diagnostics UI or opt any
board into that protocol. Older diagnostics-capable firmware receives no
session commands either. Historical parsers/history fixtures are not an active
product surface and do not authorize new probes or measurements.

Polling remains user-selected through existing Boot Polling Mode and Apply
controls. Do not restore automatic downgrade, synthetic stability scores, or
SOF-based input-latency claims. The firmware retirement rationale is
`eerraa-qmk-h7s-fw/docs/contract_usb.md` §4.

## Current polling TEXT

Read-only Custom channel 13/value 4 reports the keyboard IN endpoint interval
setting at the last successful read. It is not measured host polling or input
latency. Pending selection and Apply do not predict the observation.

Before GET, read the current connection's `id_firmware_version` (keyboard-value
selector `0x04`, unsigned BE32). This is support revision, independent of the
firmware date/build string, VIA protocol version and EEPROM key. Revision 0 is
unsupported; revision 1 or later permits the optional Custom GET.

A full 32-byte reply carries NUL-terminated ASCII in bytes 3..31, with unused
bytes zero. Only `1000 Hz (FS)`, `2000 Hz (HS)`, `4000 Hz (HS)`, `8000 Hz (HS)`
and `Unavailable` are valid. `Unavailable` is a valid firmware observation;
unsupported, timeout, malformed and disconnected are distinct host outcomes.
Only `id_unhandled` permits optional unsupported handling. Other failures retain
the existing KeyboardAPI transport/connection-lock policy.

## Ownership and freshness

For ERA definitions, exclude this observation from generic CONFIG/menu reads.
Its separate state is scoped to device, connection generation, selection and
definition identity. Read automatically on screen activation, reconnection and
visibility resume, without a Refresh button. Same-session reads retain the last
observation while in flight; malformed replies retry on the active-screen
interval. Unsupported and transport failures do not start an automatic retry
loop. A failed read clears the displayed
observation. A stale request cannot publish after its context changes, and a
CONFIG replacement must never restore a previous observation.

The Custom definition declares the standard V3 label and firmware-only
`showIf`, while this app independently verifies live support before querying.
An undefined or stale cached firmware revision is never support proof. Official
or uploaded definitions retain their ordinary V3 path, without special ERA
observation behavior. Stock H7S definitions and release packages omit polling
TEXT and keep Boot Polling Mode/Apply. After reboot and a fresh GET, the dropdown
shows the stored mode, not the negotiated endpoint interval. usevia.txt directs
endpoint observation to usekb.cc. Legacy identities retain their frozen definitions.

## Verification boundary

`tests/deferred-apply.test.ts` exercises transport, activation, stale responses,
CONFIG isolation and compatibility. `tests/era-definition.test.ts` binds the
shipped labels and retired opt-in; `tests/custom-menu-pane.test.tsx` prevents
mounting diagnostics. `tests/menu-observation.test.ts` checks strict decoding
and failure classification. Software fixtures do not prove physical endpoint
timing or official VIA refresh after Apply/reboot.
