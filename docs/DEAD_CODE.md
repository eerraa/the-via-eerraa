# Dead code and retired architecture

Genre: state
Canonical for: measured unused and retired VIA surfaces in this tree (app,
definitions, tests, docs). Not QMK or H7S firmware. Class names are DELETE,
RETIRED-ID, STALE-COMMENT, PAIRED-STOP, KEEP

This file is the campaign ledger. Close a cluster by deleting it in a later
session, then delete the matching rows here. Do not restore Graphify. Do not
pick a winner on selector `0x06` short-packet semantics.

Proof for DELETE: zero importers in `src/` and `tests/`, not a
`FEATURE_COVERAGE` command, not a menu `content` id in
`era-definitions/custom/v3`. `ts-prune` "used in module" is not proof of
death. Redux actions consumed only inside their slice stay KEEP.

Read-only peers for PAIRED-STOP and RETIRED-ID: `eerraa/qmk_firmware_eerraa`
`work/era-nvm`, `eerraa/eerraa-qmk-h7s-fw` `main`. Those trees were not
edited.

## 1. PAIRED-STOP — selector `0x06` short packet

Do not close this item. Do not change host parse, QMK, or H7S to "match"
from this ledger.

HID GET `0x02` + selector `0x06` is State Sync envelope v1. Byte layout of a
full 32-byte OK envelope matches across the three texts. Short-packet
(`length < 32`) semantics do not.

| Side | What happens when `length < 32` |
| --- | --- |
| This app, matcher in `src/utils/era-state-sync.ts` `queryStateSync` | A response whose `message.length !== 32` does not match. The exchange can time out. |
| This app, `parseStateSyncEnvelope` | Returns null when `bytes.length !== 32`. Null is `malformed`, not `unhandled` and not status `INVALID` `0x02`. Byte `0 === 0xff` is `unhandled`. |
| QMK `era_state_sync_via_command` (`qmk_firmware_eerraa/keyboards/era/common/system/era_state_sync.c`) | Returns false; this unit does not `raw_hid_send`. |
| QMK USB RAW path | `raw_hid_receive` is called with `RAW_EPSIZE` 32, so a short OUT is not visible as `length < 32`. A nonzero reserved tail on a 32-byte buffer is `INVALID` `0x02`. After false, `quantum/via.c` writes `id_unhandled` `0xFF`; `send_raw_hid` drops a send when `length != RAW_EPSIZE`. Recorded in `qmk_firmware_eerraa/keyboards/era/common/docs/contracts/era_host_peer_storage_contract.md` (short-packet peer table: no winner). |
| H7S `era_state_sync_via_command` (`eerraa-qmk-h7s-fw/src/ap/modules/qmk/port/era_state_sync.c`) | `data == NULL \|\| length < 32` returns false. |
| H7S `eerraa-qmk-h7s-fw/docs/contract_via.md` §5 | Short buffer is not an envelope. `via.c` sets `id_unhandled` (`0xFF`); the buffer is not rewritten as a v1 envelope. **REFUSED:** answering `ERA_STATE_SYNC_STATUS_INVALID` on `length < 32`. |

[ADR 0001](adr/0001-state-sync-protocol.md) states `0xFF` is not an envelope.
It does not pick between `malformed` (host parse of a non-32 IN) and `0xFF`
(firmware unhandled). That gap is this row.

## 2. DELETE

Each cluster is one later session. Do not mix clusters in one commit unless
they are the same proof.

### 2.1 Azure Static Web Apps and GitHub `fiber` — removed 2026-08-30, PR #19

Not pending. Re-measured 2026-08-30 before delete: zero importers in `src/`
and `tests/`; not a `FEATURE_COVERAGE` command; not a menu `content` id in
`era-definitions/custom/v3`. No `api/` directory. Origin has no `fiber`
branch. Cloudflare workflow and PR CI call `bun run build`, not
`build:azure`. Vite does not copy a repo-root SWA config into `dist/`.

Removed in PR #19: `staticwebapp.config.json`;
`package.json` script `build:azure`; `.vscode/settings.json` (only
`azureFunctions.*` plus Functions-attach `debug.internalConsoleOptions`);
`.vscode/tasks.json`; `.vscode/launch.json`; Azure Functions recommendation
from `.vscode/extensions.json`; `fiber` from
`.github/workflows/pr-build.yml` `on.pull_request.branches` (now `main`
only). Prettier recommendation in `.vscode/extensions.json` stays.

Root `README.md` still describes Azure. `docs/DEPLOYMENT.md` forbids editing
it. That file is KEEP (upstream surface), not this cluster.

### 2.2 Definition-build scripts the app does not run — removed 2026-08-30, PR #20

