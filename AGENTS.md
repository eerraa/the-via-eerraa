# ERA VIA Fork agent entry

## Read first

Before architecture or source work, read `docs/PROJECT_DIRECTION.md`. Read relevant records under `docs/adr/` when they exist. These tracked documents are authoritative for durable project decisions; `D:\Engineering\the-via-eerraa-HANDOVER.md` contains only transient local-session state.

Verify the live branch, HEAD, working tree, remotes, development server, and reference repositories instead of trusting recorded runtime status.

## Project contract

- This is a public direct fork of `the-via/app`, not a new configurator or a keyboard-manufacturer product.
- Preserve VIA's visual language, normal workflows, VIA V3 definitions, and existing commands for ordinary VIA keyboards.
- Firmware is authoritative for keyboard state. Do not mirror an intended split change into a peer UI cache before that peer has committed it and can return the value.
- Prefer existing VIA GET/SET and V3 Custom Value paths. Add state synchronization as invalidation plus authoritative readback, not a second value protocol.
- Architectural refactoring is allowed when evidence shows VIA core prevents correctness or maintainability. Minimize accidental scope, not necessary design quality.
- Keep configurator control traffic out of the 8 kHz input hot path.

## Repository boundaries

- ERA definition source: `era-definitions/v3` in this repository. Generated `public/definitions` and `dist` output are not canonical source.
- `D:\Engineering\qmk_firmware_eerraa` and `D:\Engineering\eerraa-qmk-h7s-fw` are reference repositories until the user approves a reported firmware change plan. Never modify an existing dirty firmware worktree; use an approved branch/worktree.
- When working in H7S, read and follow that repository's own `AGENTS.md` before inspection or modification.
- Do not connect Cloudflare, change DNS, purchase domains, push reference firmware, copy Vial code, or freeze a new wire protocol without explicit user approval.
- Preserve unrelated user changes. Do not perform broad formatting or refactors unrelated to the active task.

## Working conventions

- Communicate findings and decisions in Korean.
- Lead technical choices with evidence and one recommendation; do not hand routine web implementation decisions back to the user.
- For protocol or firmware changes, report the need, both-side changes, compatibility, failure handling, and test plan before implementation.
- Record durable architectural decisions in `docs/PROJECT_DIRECTION.md` or a concise ADR. Keep branch/process/next-step status in the external handover.
- After source changes, run validation proportional to risk and leave the loopback Vite server running. Confirm `http://127.0.0.1:5173` responds before handoff.

## Common commands

```powershell
bun install --frozen-lockfile
bun run verify:firmware-contracts
bun run build
bun run dev -- --host 127.0.0.1
```

`bun run verify:firmware-contracts` checks lock `repository` + full commit SHA + path against immutable bytes. It never uses a dirty working tree. Local clones are selected with `ERA_FIRMWARE_LOCAL_ROOTS` JSON, `ERA_FIRMWARE_<SOURCE_ID>_ROOT`, or gitignored `config/era-firmware-sources.local.json`; the clone must contain that commit object and a remote that names the lock repository. Otherwise it fetches GitHub raw, using `GITHUB_TOKEN`/`GH_TOKEN` when the repository is private. Do not "fix" a 404 by pointing the lock at a different commit.

`bun run dev` rebuilds keyboard definitions before starting Vite. Do not treat a successful app build with empty or stale definition output as valid.
