# ERA VIA Fork — 에이전트 진입점

이 저장소는 `the-via/app`의 비공식 공개 포크다. 새 configurator도, 키보드 제조사 제품도
아니다. 이 파일이 정본 지시 파일이고 `CLAUDE.md`는 여기로 보내는 포인터다.

보고와 결정은 한국어로 한다.

## 1. 시작 전에

기록된 상태를 믿지 말고 직접 확인한다.

```powershell
git status --short
git log --oneline -3
bun install --frozen-lockfile
```

전부 읽지 마라. 하려는 일에 따라 읽는다. 행은 세 열이다 — **Change**(편집 전
필독) / **Locate**(조회) / **Verify**(빌드·캡처·판정). 세 열을 한 목록으로 합치지
않는다.

| 하려는 일 | Change | Locate | Verify |
| --- | --- | --- | --- |
| 무엇이 어디 있고 무엇이 정본인가 | `docs/MAP.md` — 여기부터 | `docs/MAP.md` | `tests/docs-contract.test.ts` |
| 제품 방향과 영구 금지사항 | `docs/PROJECT_DIRECTION.md` | — | `tests/docs-contract.test.ts` |
| State Sync·exact-ms wire | `docs/adr/0001-state-sync-protocol.md` | `docs/MAP.md` §3 | `tests/era-state-sync.test.ts`, `tests/state-sync-transport.test.ts` |
| H7S USB 진단 wire·계측 | `docs/adr/0002-h7s-usb-diagnostics.md` | `docs/MAP.md` §3 | `tests/era-usb-diagnostics.test.ts` |
| ERA 메뉴 설명과 진단 화면 UI | `docs/adr/0003-era-menu-help-ui.md` | `docs/MAP.md` §1 | `tests/locales.test.ts`, `tests/custom-menu-pane.test.tsx` |
| 공개 배포 | `docs/DEPLOYMENT.md` | `docs/MAP.md` §5·§7 | `bun run build` |

## 2. 먼저 알아야 손해를 안 보는 것

조사로는 알기 어렵고, 모르면 시간을 잃는 것들이다.

- **`bun run lint`는 게이트가 아니다.** `prettier --check`가 `src/**` 257개 파일 전부에서
  실패한다. 이 워크트리는 `core.autocrlf=true`라 내용은 맞고 줄바꿈만 CRLF이기 때문이다.
  CRLF를 벗겨도 106개는 여전히 실패한다 — upstream에서 물려받은 포맷 차이다.
  즉 실패가 기준선이므로 회귀 신호로 쓸 수 없다. `tests/`는 lint glob에 들어 있지도 않다.
  실제 게이트는 §3의 네 명령뿐이다.
- **`git checkout --`으로 파일을 되돌리면 autocrlf가 CRLF로 되돌려 놓는다.** 되돌린 뒤
  줄바꿈이 바뀐 것처럼 보이는 것은 정상이고, `git diff`는 정규화 후 비교하므로 깨끗하다.
- **PR CI는 `bun run build` 하나만 돈다.** 테스트를 돌리지 않는다. 커밋 전에 로컬에서
  §3을 직접 돌려야 한다.
- **cwd를 이 앱 저장소에 둔다.** 펌웨어 저장소를 cwd로 세션을 열면 그쪽 규칙이
  `graphify update .`를 걸고, 과거에 그 경로로 이 저장소에 `graphify-out/` 75,000줄이
  잘못 커밋된 사고가 있다.
- **편집기에 열려 있던 파일이 저장되며 작업을 덮어쓴 사고가 있었다.** 커밋 전에
  `git status`와 `git diff --stat`을 본다.

## 3. 검증

```powershell
bun run test:transport   # 7개 파일, 0 fail
bun run test:p1          # 6개 파일, 0 fail
bun x tsc --noEmit       # 0
bun run build            # ERA 정의 31종
```

변경 위험에 비례해 돌린다. 소스를 고쳤으면 네 개 모두, 문서만 고쳤으면 최소한
`bun run test:p1`(문서–코드 정합 테스트가 여기 있다)은 돌린다.

앱을 띄운 채로 넘길 때는 loopback Vite를 남기고 `http://127.0.0.1:5173`이 응답하는지
확인한다: `bun run dev -- --host 127.0.0.1`.

## 4. 제품 계약

- 일반 VIA 키보드의 시각 언어, 통상 workflow, VIA V3 정의, 기존 명령을 보존한다.
- **펌웨어가 키보드 상태의 authority다.** 아직 반영하지 못한 split peer의 값을 다른 쪽
  UI 캐시에 미리 써 넣지 않는다.
- 기존 VIA GET/SET과 V3 Custom Value 경로를 우선한다. 상태 동기화는 두 번째 값 프로토콜이
  아니라 무효화 + 권위 있는 재조회로 만든다.
- **커스텀 앱만 말할 수 있는 경로는 오류다.** 펌웨어는 공식 `usevia.app` + 공식 V3 정의로
  계속 동작해야 한다. 기능을 추가하면 앱 정의와 펌웨어 공식 JSON 양쪽에 넣는다.
- configurator 제어 트래픽을 8 kHz 입력 hot path에 넣지 않는다.
- VIA core가 정확성이나 유지보수성을 실제로 막는다는 증거가 있으면 리팩터링해도 된다.
  upstream diff 최소화는 그 자체가 목적이 아니다. 다만 필요 없는 범위는 늘리지 않는다.

## 5. 경계

- ERA 커스텀 정의의 정본은 `era-definitions/custom/v3`다. 생성된 `public/definitions`와
  `dist`는 정본이 아니다. 자세한 소유권은 `docs/MAP.md` §1·§4.
- 펌웨어 저장소는 승인 전까지 read-only 참조다. dirty 워크트리를 절대 건드리지 않는다.
  경로와 규칙은 `docs/MAP.md` §8.
- Cloudflare 연결, DNS 변경, 도메인 구매, 참조 펌웨어 push, Vial 코드 복사, 새 wire
  프로토콜 확정은 명시적 승인 대상이다.
- 관계없는 사용자 변경을 보존한다. 작업과 무관한 광범위 포맷팅·리팩터링을 하지 않는다.

## 6. 작업 관습

- 기술 선택은 근거와 **하나의 권고**로 제시한다. 통상적인 웹 구현 판단을 사용자에게
  되돌려 묻지 않는다.
- 프로토콜·펌웨어 변경은 구현 전에 필요성, 양쪽 변경, 호환성, 실패 처리, 테스트 계획을
  보고한다.
- 지속되는 결정은 `docs/PROJECT_DIRECTION.md`나 간결한 ADR에 남긴다. 진행 상태·브랜치·
  다음 할 일은 어디에도 기록하지 않는다 — `git log`와 실행이 답한다.
- 문서 작성 규칙의 공통 규약은
  [eerraa-agent-docs](https://github.com/eerraa/eerraa-agent-docs) 태그 **v1**의
  [`AGENT_DOCS_CONVENTION.md`](https://github.com/eerraa/eerraa-agent-docs/blob/v1/AGENT_DOCS_CONVENTION.md)다.
  이 저장소가 보태는 것(경로 접두사, 상수, 링크, 스크립트)은 `docs/MAP.md` §9에 있다.
  루트 `AGENTS.md`·`CLAUDE.md`는 진입 사슬이므로 헤더를 갖지 않는다 — 그것도 v1이 정한다.

## 7. `main` 히스토리를 다시 썼다 (한시적 안내)

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