Not pending. Re-measured 2026-08-30 before delete: zero importers in `src/`
and `tests/`; not a `FEATURE_COVERAGE` command; not a menu `content` id in
`era-definitions/custom/v3`. `package.json` `build:kbs` is
`node --import tsx scripts/build-keyboards.ts` only. PR CI and the Cloudflare
deploy workflow call `bun run build`, which runs `build:kbs`.
`tsconfig.scripts.json` includes `scripts/**/*.ts` only.

Removed in PR #20: `download-definition.js`
(fetched caniusevia.com `keyboards.v2.json` into a v2 definitions folder)
and `build-definitions.js` (`via-keyboards public/definitions`) from
`scripts/`. Live definition pipeline stays `scripts/build-keyboards.ts`.

### 2.3 GitHub gist OAuth — removed 2026-08-30, PR #21

Not pending. Re-measured 2026-08-30 before delete: zero importers in `src/`
and `tests/`; not a `FEATURE_COVERAGE` command; not a menu `content` id in
`era-definitions/custom/v3`. No `api/` directory. No CI workflow or app route
names `GithubOAuth`. Vite copies `public/` into `dist/`; nothing imported the
helper.

Removed in PR #21: `github.ts` (`authGithub`,
`getUser`, `getKLEFiles`; non-localhost redirect URI was `usevia.app`) from
`src/utils/` and `github_oauth.html` from `public/` (posted to
`/api/GithubOAuth`, which this host does not serve).

### 2.4 Unreferenced source files — removed 2026-08-30

Not pending. Re-measured 2026-08-30 before delete: zero importers in `src/`
and `tests/`; not a `FEATURE_COVERAGE` command; not a menu `content` id in
`era-definitions/custom/v3`. Live pane icons are Font Awesome in
`src/utils/pane-config.ts` (`faGear`, `faBug`). `src/index.tsx` imports
`src/app.global.css` only. Live 404 is `public/404.html`. Live files under
`src/assets/` remain (`chippy_600.png`, `cubey.glb`,
`keyboard_components.glb`).

Removed in this PR (number filled after open): `debug-shallow-equal.ts`
(`debugShallowEqual`) from `src/utils/`; `export-scene.tsx` (`ExportScene`)
from `src/components/three-fiber/`; unused icons `left-arrow.tsx`,
`right-arrow.tsx`, `tune.tsx`, `memory.tsx`, `via.tsx` (`VIALogo`) from
`src/components/icons/`; Vite scaffold `App.css`, `logo.svg`, and `app.icns`
from `src/`; `react.svg` from `src/assets/`; `squarey.svg` from
`src/assets/images/`; `routes.json` (`{"HOME":"/"}`); empty `404.html` (one
newline) that was not `public/404.html`. Live routes stay in
`src/utils/pane-config.ts`.

### 2.5 Unused package.json dependencies

Zero `import` / `require` in `src/`, `tests/`, `scripts/`.

| Package | Role claimed vs measured |
| --- | --- |
| `@microsoft/applicationinsights-web` | No import. |
| `concurrently` | DevDependency. No script uses it. |
| `redux-logger` | `src/store/index.ts` does not add logger middleware. |
| `@types/raf-schd` | No `raf-schd` package and no import. |

`ts-prune` / `find-deadcode` stay. They are how this ledger was measured.

### 2.6 Unused TypeScript exports (file stays)

Same proof as §2.4, export-level. Do not delete the file.

| Export | File |
| --- | --- |
| `getSelectedRawLayer` | `src/store/keymapSlice.ts` — callers use `getSelectedRawLayers`. |
| `updateCustomColor` | `src/store/lightingSlice.ts` — UI uses `updateCustomColorContinuous`. |
| `getCommonMenusDataMap` | `src/store/menusSlice.ts` |
| `disableGlobalHotKeys`, `enableGlobalHotKeys`, `getAllowGlobalHotKeys`, `getRestartRequired` | `src/store/settingsSlice.ts` — no dispatcher outside the slice. |
| `getRandomColor`, `getBrightenedColor`, `get256HSV` | `src/utils/color-math.ts` — `getDarkenedColor` / `getHSV` / `updateCSSVariables` are live. |
| `getShowSliderValuesModeFromStore`, `getRenderModeFromStore` | `src/utils/device-store.ts` — UI reads Redux `getRenderMode`. |
| `isNumericOrShiftedSymbol`, `isNumericSymbol` | `src/utils/key.ts` — defined, never called. |
| `isNotNullish` | `src/utils/type-predicates.ts` — `isFulfilledPromise` and `isAuthorizedDeviceConnected` are live. |
| `DEFAULT_HOST_KEYBOARD_LAYOUT` | `src/utils/keymap-extras/index.ts` — default is the `'keymap_us'` literal in `src/utils/device-store.ts`. |
| `LabelProps` | `src/components/panes/configure-panes/custom/menu-generator.tsx` |
| Re-exports `UISyncRequestType`, `UISyncCustomMenuCommandTarget` | `src/utils/keyboard-api.ts` — tests import from `src/utils/ui-sync.ts`. |
| `exactTapDanceTermControl` | `tests/fixtures/via-ms-definitions.ts` — other exports in that file are imported by `tests/millisecond-field.test.ts`. |

