# ERA VIA Fork — data map

Genre: map
Canonical for: which fact lives where in this repository, which side wins on
conflict, and what bites the mismatch — definition inventory, wire addresses,
build outputs, verification commands, reference repositories, and this
repository's additions to the shared document convention

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
| Which board has which feature | the same JSON | `FEATURE_COVERAGE` in that file |
| Per-board capability opt-in (state sync / exact-ms / diagnostics / split pair) | `config/era-definitions.manifest.json` | `tests/era-definition.test.ts` |
| Official VIA V3 definitions | `the-via/keyboards` — the installed `node_modules/via-keyboards` is a pinned snapshot only | `Verify build output` in the deploy workflow |
| Wire selector values and envelopes | `src/utils/era-state-sync.ts`, `src/utils/era-usb-diagnostics.ts` | `tests/era-state-sync.test.ts`, `tests/era-usb-diagnostics.test.ts`, `tests/state-sync-transport.test.ts` |
| What the diagnostics screen may and must not say | `src/locales/*.json` | `DIAGNOSTIC_OBSERVATION_KEYS` in `tests/locales.test.ts` |
| ERA menu help copy and attach targets | `src/utils/era-feature-help.ts` | `tests/locales.test.ts`, `tests/custom-menu-pane.test.tsx` |
| App route list | `src/utils/pane-config.ts`, `src/components/panes/errors.tsx` | none — `public/_redirects` is hand-matched (§7) |
| Counts in this document and paths it names | all of the sources above | `tests/docs-contract.test.ts` |

The last row is the genre of this file. **This document is a derivative.** It is
not a place to hand-edit numbers into agreement; if they disagree with values
computed from code, the test goes red.

## 2. Definition inventory

`tests/docs-contract.test.ts` recomputes the values below from the manifest
(and, for the last two rows, from the locale catalogs and `eraMenuSummaries`).

| Item | Value |
| --- | --- |
| ERA custom definitions | **31** |
| ├ QMK (RP2040 + ATmega32U4) | 26 |
| └ H7S | 5 |
| State Sync opt-in (`stateSync: true`) | 30 |
| exact-ms `qmk` family (`options: [1, 65535]`) | 25 |
| exact-ms `h7s` family (`options: [100, 500]`) | 5 |
| USB diagnostics opt-in (`usbDiagnostics: true`) | 5 |
| split pair entries (left/right each) | 6 |
| Locales | 6 (`de en es ja ko zh`), 605 keys each |
| ERA menu summaries | 16 |

Only `brick65` has no opt-in. That is the durable ATmega32U4 stock-VIA exception
in `docs/PROJECT_DIRECTION.md`, not a defect.

Per-family menu coverage is `FEATURE_COVERAGE` in `tests/era-definition.test.ts`.
The table exists because `TOMAK79H` shipped without `MOUSE`, `NKRO`, or
`SPLIT LINK` in its custom definition while its official VIA JSON and both
sibling splits had all three, and nothing failed — no test asked. Adding a
keyboard or a feature means editing that table on purpose.

## 3. Wire addresses

No new top-level command. Envelope layouts, SET range, encode/decode, legacy
GET projection, and refused alternatives are
[ADR 0001](adr/0001-state-sync-protocol.md) and
[ADR 0002](adr/0002-h7s-usb-diagnostics.md). This table is location only.

| Address | What | App source | Contract |
| --- | --- | --- | --- |
| `GET_KEYBOARD_VALUE 0x02` + selector `0x06` | State Sync revision envelope v1 | `src/utils/era-state-sync.ts` | [ADR 0001](adr/0001-state-sync-protocol.md) |
| `0x02`/`SET_KEYBOARD_VALUE 0x03` + selector `0x07` | H7S USB diagnostics session v1 | `src/utils/era-usb-diagnostics.ts` | [ADR 0002](adr/0002-h7s-usb-diagnostics.md) |
| `0x16` v1 | upstream Custom Menu invalidation hint. Do not change its meaning | `src/utils/ui-sync.ts` | [ADR 0001](adr/0001-state-sync-protocol.md) |

exact-ms channel and value ids differ by family. The checker re-reads them from
custom JSON `_term_exact` `content`.

| Control | QMK | H7S |
| --- | --- | --- |
| Global TAPPING term | channel 15 / value 5 | channel 15 / value 5 |
| TD0–TD7 term | channel 0 / value 72–79 | channel 16 / value 41–48 |
| MOUSE menu channel | 13 | **17** — on H7S, channel 13 is USB POLLING (`id_qmk_usb_bootmode`) |
| SOCD command prefix | `id_qmk_socd_` | `id_qmk_kill_switch_` |

