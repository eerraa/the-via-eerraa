# ERA VIA Fork — data map

Genre: map
Canonical for: which fact lives where in this repository, which side wins on
conflict, and what bites the mismatch — source ownership, verification entry
points, reference repositories, and this repository's document adapters

This document answers only **where a fact lives and which side is canonical
when two copies disagree**. Reasons live in `docs/adr/`, product direction in
`docs/PROJECT_DIRECTION.md`, history in `git log`. No dates, session narrative,
or progress.

## 1. Canonical rules

When two places state the same fact, the **Canonical** column wins.
If a document disagrees with canonical, **fix the document.** If the opposite
looks right, report it; do not silently invert the table.

| Fact | Canonical | What bites it |
| --- | --- | --- |
| ERA custom definition contents (menus, controls, addresses, labels) | JSON under `era-definitions/custom/v3/` | `tests/era-definition.test.ts` |
| What older firmware under a legacy identity is served | frozen JSON under `era-definitions/legacy/v3/`, never edited ([ADR 0004](adr/0004-firmware-distribution.md) §2) | the legacy digest in `tests/era-definition.test.ts`, `scripts/build-keyboards.ts` |
| Fork-managed external stock V3 definitions | JSON under `era-definitions/external/v3/` + `config/external-definitions.manifest.json` | `tests/validate-external-v3.test.ts`, `scripts/build-keyboards.ts` |
| Which board has which feature | the same JSON | `FEATURE_COVERAGE` in that file |
| Per-board capability opt-in (state sync / exact-ms / split pair) | `config/era-definitions.manifest.json` | `tests/era-definition.test.ts` |
| Official VIA V3 definitions | `the-via/keyboards` — the installed `node_modules/via-keyboards` is a pinned snapshot only | `Verify build output` in the deploy workflow |
| Explicit validation of firmware-local VIA V3 files | `scripts/validate-external-v3.ts`, using the app's `@the-via/reader` guard and transform | `tests/validate-external-v3.test.ts` |
| Host wire encode/decode implementation | `src/utils/era-state-sync.ts`, `src/utils/era-usb-diagnostics.ts` | `tests/era-state-sync.test.ts`, `tests/era-usb-diagnostics.test.ts`, `tests/state-sync-transport.test.ts` |
| VERSION ASCII display grammar and build ordering | `src/utils/era-firmware-version.ts` | `tests/custom-menu-pane.test.tsx`, `tests/era-definition.test.ts`, `tests/firmware-distribution.test.tsx` |
| Observation / no-verdict boundary | [ADR 0003](adr/0003-era-menu-help-ui.md) §3 | `src/locales/*.json`, `DIAGNOSTIC_OBSERVATION_KEYS` in `tests/locales.test.ts` |
| Observation and historical diagnostics strings | `src/locales/*.json` | `tests/locales.test.ts`, `tests/diagnostics-pane.test.tsx` |
| ERA menu-help summary / disclosure / attach policy | [ADR 0003](adr/0003-era-menu-help-ui.md) §6 | `src/utils/era-feature-help.ts`, `src/components/panes/configure-panes/custom/help-content.tsx`, `tests/locales.test.ts`, `tests/custom-menu-pane.test.tsx`, `tests/era-definition.test.ts` |
| Current ERA help copy and command targets | `src/utils/era-feature-help.ts` | `tests/locales.test.ts`, `tests/custom-menu-pane.test.tsx`, `tests/era-definition.test.ts` |
| Keycode chooser (KEYMAP pane, V3 `keycode` dock) and Tap Dance editing from KEYMAP | `docs/PROJECT_DIRECTION.md` **Tap Dance and exact-ms**; Basic layout, search, combined keys and Tap Dance write planning in `src/utils/keycode-palette.ts` | `tests/keycode-palette.test.ts`, `tests/keycode-palette-render.test.tsx` |
| App route list | `src/utils/pane-config.ts`, `src/components/panes/errors.tsx`, `src/utils/firmware-route.ts` | none — `public/_redirects` is hand-matched (§7) |
| Maker VID block, PID allocation, legacy identity resolution, firmware download surface | [ADR 0004](adr/0004-firmware-distribution.md); concrete USB identities stay firmware-owned and mirrored in `config/era-definitions.manifest.json` | `tests/docs-contract.test.ts`, `tests/era-definition.test.ts`, `tests/firmware-distribution.test.tsx` |
| Firmware link previews (the `/firmware-app` and maker shells) and short board links | [ADR 0004](adr/0004-firmware-distribution.md) §4 | `scripts/firmware-share-page.ts`, `vite.config.ts`, `public/_redirects`, `tests/firmware-distribution.test.tsx` |
| Saved layout files across identities and layer counts, Tap Dance in them | [ADR 0004](adr/0004-firmware-distribution.md) §2; transaction and lazy macros in [ADR 0001](adr/0001-state-sync-protocol.md) | `src/utils/layout-import.ts`, `src/store/layoutFileThunks.ts`, `tests/layout-import.test.ts`, `tests/state-sync-transport.test.ts`, `tests/save-load-pane.test.tsx`, `tests/era-definition.test.ts` |
| Distributed makers, board membership, published firmware files | `config/firmware-catalog.json`; family and identity come from `config/era-definitions.manifest.json` | `tests/firmware-distribution.test.tsx`, `scripts/validate-firmware-catalog.ts` in the build |