`ts-prune` also lists test-only HID helpers (`configureHIDTransport`,
`registerHIDDeviceForTesting`, …). Those are imported by
`tests/transport-phase1.test.ts` and `tests/state-sync-transport.test.ts`. KEEP.

Named diagnostic bit constants (`ERA_USB_DIAGNOSTICS_CAP_*`,
`ERA_USB_DIAGNOSTICS_STATUS_INVALID`, `ERA_USB_DIAGNOSTICS_STATUS_NO_SESSION`)
are unused as identifiers; `ERA_USB_DIAGNOSTICS_REQUIRED_CAPABILITIES` is
`0x1f` (all five bits). KEEP the names as the wire catalog.

### 2.7 Unused locale keys

`src/locales/*.json`: 6 files, 605 keys each
(`tests/locales.test.ts` same-key lock). A key is live if `src/` calls `t`
with that string, or a definition JSON label is that string (Custom pane
does `t(label)`).

Proven unused clusters (English key; all six catalogs must move together):

| Cluster | Examples | Proof |
| --- | --- | --- |
| Duplicate ASCII vs Unicode ellipsis | `Searching for devices…` vs live `Searching for devices...` in `src/components/loading-text.tsx`; `No macro recorded yet…` vs live `No macro recorded yet...` in `src/components/panes/configure-panes/submenus/macros/macro-recorder.tsx`; `Loading…` with no `src/` caller | The ASCII form is the `t()` argument. |
| Duplicate period | `This feature is not available for this firmware version` (no period) vs live string with period in `src/components/panes/configure-panes/custom/menu-generator.tsx` | |
| Duplicate import error | `Could not import layout. This file was created for a different keyboard` vs live `…keyboard: {{name}}` in `src/components/panes/configure-panes/save-load.tsx` | |
| Retired tab title | `Diagnostics` | No `t('Diagnostics')`. Top-level page is gone ([ADR 0003](adr/0003-era-menu-help-ui.md)). |
| Unused typo key | `Blacklight` | No `src/` and no definition label. Live backlight labels are `Backlight` / `Breating Period` (§4). |
| Analog / DKS / rapid-trigger catalog | `Actuation`, `DKS`, `Rapit Trigger`, `Set Actuatoin Point`, `Per key actuation`, … | Zero `src/` matches. |
| Video / image / flash catalog | `Import Video`, `FPS`, `Failed to flash.`, … | Zero `src/` matches. |
| Per-key switch-type catalog | `Caps Key Switch Type`, `Left Shift Key Mode`, `Haptic Status`, … | Zero `src/` matches. |

Do not delete a key that is only reached via `t(label)` from JSON until that
label is grepped in `era-definitions/custom/v3`. Long Design-tab strings in
`src/components/panes/design.tsx` are live even when they span JSON newlines.

## 3. RETIRED-ID

Ids the firmware still answers (or used to) that this app's menus do not
send. Not a deletion of JSON in this tree until a paired firmware session
agrees. Dual-path architecture is KEEP (§5).

| Id / label | This tree | QMK `*-VIA.json` (26 files under `keyboards/era`) | H7S `*-VIA.JSON` (5 files) |
| --- | --- | --- | --- |
| `id_qmk_tapping_global_term` and `id_qmk_tapdance_1_term` … `_8_term` (legacy 1-byte × 10 ms) | Absent from all 31 custom JSON files. `scripts/build-keyboards.ts` rejects them. `isLegacyTermCommand` exists only as that guard. | Present. Labels `Global Tapping Term` / `Term`. | Present. Same labels. Channel 16, values 5,10,…40 for TD slots. |
| `id_qmk_tapping_global_term_exact` and `id_qmk_tapdance_N_term_exact` | Present on every opted-in custom JSON (not `brick65`). Labels `Global Tapping Term (ms)` / `Term (ms)`. | Absent. | Absent. Firmware C still implements exact GET/SET ([ADR 0001](adr/0001-state-sync-protocol.md)). |
| `id_qmk_usb_autodg_beta` / label `Auto downgrade on USB unstable` | Absent. `tests/era-definition.test.ts` asserts H7S custom JSON does not contain either string. | Absent at the measured QMK tree. | Absent at the measured H7S tree. |

Official Design-tab uploads of firmware-local JSON still expose the legacy
dropdown. That is the official VIA path, not dead custom-app code.

