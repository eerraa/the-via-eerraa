# ERA VIA Fork — 에이전트 진입점

이 저장소는 `the-via/app`의 비공식 공개 포크다. 새 configurator도, 키보드 제조사 제품도
아니다. 이 파일이 에이전트의 단일 진입점이자 정본 지시 파일이다.

보고와 결정은 한국어로 한다.

## 1. 시작 전에

기록된 상태를 믿지 말고 직접 확인한다.

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
```

전부 읽지 마라. 하려는 일에 따라 읽는다. 행은 세 열이다 — **Change**(편집 전
필독) / **Locate**(조회) / **Verify**(빌드·캡처·판정). 세 열을 한 목록으로 합치지
않는다.

| 하려는 일 | Change | Locate | Verify |
| --- | --- | --- | --- |
| 무엇이 어디 있고 무엇이 정본인가 | `docs/MAP.md` — 여기부터 | `docs/MAP.md` | `tests/docs-contract.test.ts` |
| 제품 방향과 영구 금지사항 | `docs/PROJECT_DIRECTION.md` | — | `tests/docs-contract.test.ts` |
| 작은 UI·일반 앱 결함 | — (아래 계약을 바꾸면 해당 행으로 전환) | 편집 대상 `src/` 파일과 인접 테스트 | 인접 테스트; 타입 경계 변경 시 `bun x tsc --noEmit` |
| State Sync·exact-ms wire | `docs/adr/0001-state-sync-protocol.md` | `src/utils/era-state-sync.ts`, `src/utils/era-exact-ms.ts`, `src/store/stateSyncThunks.ts` | `tests/era-state-sync.test.ts`, `tests/state-sync-transport.test.ts` |
| H7S 현재 폴링 관측·진단 폐기 | `docs/adr/0002-h7s-usb-diagnostics.md` | `src/utils/menu-observation.ts`, `src/store/menuObservationThunks.ts` | `tests/menu-observation.test.ts`, `tests/deferred-apply.test.ts` |
| ERA 메뉴 설명과 진단 화면 UI | `docs/adr/0003-era-menu-help-ui.md` | `src/utils/era-feature-help.ts`, `src/utils/era-firmware-version.ts` | `tests/locales.test.ts`, `tests/custom-menu-pane.test.tsx`, `tests/diagnostics-pane.test.tsx`, `tests/era-definition.test.ts` |
| 펌웨어 배포 페이지·메이커 USB 식별 | `docs/adr/0004-firmware-distribution.md` | `config/firmware-catalog.json`, `src/utils/era-firmware-catalog.ts`, `src/utils/use-firmware-catalog.ts`, `src/utils/firmware-route.ts`, `src/components/panes/firmware.tsx`, `src/components/menus/external-links.tsx`, `src/components/panes/configure-panes/custom/firmware-version.tsx`, `src/utils/era-firmware-version.ts`, `scripts/validate-firmware-catalog.ts`, `config/era-definitions.manifest.json`, `public/_redirects` | `tests/firmware-distribution.test.tsx`, `tests/docs-contract.test.ts`, `tests/custom-menu-pane.test.tsx`, `tests/locales.test.ts` |
| 키코드 선택 팔레트·KEYMAP 탭댄스 편집 | `docs/PROJECT_DIRECTION.md`의 Tap Dance and exact-ms | `src/components/inputs/keycode-palette/keycode-palette.tsx`, `src/utils/keycode-palette.ts`, `src/components/inputs/pelpi/keycode-input.tsx`, `src/components/panes/configure-panes/keycode.tsx` | `tests/keycode-palette.test.ts`, `tests/keycode-palette-render.test.tsx`, `tests/transport-phase1.test.ts`, `tests/locales.test.ts` |
| 정의·공식 VIA 호환 감사 | `docs/PROJECT_DIRECTION.md`의 정의/호환 경계 | `config/era-definitions.manifest.json`, `config/external-definitions.manifest.json`, `era-definitions/custom/v3`; peer 짝은 `docs/MAP.md` §8 | `tests/era-definition.test.ts`, `tests/validate-external-v3.test.ts`; peer는 명시적 release audit |
| 공개 배포 | `docs/DEPLOYMENT.md` | `.github/workflows/deploy-to-cloudflare.yml`, `package.json`, `public/_redirects` | `bun run build` |
| 죽은 코드·은퇴 아키텍처 장부 | `docs/DEAD_CODE.md` | — | `tests/docs-contract.test.ts` |

## 2. 먼저 알아야 손해를 안 보는 것

조사로는 알기 어렵고, 모르면 시간을 잃는 것들이다.

- **`bun run lint`를 회귀 게이트로 취급하지 않는다.** upstream 포맷 차이와 Windows
  줄바꿈의 영향을 받는다. 변경 범위에 맞는 테스트·타입체크·빌드를 선택한다.
- 줄바꿈 정리를 이유로 사용자 변경을 되돌리거나 작업 트리를 정규화하지 않는다.
- 명령은 이 앱 저장소 root에서 실행한다. 펌웨어 저장소를 열어야 하면 그 저장소의
  `AGENTS.md`를 별도로 읽고, 이 앱 세션의 규칙과 섞지 않는다.
- 커밋 전에는 현재 `git status`, 관련 diff, 공백 오류를 다시 확인한다.

## 3. 검증

```powershell
bun test tests/docs-contract.test.ts
bun run test:transport
bun run test:p1
bun x tsc --noEmit
bun run build
```

변경 위험에 비례해 필요한 것만 돌린다. 문서만 고쳤으면 관련 문서 검사를 기본으로 하고,
문서 검사기나 제품 계약을 바꿨으면 그 영향 시험을 추가한다. 생성기·제품 소스가 바뀌지
않은 문서 변경에 전체 빌드나 실기기 검증을 요구하지 않는다. 실제 CI와 스크립트 구성은
`.github/workflows/`와 `package.json`이 소유한다.

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
  **Tap Dance 고급 설정만 예외다.** 복잡한 편집을 스톡 VIA에서 충분히 지원할 수 없으므로,
  스톡은 기본 Tap Dance만, Custom 앱은 고급 설정까지 지원한다. 상세 경계는
  `docs/PROJECT_DIRECTION.md`의 Tap Dance and exact-ms가 소유한다.
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
- 문서 작성 규칙의 공통 규약은 **eerraa-agent-docs v2**, commit
  `4bd84f45dd3e970bf25505059431058efbe7680a`의
  [`AGENT_DOCS_CONVENTION.md`](https://github.com/eerraa/eerraa-agent-docs/blob/4bd84f45dd3e970bf25505059431058efbe7680a/AGENT_DOCS_CONVENTION.md)다.
  일반 개발은 이 로컬 진입만으로 시작하고 중앙 규약은 문서체계 변경·신규 채택·버전
  업그레이드 때만 확인한다. 이 저장소의 경로·링크·검사 포인터 규칙은 `docs/MAP.md` §9가
  소유한다.