## 2. Definition inventory ownership

Inventory is source-owned and is not copied into this map.

| Concern | Canonical | Verification |
| --- | --- | --- |
| ERA definition membership, identity, split pairing, capability opt-in | `config/era-definitions.manifest.json` + referenced `era-definitions/custom/v3` JSON | `tests/era-definition.test.ts` |
| Managed external stock membership and identity | `config/external-definitions.manifest.json` + referenced `era-definitions/external/v3` JSON | `tests/validate-external-v3.test.ts` |
| Per-family menu support | definition JSON | `FEATURE_COVERAGE` in `tests/era-definition.test.ts` |
| Locale catalogs | `src/locales/*.json` | `tests/locales.test.ts` |
| ERA menu help catalog | `src/utils/era-feature-help.ts` | `tests/locales.test.ts`, `tests/custom-menu-pane.test.tsx` |

`brick65` is a durable product exception rather than an inventory count; its
requirements live in `docs/PROJECT_DIRECTION.md` **brick65**.

## 3. Wire and runtime ownership

Wire and storage requirements stay in the contracts that own them; this map
does not duplicate their addresses, ranges, packet layouts, or polling values.

| Concern | Contract owner | First app/source anchor | Verification |
| --- | --- | --- | --- |
| State Sync, exact-ms, legacy projection, Custom Menu invalidation | [ADR 0001](adr/0001-state-sync-protocol.md) | `src/utils/era-state-sync.ts`, `src/utils/era-exact-ms.ts`, `src/utils/ui-sync.ts` | `tests/era-state-sync.test.ts`, `tests/state-sync-transport.test.ts` |
| H7S current polling observation and diagnostics retirement | [ADR 0002](adr/0002-h7s-usb-diagnostics.md) | `src/utils/menu-observation.ts`, `src/store/menuObservationThunks.ts` | `tests/menu-observation.test.ts`, `tests/deferred-apply.test.ts` |
| Lighting sleep preset/exact/master compatibility | `docs/PROJECT_DIRECTION.md` **QMK lighting sleep exact-sec**, **H7S RGB sleep exact-sec**, **RGB Sleep master** | `era-definitions/custom/v3`, `src/utils/era-exact-sec.ts` | `tests/era-definition.test.ts`, `tests/custom-menu-pane.test.tsx` |
| VERSION display compatibility | [ADR 0003](adr/0003-era-menu-help-ui.md) | `src/utils/era-firmware-version.ts` | `tests/custom-menu-pane.test.tsx`, `tests/era-definition.test.ts` |

Do not invent a freshness decision outside this ownership:

| What | File |
| --- | --- |
| Per-WebHID-path listener, serial queue, pending matcher, connection generation | `src/utils/keyboard-api.ts`, `src/shims/node-hid.ts` |
| Freshness coordinator (observed/accepted revision, candidate commit) | `src/store/stateSyncThunks.ts`, `src/store/stateSyncSlice.ts`, `src/store/stateSyncCandidateActions.ts` |
| Device selection and connection lifecycle | `src/store/devicesThunks.ts`, `src/components/Home.tsx` |
| Where a domain candidate commits | `src/store/keymapSlice.ts`, `src/store/macrosSlice.ts`, `src/store/menusSlice.ts` |
| Custom pane availability | `getCustomMenuAvailabilityForDevice()` in `src/store/menusSlice.ts` |
| Definition-priority merge | `src/utils/definition-priority.ts` |
| Capability opt-in lookup | `src/utils/era-advanced-metadata.ts` |

## 4. Definition pipeline

