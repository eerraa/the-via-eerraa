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
| Azure Static Web Apps / old `fiber` workflow surface | `staticwebapp.config.json`, `.vscode/settings.json`, `.vscode/tasks.json`, `.vscode/launch.json`, `.vscode/extensions.json`, `.github/workflows/pr-build.yml`, `package.json` `build:azure` | The public host is Cloudflare Pages Direct Upload, but deleting source/config is outside this documentation pass. |
| Superseded definition builders | `scripts/download-definition.js`, `scripts/build-definitions.js` | `package.json` routes the live definition build through `scripts/build-keyboards.ts`; verify no external caller before deletion. |
| Static-host GitHub gist OAuth | `src/utils/github.ts`, `public/github_oauth.html` | The static host has no matching OAuth API route; remove the pair together after confirming no supported workflow depends on it. |
| Zero-import app files/assets | `src/utils/debug-shallow-equal.ts`, `src/components/three-fiber/export-scene.tsx`, `src/components/icons/left-arrow.tsx`, `src/components/icons/right-arrow.tsx`, `src/components/icons/tune.tsx`, `src/components/icons/memory.tsx`, `src/components/icons/via.tsx`, `src/App.css`, `src/logo.svg`, `src/assets/react.svg`, `src/assets/images/squarey.svg`, `src/app.icns`, `src/constants/routes.json`, `public/assets/404.html` | Re-run import/reference checks first; a file being listed here is not deletion proof for related siblings. |
| Unused package entries | `@microsoft/applicationinsights-web`, `concurrently`, `redux-logger`, `@types/raf-schd` | Remove only with lockfile changes in a dependency-authorized session after confirming scripts and dynamic loading do not use them. |
| Export-level dead code | output of `bun run find-deadcode` | The exact symbol set is source-derived and must be re-measured; test-only helpers and slice-internal actions are known false positives if import context is ignored. |
| Locale cleanup | unused keys in `src/locales/` | Dynamic `t(label)` values from ERA definition JSON must be included in the reachability check, and all shipped locale catalogs move together. |
| Stale source comment | TODO in `src/components/panes/configure-panes/custom/satisfaction75/menu.tsx` | The pane is still mounted for the supported V2 Rotary Encoder path; the TODO is stale, not proof that the pane is dead. |

Current export-level candidates to re-measure are
`getSelectedRawLayer`, `updateCustomColor`, `getCommonMenusDataMap`,
`disableGlobalHotKeys`, `enableGlobalHotKeys`, `getAllowGlobalHotKeys`,
`getRestartRequired`, `getRandomColor`, `getBrightenedColor`, `get256HSV`,
`getShowSliderValuesModeFromStore`, `getRenderModeFromStore`,
`isNumericOrShiftedSymbol`, `isNumericSymbol`, `isNotNullish`,
`DEFAULT_HOST_KEYBOARD_LAYOUT`, `LabelProps`, the keyboard-api re-exports
`UISyncRequestType` and `UISyncCustomMenuCommandTarget`, and the fixture
`exactTapDanceTermControl`. `bun run find-deadcode` owns the fresh result;
this list only preserves the currently open targets.

Current locale cleanup includes duplicate ellipsis/period/import-error strings,
the retired `Diagnostics` title, the `Blacklight` typo key, and unused
analog/DKS/rapid-trigger, video/image/flash, and per-key switch-type clusters.
Re-check dynamic ERA definition labels before removing any locale entry.

The root `README.md` is an upstream-facing surface and is not part of the
Azure cleanup cluster.

## 3. Retired architecture and false positives

Do not restore Graphify or a `graphify-out/` workflow. It has no current
product path, and reviving a retired parallel representation would recreate
maintenance surface without a current requirement.

Do not restore automatic H7S polling downgrade/benchmark behavior or a synthetic
USB stability score. [ADR 0002](adr/0002-h7s-usb-diagnostics.md) keeps polling
mode user-owned and diagnostics observation-only.

Do not restore a top-level diagnostics destination. [ADR 0003](adr/0003-era-menu-help-ui.md)
keeps diagnostics inline with the USB polling control because placement is part
of the supported-user boundary.

Do not classify the official/custom VIA dual paths, legacy-compatible term
commands, the `/diagnostics` in-app redirect, the Satisfaction75 V2 Rotary
Encoder pane, or the menu-less `sirind/brick65` custom definition as dead merely
because a custom-app path appears to supersede them. Their compatibility reasons
are owned by `docs/PROJECT_DIRECTION.md`, [ADR 0001](adr/0001-state-sync-protocol.md),
and `docs/MAP.md` §6–§7.

Firmware-local command ids and definitions are not deletion authority for this
app. Cross-repository retirement requires a paired review; absent approval,
peer repositories remain read-only references.
