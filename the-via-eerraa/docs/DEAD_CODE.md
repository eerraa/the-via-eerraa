# Dead code and retired architecture

Genre: state
Canonical for: open dead-code cleanup in this app tree, unresolved retirement
stops, and retired architecture that must not be reintroduced

This file contains only work that is still open or a retirement boundary that
still constrains current work. It is not a deletion history. A `DELETE`
candidate below is a future cleanup target, not permission to change product
source in a documentation-only session.

Re-measure a candidate immediately before deletion. `bun run find-deadcode`,
`git grep`, the package scripts, and the live definition manifest are evidence
sources; this file is not a substitute for them.

## 1. Open compatibility stop

State Sync selector `0x06` still has an unresolved short-packet boundary
between this host and the paired QMK/H7S implementations. Do not make the app,
QMK, or H7S conform to one side from this state document.

[ADR 0001](adr/0001-state-sync-protocol.md) owns the State Sync protocol
requirements. Current implementation entry points are
`src/utils/era-state-sync.ts`,
`qmk_firmware_eerraa/keyboards/era/common/system/era_state_sync.c`, and
`eerraa-qmk-h7s-fw/src/ap/modules/qmk/port/era_state_sync.c`.

Close this item only after a paired protocol review establishes the intended
short-packet behavior and the affected host/firmware tests agree. Until then,
treat the difference as unverified compatibility, not as dead code.

## 2. Open cleanup clusters

These clusters are still present in the current tree. Remove one only in a
source-authorized cleanup session after re-measuring its callers and product
coverage.

| Cluster | Current entry points | Why it remains open |
| --- | --- | --- |
| Write-only settings state | `allowGlobalHotKeys` with its `disableGlobalHotKeys`/`enableGlobalHotKeys` reducers, and `restartRequired`, in `src/store/settingsSlice.ts` | Nothing reads either field or dispatches either action. Removing them changes the settings object the slice persists, so it needs a settings-shape review rather than an export cleanup. |
| Test-pinned locale keys | keys such as `Choose a keycode`, `Clear_key`, `Placed`, and the `Tap: the key · Hold: …` pair in `src/locales/` | No source or definition JSON reaches them, but the required-key lists in `tests/locales.test.ts` still demand them. Remove a key only together with its test expectation, in all six catalogs. |
| Short locale keys with unproven reachability | single-word or short keys (`Config`, `Delay`, `Keyboard`, `Theme`, `Tap`, …) in `src/locales/` | They appear in source only inside longer strings or identifiers, never as a quoted literal, so a substring search cannot prove them dead. Keycode titles written with escaped backslashes in `src/utils/key.ts` (`Non-US \ and |`) are reachable. |
| Module-local unused declarations | output of `bun x tsc --noEmit --noUnusedLocals` | These are unused imports and locals inside modules. Several are `useAppSelector` calls in `src/components/Home.tsx`, so removing them changes store subscriptions. Review them one by one instead of deleting them in bulk. |

`bun run find-deadcode` scans only `src` (the `tsconfig.json` include). The
remaining output is a known false positive unless it falls outside these
classes:

- exports that only tests import, including `*ForTesting` helpers and the
  re-export of `getLayoutImportKeycodes` in `src/utils/layout-import.ts`;
- exports that only `scripts/` imports;
- Redux Toolkit slice actions destructured from `slice.actions`;
- the generated `src/utils/era-wire.generated.ts`, which is owned by
  `bun run era-wire:generate`;
- State Sync constants in `src/utils/era-state-sync.ts` (§1);
- the retired diagnostics modules `src/utils/era-usb-diagnostics.ts`,
  `src/utils/usb-diagnostics-history.ts`,
  `src/components/panes/diagnostics-results.tsx`, and
  `src/components/panes/configure-panes/custom/usb-diagnostics-section.tsx`
  (§3).

When a symbol is used only inside its own module, remove just its `export`
keyword instead of deleting the symbol.

Locale reachability includes literal `t('…')` keys, the template keys
containing `{{…}}`, and dynamic `t(label)` values. Those labels come from
`era-definitions/`, `config/`, the pinned `via-keyboards` definitions, and the
built-in menus of `@the-via/reader`.

The root `README.md` still shows an Azure Static Web Apps badge. That file faces
upstream and is outside app cleanup.

## 3. Retired architecture and false positives

Do not restore Graphify or a `graphify-out/` workflow. It has no current
product path, and reviving a retired parallel representation would recreate
maintenance surface without a current requirement.

Do not restore automatic H7S polling downgrade/benchmark behavior or a synthetic
USB stability score. [ADR 0002](adr/0002-h7s-usb-diagnostics.md) keeps polling
mode user-owned and replaces retired diagnostics with a scoped polling observation.

Do not restore a top-level diagnostics destination. [ADR 0003](adr/0003-era-menu-help-ui.md)
keeps the current interval observation inline with the USB polling control.
The diagnostics session UI, parser and history helpers remain retired code;
their tests preserve historical decoding, not product reachability.

Do not classify the official/custom VIA dual paths, legacy-compatible term
commands, the `/diagnostics` in-app redirect, the Satisfaction75 V2 Rotary
Encoder pane, or the menu-less `sirind/brick65` custom definition as dead merely
because a custom-app path appears to supersede them. Their compatibility reasons
are owned by `docs/PROJECT_DIRECTION.md`, [ADR 0001](adr/0001-state-sync-protocol.md),
and `docs/MAP.md` §6–§7.

Firmware-local command ids and definitions are not deletion authority for this
app. Cross-repository retirement requires a paired review; absent approval,
peer repositories remain read-only references.