State Sync poll interval is `ERA_STATE_SYNC_POLL_INTERVAL_MS = 500`.

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
config/era-definitions.manifest.json ← paths, VID/PID, pair, capability opt-in
node_modules/via-keyboards           ← pinned official snapshot (github:the-via/keyboards#79ae8d2 + patches/)
    src/**/*.json   1,484            official V2 source
    v3/**/*.json    2,003            official V3 source
        │
        │  scripts/build-keyboards.ts  →  node_modules/via-keyboards/scripts/build-all.ts
        ▼
public/definitions/
  v2/, v3/             official bundle as-is. Preserve even when an ERA VPID collides
  era/v3/              ERA overlay. File count must equal the definition count in §2
  supported_kbs.json   full V2 plus V3 VPIDs that V2 does not have
  era_advanced.json    schemaVersion 2, per-definition runtime capability
  hash.json            cache-invalidation key (§7)
```

The deploy workflow's `Verify build output` requires
`dist/definitions/era/v3` count == custom source count and
`dist/definitions/v3` count == `node_modules/via-keyboards/v3` count.
Mismatch blocks upload.

Runtime lookup is **ERA overlay → official snapshot → Design upload**,
implemented by `mergeDefinitionLookup()` and locked by the lookup matrix in
`tests/era-definition.test.ts`. Product rules for that order:
`docs/PROJECT_DIRECTION.md`.

`era-definitions/v3` (a stock clone tree) and a remote firmware verifier are
**intentional absences**. `tests/era-definition.test.ts` forbids provenance
fields returning on the manifest.

## 5. Verification commands and what they actually run

```powershell
bun run test:transport   # 7 files, 0 fail — transport, State Sync, diagnostics, custom-menu layout
bun run test:p1          # 7 files, 0 fail — definitions, locales, picker, layout macros, ms input, diagnostic records, docs contract
bun x tsc --noEmit       # 0
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
- `tests/deferred-apply.test.ts` is in **no script.** Run it directly.
  `tests/docs-contract.test.ts` locks that set, so it cannot grow quietly.

## 6. Intentional dual copies — deleting one is a regression

These look like dead duplicates. Each pair is how official VIA and custom VIA
speak the same HID bytes. Product rules:
`docs/PROJECT_DIRECTION.md` (Tap Dance / exact-ms) and
[ADR 0001](adr/0001-state-sync-protocol.md) (legacy GET projection).

| Dual copy | Official | Custom |
| --- | --- | --- |
| tapping/TD term | legacy 1-byte × 10 ms, 100–500 / 20 ms grid | exact 2-byte `uint16` |
| Tap Dance keycodes | `CUSTOM(n)` in `customKeycodes` | `TD(n)` in `tapdanceKeycodes` — same `QK_KB_n` bytes |
| Definition bundle | `/definitions/v3` | `/definitions/era/v3` |

## 7. Hand-maintained seams

Tests do not bite these. Touch one side, look at the other.

- **Routes ↔ `public/_redirects`.** Routes are canonical in `src/utils/pane-config.ts`
  and `src/components/panes/errors.tsx`; the deploy rewrite list is hand-matched.
  `/diagnostics` redirects to `/` in `src/Routes.tsx` but is absent from
  `_redirects`. In-app navigation works; a **cold deep link on the deploy host
  404s**. Inline placement is [ADR 0003](adr/0003-era-menu-help-ui.md).
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
| `D:\Engineering\eerraa-qmk-h7s-fw-via`, `...-via2` | H7S working worktrees |

- Opening an H7S repository: read **that** `AGENTS.md` first and follow it.
- Opening a session with a firmware repository as cwd caused that repo's rules
  to run `graphify update .` and commit `graphify-out/` into this app
  repository. **Keep cwd on the app.**
- Firmware `*-VIA.json` files are firmware-local copies, not an app lookup
  source. Adding a feature still requires **both sides** — a custom-app-only
  path is an error (`docs/PROJECT_DIRECTION.md`).
- With the remote firmware verifier removed, CI will not catch
  cross-repository drift if firmware wire/identity and app custom JSON change
  separately. A release that changes both needs a local compatibility audit.

## 9. Document rules

The shared convention (two-line header, five genres, three-column index,
minimum checks path · header · index · citation) is
[eerraa-agent-docs](https://github.com/eerraa/eerraa-agent-docs) tag **v1**
[`AGENT_DOCS_CONVENTION.md`](https://github.com/eerraa/eerraa-agent-docs/blob/v1/AGENT_DOCS_CONVENTION.md).
This file does not copy that spec. This repository adds:

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
- A `path:line` address in a document must name a line that exists. Line
  numbers go silently wrong the moment a line is inserted above them.
- How to write or retire an ADR is [`docs/adr/README.md`](adr/README.md).
- Paths, constants, links, scripts, and the v1-required path · header · index
  · citation checks are in `tests/docs-contract.test.ts`. A document that no
  router can reach also fails.

The three-column Change / Locate / Verify index lives in `AGENTS.md`, not here.
