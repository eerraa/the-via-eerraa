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

### 2.4 Unreferenced source files — removed 2026-08-30, PR #22

Not pending. Re-measured 2026-08-30 before delete: zero importers in `src/`
and `tests/`; not a `FEATURE_COVERAGE` command; not a menu `content` id in
`era-definitions/custom/v3`. Live pane icons are Font Awesome in
`src/utils/pane-config.ts` (`faGear`, `faBug`). `src/index.tsx` imports
`src/app.global.css` only. Live 404 is `public/404.html`. Live files under
`src/assets/` remain (`chippy_600.png`, `cubey.glb`,
`keyboard_components.glb`).

Removed in PR #22: `debug-shallow-equal.ts`
(`debugShallowEqual`) from `src/utils/`; `export-scene.tsx` (`ExportScene`)
from `src/components/three-fiber/`; unused icons `left-arrow.tsx`,
`right-arrow.tsx`, `tune.tsx`, `memory.tsx`, `via.tsx` (`VIALogo`) from
`src/components/icons/`; Vite scaffold `App.css`, `logo.svg`, and `app.icns`
from `src/`; `react.svg` from `src/assets/`; `squarey.svg` from
`src/assets/images/`; `routes.json` (`{"HOME":"/"}`); empty `404.html` (one
newline) that was not `public/404.html`. Live routes stay in
`src/utils/pane-config.ts`.

### 2.5 Unused package.json dependencies — removed 2026-08-30, PR #23

Not pending. Re-measured 2026-08-30 before delete: zero `import` / `require` in
`src/`, `tests/`, and `scripts/`; not a `FEATURE_COVERAGE` command; not a menu
`content` id in `era-definitions/custom/v3`. No CI workflow or `package.json`
script names them. `src/store/index.ts` does not add logger middleware. No
`raf-schd` package.

Removed in PR #23:
`@microsoft/applicationinsights-web`, `concurrently`, `redux-logger`, and
`@types/raf-schd` from `package.json`. `bun.lock` and `package-lock.json`
refreshed together. `ts-prune` / `find-deadcode` stay.

### 2.6 Unused TypeScript exports (file stays) — removed 2026-08-30, PR #24

Not pending. Re-measured 2026-08-30 before delete: zero importers in `src/`
and `tests/`; not a `FEATURE_COVERAGE` command; not a menu `content` id in
`era-definitions/custom/v3`. Files stay. `bun run find-deadcode` (`ts-prune`)
listed each `src/` name below. `exactTapDanceTermControl` is under `tests/`,
outside `tsconfig.json` `include` (`src`, `types`); grep showed no importer.
`ts-prune` "used in module" on `disableGlobalHotKeys` / `enableGlobalHotKeys`
is the slice `actions` destructure, not a dispatcher in `src/` or `tests/`.

Removed in PR #24:
`getSelectedRawLayer` from `src/store/keymapSlice.ts`;
`updateCustomColor` from `src/store/lightingSlice.ts`;
`getCommonMenusDataMap` from `src/store/menusSlice.ts`;
`disableGlobalHotKeys`, `enableGlobalHotKeys`, `getAllowGlobalHotKeys`,
`getRestartRequired` from `src/store/settingsSlice.ts`;
`getRandomColor`, `getBrightenedColor`, `get256HSV` from
`src/utils/color-math.ts`;
`getShowSliderValuesModeFromStore`, `getRenderModeFromStore` from
`src/utils/device-store.ts`;
`isNumericOrShiftedSymbol`, `isNumericSymbol` from `src/utils/key.ts`;
`isNotNullish` from `src/utils/type-predicates.ts`;
`DEFAULT_HOST_KEYBOARD_LAYOUT` from `src/utils/keymap-extras/index.ts`;
`LabelProps` from
`src/components/panes/configure-panes/custom/menu-generator.tsx`;
re-exports `UISyncRequestType`, `UISyncCustomMenuCommandTarget` from
`src/utils/keyboard-api.ts` (live imports remain `src/utils/ui-sync.ts`);
`exactTapDanceTermControl` from `tests/fixtures/via-ms-definitions.ts`.

Kept: test-only HID helpers (`configureHIDTransport`,
`registerHIDDeviceForTesting`, …) imported by
`tests/transport-phase1.test.ts` and `tests/state-sync-transport.test.ts`.
Named diagnostic bit constants (`ERA_USB_DIAGNOSTICS_CAP_*`,
`ERA_USB_DIAGNOSTICS_STATUS_INVALID`, `ERA_USB_DIAGNOSTICS_STATUS_NO_SESSION`)
stay as the wire catalog. `ts-prune` / `find-deadcode` stay.
`getDarkenedColor` / `getHSV` / `updateCSSVariables`,
`getSelectedRawLayers`, `updateCustomColorContinuous`, and Redux
`getRenderMode` stay.

### 2.7 Unused locale keys — removed 2026-08-30, PR #25

Not pending. Re-measured 2026-08-30 before delete. A key is live if `src/`
passes that string to `t`, or a menu `label` / dropdown option in
`era-definitions/custom/v3` or `via-keyboards` (official V3 JSON this app
loads) is that string — Custom pane does `t(label)`. Not a
`FEATURE_COVERAGE` command. All six catalogs (`de en es ja ko zh`) moved
together. `tests/locales.test.ts` same-key lock stays.

Removed in PR #25, 77 keys:

Unicode-ellipsis duplicates (ASCII forms stay): `Searching for devices…`,
`No macro recorded yet…`, `Loading…`.
Period duplicate: `This feature is not available for this firmware version`
(the form with a period stays).
Import-error duplicate: `Could not import layout. This file was created for
a different keyboard` (the `{{name}}` form stays).
Retired tab title: `Diagnostics` (no `t('Diagnostics')`; top-level page is
gone, [ADR 0003](adr/0003-era-menu-help-ui.md)). `USB Polling Diagnostics`
and related observation keys stay.
Typo: `Blacklight`. Live backlight labels are `Backlight` / `Breating Period`
(§4).

Analog / DKS / rapid-trigger keys with no `src/` `t()` argument, no
`era-definitions/custom/v3` label, and no `via-keyboards` label/option:
`Selecting a key to start setting dynamic keystroke`, `AP`, `DKS`, `RT`,
`Selecting keys to set per key actuation`, `Per key actuation`,
`Selecting keys to set rapid trigger`, `Revert all keys to global`,
`Rapit Trigger`, `Global actuation`, `Continuous rapid trigger`,
`Press(active)`, `Release(reset)`, `sensitivity`, `Set Actuatoin Point`,
`Self Check`, `SELF CHECK`, `Recheck`, `Check Failed, Retry`,
`Actuation Level (0% | 100%)`, `Actuation Offset (1-255)`,
`Bottoming Calibration`, `Clear Bottoming Calibration Data`, `EC Tools`,
`Hybrid Tools`, `Initial Deadzone Offset (0% | 100%)`,
`Noise Floor Calibration (DO NOT PRESS ANY KEY WHILE CLICKING)`,
`Release Level (0% | 100%, ALWAYS < Actuation Level)`,
`Release Offset (1-255)`, `Show Calibration Data`.

Video / image / flash keys with the same proof: `Matrix Lighting`,
`Import Image`, `Import Video`, `FPS`, `video`, `image`, `slider`,
`Original Size`, `Space Remaining`, `Processing`, `Failed to process.`,
`Failed to save.`, `File Name`, `Import From Album`, `Transition Animation`,
`Top to bottom`, `Bottom to top`, `Left to right`, `Right to left`,
`Current bindings`, `Flash`, `Failed to flash.`, `Flash successful.`,
`Import File`, `Download File`, `Current Version`, `Update Available`,
`Time Sync`, `Initializing`,
`Cancel transfer will revert to factory default video, confirm cancel?`,
`Cancel transfer will revert to factory default image, confirm cancel?`,
`Cancel transfer will revert to factory default slider, confirm cancel?`,
`To boost the data transfer speed, the backlight will shut off during transfer period and resume afterwards.`,
`Please DO NOT disconnect or switch mode during the upgrade, until the keyboard auto-reboot finishes.`,
`Custom Animation`, `Custom Image`, `Custom Slider`, `Sharing failed`,
`Sharing success`.

Per-key switch-type key with the same proof: `Main Cluster Switch Type`.

Kept (looked unused in `src/` literals; official VIA JSON still feeds them
to `t(label)`): `Actuation` and `Calibration` (`via-keyboards` cipulot EC
menus); `Switch Type`, `Haptic Status`, `General Board`, `Caps Key`,
`Caps Key Switch Type`, `Caps Key Mode`, and the matching Left/Right Shift,
Right FN, Left/Right Mod 1–2, Left/Right Spacebar 1–2 Key / Switch Type /
Mode labels (`via-keyboards` cipulot `hybrid_enso_e` and `21xx`). Long
Design-tab strings in `src/components/panes/design.tsx` stay.

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

### 4.1 `_redirects` / docs-contract pane-config suffix — fixed 2026-08-30

Not pending. Re-measured 2026-08-30 before edit: `src/utils/pane-config.ts`
exists. Git history of that path starts as `.ts` (snowpack template); there is
no rename from a `.tsx` file. `public/_redirects` header named that file with a
`.tsx` suffix. `tests/docs-contract.test.ts` used the same `.tsx` path as an
example of a comment that outlived a rename; the rename claim is also false.
Other `_redirects` header paths exist (`src/components/panes/errors.tsx`,
`src/utils/device-store.ts`, `public/404.html`). Rewrite rules `/test`
`/design` `/settings` `/debug` `/console` `/errors` match `pane-config.ts` plus
`ErrorsPaneConfig`. `/diagnostics` remains absent (`docs/MAP.md` §7).

Fixed in this PR (number filled after open): `public/_redirects` suffix `.ts`.
docs-contract example now cites `src/utils/pane-config.ts` and does not claim a
`.tsx` rename.

| Location | Fact |
| --- | --- |
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
4. §2.4 unreferenced files — removed 2026-08-30, PR #22.
5. §2.5 unused npm dependencies — removed 2026-08-30, PR #23.
6. §2.6 unused exports — removed 2026-08-30, PR #24. Keep files.
7. §2.7 unused locale keys — removed 2026-08-30, PR #25. Six catalogs in one commit.
8. §4.1 `_redirects` / docs-contract pane-config suffix — fixed 2026-08-30.
   Separate from `Breating Period`, which is a live label.

Never in a deletion session from this ledger: §1 `0x06` short packet; §3
legacy term ids or autodg; §5 dual-path / brick65 / H7S extras / satisfaction75
/ `/diagnostics` redirect; Graphify restore; `Breating Period` treated as dead
code.