## 4. STALE-COMMENT

Live strings or comments that are wrong. Not deletion of the control.

| Location | Fact |
| --- | --- |
| `public/_redirects` header | Comments that routes are declared in pane-config with a `.tsx` suffix. The file is `src/utils/pane-config.ts`. |
| `tests/docs-contract.test.ts` comment | Same `.tsx` suffix as an example of a path that outlived a rename. |
| Label `Breating Period` | Live `id_custom_breathing_period` label in eight custom JSON files (`era-definitions/custom/v3/a1`, `classicd_a1`, `classicd_a1_ug`, `classicd_core`, `classicd_coreless`, `era65`, `et_tkl`, `n8x`). Same eight QMK firmware-local JSON files. Typo, not unused. Changing it is a label change on both trees, not a DELETE. |
| `src/components/panes/configure-panes/custom/satisfaction75/menu.tsx` TODO | Asks whether `SatisfactionMenu` can go now that V3 exists. V2 `CustomFeaturesV2.RotaryEncoder` in `src/components/panes/configure.tsx` still mounts it. KEEP the pane; the TODO is not proof. |

## 5. KEEP

Looks unused; deleting is a regression.

| Surface | Why it stays |
| --- | --- |
| Dual tapping/TD term encodings, Tap Dance `CUSTOM(n)` vs `TD(n)`, `/definitions/v3` vs `/definitions/era/v3` | `docs/MAP.md` §6. Official VIA and custom app share HID bytes. |
| `sirind/brick65` custom JSON with no ERA menus | Permanent ATmega32U4 exception. `FEATURE_COVERAGE` does not list it for mouse/NKRO/split. |
| H7S-only custom command ids: `id_qmk_usb_bootmode`, `id_qmk_usb_bootmode_apply`, `id_qmk_ver_yy`/`_mm`/`_dd`/`_rv`, `id_qmk_kill_switch_*`, `id_qmk_velocikey_toggle` | Live menus (`USB POLLING`, `VERSION`, SOCD under a different prefix). `FEATURE_COVERAGE` is a four-row variance table (`id_qmk_mousekey`, `id_qmk_custom_nkro`, `id_qmk_split_link`, `id_qmk_eeprom_sync`), not a catalog of every command. Design-tab drafts of H7S official JSON showing extra menus is expected, not drift. |
| QMK-only custom command ids (NKRO, split, EEPROM sync, `id_qmk_socd_*`, RGB matrix, `id_custom_breathing_period`, …) | Live on RP2040 definitions. |
| `src/Routes.tsx` `/diagnostics` → `/` | Bookmark compatibility after the top-level page was refused ([ADR 0003](adr/0003-era-menu-help-ui.md)). Missing from `public/_redirects` is a documented seam (`docs/MAP.md` §7), not a DELETE. |
| `src/components/panes/configure-panes/custom/satisfaction75/` | Official V2 Rotary Encoder keyboards. |
| `tests/deferred-apply.test.ts` | Passes when run by hand. `tests/docs-contract.test.ts` `KNOWN_UNRUN` locks the script gap. Add it to a script or delete the test in a session that chooses; it is not 0-importer dead code today. |
| `tests/usb-diagnostics-fixtures.ts`, `tests/fixtures/millisecond-fake.ts`, used exports of `tests/fixtures/via-ms-definitions.ts` | Imported by live tests. |
| `src/utils/command-logger.ts` | `logCommand` from `src/utils/keyboard-api.ts`; `getLog` is `window.__getLogs`. |
| Graphify / `graphify-out/` | Absent from this tree. Do not restore. |

## 6. Proposed deletion session order

One cluster per session. Re-measure importers before deleting. Stop if a
name appears in `FEATURE_COVERAGE` or in custom menu `content`.

1. §2.1 Azure / `fiber` — removed 2026-08-30, PR #19.
2. §2.2 unused definition scripts — removed 2026-08-30, PR #20.
3. §2.3 GitHub OAuth pair (ts + html together) — removed 2026-08-30, PR #21.
4. §2.4 unreferenced files — removed 2026-08-30.
5. §2.5 unused npm dependencies (`bun.lock` / `package-lock.json` together).
6. §2.6 unused exports. Keep files.
7. §2.7 unused locale keys, six catalogs in one commit, `tests/locales.test.ts`
   green.
8. §4 comment-only fixes (`public/_redirects` and docs-contract comment
   suffix). Separate from `Breating Period`, which is a live label.

Never in a deletion session from this ledger: §1 `0x06` short packet; §3
legacy term ids or autodg; §5 dual-path / brick65 / H7S extras / satisfaction75
/ `/diagnostics` redirect; Graphify restore; `Breating Period` treated as dead
code.