```
era-definitions/custom/v3/**.json    ← ERA custom canonical (authored)
era-definitions/legacy/v3/**.json    ← frozen definitions for legacy identities (never edited)
config/era-definitions.manifest.json ← paths, VID/PID (+ extra and legacy identities), pair, capability opt-in
era-definitions/external/v3/**.json  ← fork-managed external stock V3 (authored)
config/external-definitions.manifest.json ← paths and VID/PID
node_modules/via-keyboards           ← pinned official snapshot (github:the-via/keyboards#79ae8d2 + patches/)
    src/**/*.json                    official V2 source
    v3/**/*.json                     official V3 source
        │
        │  scripts/build-keyboards.ts  →  node_modules/via-keyboards/scripts/build-all.ts
        ▼
public/definitions/
  v2/                  official V2 bundle as-is
  v3/                  official V3 bundle + non-colliding external stock definitions
  era/v3/              ERA overlay, one file per served identity (custom source, legacy frozen source)
  supported_kbs.json   full V2 plus V3 VPIDs that V2 does not have
  era_advanced.json    schemaVersion 2, per-definition runtime capability
  hash.json            cache-invalidation key (§7)
```

The deploy workflow's `Verify build output` checks the emitted definition sets
against their source owners and requires every official file to remain
byte-identical. Mismatch blocks upload.

Runtime lookup is **ERA overlay → bundled stock V3 (official + external) →
Design upload**,
implemented by `mergeDefinitionLookup()` and locked by the lookup matrix in
`tests/era-definition.test.ts`. Product rules for that order:
`docs/PROJECT_DIRECTION.md`.

`era-definitions/v3` (a stock clone tree) remains an **intentional absence**.
The curated `era-definitions/external/v3` tree is a separate, manifest-bound
exception for definitions this fork intentionally bundles; it is not a clone of
the official tree. The build rejects external/official and external/ERA VPID
collisions, then emits external definitions into the ordinary `/definitions/v3`
namespace so no parallel runtime loader exists.

`scripts/validate-external-v3.ts` remains the explicit, read-only adapter for
caller-owned release-audit paths. It runs the same authoritative V3 guard and
transform as the app without copying inputs. The managed external sources run
through that same contract in `tests/validate-external-v3.test.ts` and the
ordinary definition build. `tests/era-definition.test.ts` still forbids
cross-repository provenance fields returning on the ERA manifest.

```powershell
bun scripts/validate-external-v3.ts --format json -- <one-or-more JSON paths>
```

The command emits a canonical JSON array in input order, one result per path.
It returns nonzero for read, parse, schema, or transform failures and is not
part of the ordinary app build.

## 5. Verification commands and what they actually run

```powershell
bun test tests/docs-contract.test.ts
bun run test:transport
bun run test:p1
bun x tsc --noEmit
bun run build            # typecheck:scripts → build:kbs → tsc → vite build
```

- **PR CI runs `bun run build` and `bun run test:p1`.** `test:transport` and
  `bun x tsc --noEmit` are local gates.
  (`.github/workflows/pr-build.yml`)
- `tsc` inside `bun run build` uses `noEmit: true` in `tsconfig.json`, so it is
  also the typecheck.
- `bun run dev` rebuilds definitions before Vite. Do not treat a successful app
  build with empty or stale definition output as healthy.
- **`bun run build:kbs` deletes `dist/`.** `node_modules/via-keyboards/scripts/build-all.ts`
  calls `fs.remove('dist')` against cwd first. `bun run build` runs `build:kbs`
  first, which is fine; running `build:kbs` alone after a build to re-count
  definitions removes the `dist/` just produced.

## 6. Intentional dual copies — deleting one is a regression

These look like dead duplicates. Each pair is how official VIA and custom VIA
speak the same HID bytes. Product rules:
`docs/PROJECT_DIRECTION.md` (Tap Dance / exact-ms) and
[ADR 0001](adr/0001-state-sync-protocol.md) (legacy GET projection).

| Dual copy | Official | Custom |
| --- | --- | --- |
| tapping/TD term | legacy official presentation | exact integer presentation |
| Lighting sleep timeout (QMK RGB and backlight / H7S RGB) | shipped preset presentation | exact-seconds presentation of the same persisted timeout |
| Tap Dance keycodes | `CUSTOM(n)` in `customKeycodes` | `TD(n)` in `tapdanceKeycodes` — same `QK_KB_n` bytes |
| Tap Dance settings | TAPDANCE menu page for basic Legacy editing; advanced slots direct users to Custom | `controls` on each `tapdanceKeycodes` entry, edited from KEYMAP, including advanced settings; shared controls use the same Custom Value commands |
| Definition bundle | `/definitions/v3` | `/definitions/era/v3` |

Exact encodings, ranges, and family-specific ids are owned by
`docs/PROJECT_DIRECTION.md` and [ADR 0001](adr/0001-state-sync-protocol.md).
The durable rule here is only that the official and custom surfaces remain
compatible and converge on the same firmware-owned state.

