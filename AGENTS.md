# ERA VIA Fork agent entry

## Read first

Before architecture or source work, read `docs/PROJECT_DIRECTION.md`. Read relevant records under `docs/adr/` when they exist. These tracked documents are authoritative for durable project decisions; `D:\Engineering\the-via-eerraa-HANDOVER.md` contains only transient local-session state.

Verify the live branch, HEAD, working tree, remotes, development server, and reference repositories instead of trusting recorded runtime status.

### 2026-08-25 — `main` 히스토리를 다시 썼다 (한시적 안내)

`main`은 문서 전용 커밋 13개를 인접 작업 커밋에 합쳐 63커밋에서 46커밋으로 리베이스됐고
force-push 됐다. **파일 내용은 1바이트도 바뀌지 않았다**(트리 해시 `301e0b20…` 동일).
합쳐진 커밋의 제목은 흡수한 커밋 본문에 목록으로 남아 있으므로 `git log --grep`으로
옛 제목을 찾을 수 있다.

리라이트 이전 히스토리 전체는 태그 **`backup/main-before-rewrite`**(`e775278`)에 있다.
로컬과 `origin` 양쪽에 있다. 이 커밋은 `main`에서 도달할 수 없으므로 `git log`에는
나타나지 않는다 — 보려면 `git log backup/main-before-rewrite` 또는 `git log --all`.

- 옛 해시로 무언가를 찾고 있다면 그 태그에서 찾아라.
- 삭제된 원격 브랜치 39개(포크 상속 37 + `fix/pages-spa-rewrite`, `goal/era-via-release`)의
  커밋도 이 태그에서 도달 가능하다. 포크 상속분은 `upstream` 리모트에도 그대로 있다.
- 되돌리려면 `git reset --hard backup/main-before-rewrite && git push --force origin main`.

**이 절은 한시적이다.** 리라이트 이후 작업이 자리를 잡아 옛 해시를 찾을 일이 없어지면
태그와 함께 이 절을 지워라(`git tag -d`, `git push origin :refs/tags/...`).

## Project contract

- This is a public direct fork of `the-via/app`, not a new configurator or a keyboard-manufacturer product.
- Preserve VIA's visual language, normal workflows, VIA V3 definitions, and existing commands for ordinary VIA keyboards.
- Firmware is authoritative for keyboard state. Do not mirror an intended split change into a peer UI cache before that peer has committed it and can return the value.
- Prefer existing VIA GET/SET and V3 Custom Value paths. Add state synchronization as invalidation plus authoritative readback, not a second value protocol.
- Architectural refactoring is allowed when evidence shows VIA core prevents correctness or maintainability. Minimize accidental scope, not necessary design quality.
- Keep configurator control traffic out of the 8 kHz input hot path.

## Repository boundaries

- ERA custom definition source is `era-definitions/custom/v3` (`tapdanceKeycodes` and optional `customKeycodes`). Official VIA JSON is canonically owned by `the-via/keyboards` under `v3/`; the installed `via-keyboards` package is this app's pinned build snapshot. QMK/H7S firmware-local JSON is not an app lookup source. Lookup is ERA overlay, then official snapshot, then Design upload only when neither built-in source supports the VPID. Do not maintain an app-side stock clone. Generated `public/definitions` and `dist` output are not canonical source.
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
bun run build
bun run dev -- --host 127.0.0.1
```

`bun run dev` rebuilds keyboard definitions before starting Vite. Do not treat a successful app build with empty or stale definition output as valid.