## 7. Hand-maintained seams

Tests do not bite these. Touch one side, look at the other.

- **Routes ↔ `public/_redirects`.** Routes are canonical in `src/utils/pane-config.ts`,
  `src/components/panes/errors.tsx` and, for the firmware download routes,
  `src/utils/firmware-route.ts`; the deploy rewrite list is hand-matched.
  `/diagnostics` redirects to `/` in `src/Routes.tsx` but is absent from
  `_redirects`. In-app navigation works; a **cold deep link on the deploy host
  404s**. Observation placement is [ADR 0003](adr/0003-era-menu-help-ui.md).
- **`hash.json` is platform-dependent.** A different value is not a
  reproducibility break. The difference is the installed `via-keyboards`
  `officialHash` from its own build, which depends on file-walk order. The app
  uses the value only as a cache key; inside a deploy it must match
  `data-hash` on `index.html`.
- **`generatedAt` on `supported_kbs.json`.** Intentionally excluded from the
  content hash. If that is the only difference between two clean builds, that
  is expected.

## 8. Reference repositories

These paths exist only on this PC. **Do not edit, commit, flash, or push
without approval.** Do not write branch or HEAD here — they move; check at
session start.

| Path | Role |
| --- | --- |
| `D:\Engineering\qmk_firmware_eerraa` | QMK firmware (RP2040 + ATmega32U4). `keyboards/era/` |
| `D:\Engineering\eerraa-qmk-h7s-fw` | H7S firmware (main) |

- Opening an H7S repository: read **that** `AGENTS.md` first and follow it.
- Keep the app as cwd for app work. Treat a missing peer repository as
  unverified rather than inventing or recreating a worktree.

Cross-repository checks keep each owner/counterpart pair separate. A local PASS
does not promote an unchecked peer side to verified.

| Surface | Owner → counterpart | Verification in this repository | Still unverified here |
| --- | --- | --- | --- |
| Official VIA V3 registry | `the-via/keyboards` → bundled stock `/definitions/v3` | `scripts/build-keyboards.ts` plus deploy `Verify build output` | Firmware-local official-client JSON and publication on the official site |
| Firmware-local official-client JSON | peer repository `*-VIA.json` → official `usevia.app` | Explicit release-audit paths through `scripts/validate-external-v3.ts` check V3 parse/schema/transform | Ordinary CI does not pass arbitrary peer paths; runtime firmware behavior is not proved |
| ERA custom definition | `era-definitions/custom/v3` + `config/era-definitions.manifest.json` → app custom menu + matching firmware Custom Value handlers | `tests/era-definition.test.ts` checks local identity, menu support, addresses, and opt-in | Matching peer handlers, storage, and identity require paired firmware review |
| Coordinated wire | [ADR 0001](adr/0001-state-sync-protocol.md) / [ADR 0002](adr/0002-h7s-usb-diagnostics.md) + app encoders → peer firmware handlers | `tests/era-state-sync.test.ts`, `tests/state-sync-transport.test.ts`, `tests/era-usb-diagnostics.test.ts` | Peer revision, on-device transcript, and HIL remain separate evidence |

Firmware-local `*-VIA.json` files are therefore peer-owned release inputs, not
an app lookup source. Adding a feature still requires both official-client and
custom-app paths where the product contract requires them
(`docs/PROJECT_DIRECTION.md`).

## 9. Document rules

The adopted shared convention is declared once in `AGENTS.md`; this file does
not copy it. This repository adds:

- A repository path in a document that starts with `src/ tests/ config/
  era-definitions/ public/ scripts/ docs/ types/ patches/ .github/` must be a
  **real file in this repository**. Files in another repository take that
  repository's name as a prefix (`eerraa-qmk-h7s-fw/src/...`).
- Do not write dates, HEAD hashes, PIDs, PR numbers, or one-off verification
  results. `git log` and running the commands answer those.
- When stating a constraint, state **the cause of that constraint**. Without
  the cause, the next person has a pretext to bypass the rule. A commit is a
  change unit and a constraint is a contract unit; `git log` does not replace
  this.
- New persistent pointers prefer path + symbol/heading. If a legacy
  `path:line` citation remains, it must still name a line that exists.
- How to write or retire an ADR is [`docs/adr/README.md`](adr/README.md).
- Repository paths, links, script names, document scope declarations, legacy
  citations, and router reachability are checked by `tests/docs-contract.test.ts`.

The three-column Change / Locate / Verify index lives in `AGENTS.md`, not here.
