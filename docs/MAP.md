# ERA VIA Fork — 데이터 맵

Genre: map
Canonical for: 이 저장소의 정본 규칙 — 어떤 사실이 어디에 살고, 두 곳이 어긋났을 때 어느 쪽이 이기며,
그것을 무는 것이 무엇인가. 정의 인벤토리, wire 주소, 빌드 산출물, 검증 명령, 참조
저장소, 문서 규칙

이 문서는 **무엇이 어디에 있고, 두 곳이 어긋났을 때 어느 쪽이 정본인가**만 답한다.
결정의 근거는 `docs/adr/`, 제품 방향은 `docs/PROJECT_DIRECTION.md`, 이력은 `git log`에 있다.
여기에는 날짜·세션 서사·진행 상태를 쓰지 않는다.

## 1. 정본 규칙

같은 사실을 두 곳이 들고 있으면 아래 표의 **정본** 열이 이긴다.
문서가 정본과 다르면 **문서를 고친다.** 반대가 맞다고 판단되면 고치지 말고 보고한다.

| 사실 | 정본 | 그 정본을 무는 것 |
| --- | --- | --- |
| ERA 커스텀 정의의 내용 (메뉴·컨트롤·주소·라벨) | `era-definitions/custom/v3/` 아래 JSON | `tests/era-definition.test.ts` |
| 어느 보드가 어떤 기능을 갖는가 | 같은 JSON | 같은 파일의 `FEATURE_COVERAGE` 표 |
| 보드별 capability opt-in (state sync / exact-ms / diagnostics / split pair) | `config/era-definitions.manifest.json` | `tests/era-definition.test.ts` |
| 공식 VIA V3 정의 | `the-via/keyboards` — 설치본 `node_modules/via-keyboards`는 핀된 스냅샷일 뿐 | 배포 워크플로의 `Verify build output` |
| wire selector 값·엔벌로프 | `src/utils/era-state-sync.ts`, `src/utils/era-usb-diagnostics.ts` | `tests/era-state-sync.test.ts`, `tests/era-usb-diagnostics.test.ts`, `tests/state-sync-transport.test.ts` |
| 진단 화면이 말해도 되는 것 / 안 되는 것 | `src/locales/*.json` | `tests/locales.test.ts`의 `DIAGNOSTIC_OBSERVATION_KEYS` |
| ERA 메뉴 설명 문구와 부착 대상 | `src/utils/era-feature-help.ts` | `tests/locales.test.ts`, `tests/custom-menu-pane.test.tsx` |
| 앱 라우트 목록 | `src/utils/pane-config.ts`, `src/components/panes/errors.tsx` | 없음 — `public/_redirects`는 손으로 맞춰야 한다 (§7) |
| 이 문서의 숫자와 문서가 가리키는 경로 | 위 소스 전부 | `tests/docs-contract.test.ts` |

마지막 줄이 이 문서의 성격을 정한다. **이 문서는 파생물이다.** 숫자를 손으로 고쳐 맞추는
곳이 아니라, 코드에서 계산한 값과 다르면 테스트가 빨개지는 곳이다.

## 2. 정의 인벤토리

`tests/docs-contract.test.ts`가 아래 값을 매니페스트에서 다시 계산해 대조한다.

| 항목 | 값 |
| --- | --- |
| ERA 커스텀 정의 | **31** |
| ├ QMK (RP2040 + ATmega32U4) | 26 |
| └ H7S | 5 |
| State Sync opt-in (`stateSync: true`) | 30 |
| exact-ms `qmk` 계열 (`options: [1, 65535]`) | 25 |
| exact-ms `h7s` 계열 (`options: [100, 500]`) | 5 |
| USB 진단 opt-in (`usbDiagnostics: true`) | 5 |
| split pair 항목 (좌/우 각각) | 6 |
| 로케일 | 6 (`de en es ja ko zh`), 각 605 키 |
| ERA 메뉴 요약 | 16 |

31 중 유일하게 아무 opt-in도 없는 것이 `brick65`다. ATmega32U4 28,672 B 플래시 예산 때문에
순정 VIA만 제공하며 FEATURE 메뉴 자체가 없다. 고장이 아니라 영구 예외다.

계열별 메뉴 분포는 `tests/era-definition.test.ts`의 `FEATURE_COVERAGE`가 정본이다.
요지만 옮기면: `NKRO`와 `EEPROM 초기화`는 H7S에 0건, `USB POLLING`과 `VERSION`은 RP2040에 0건,
`SPLIT LINK`/`SPLIT SYNC`/`Badge Lighting`은 스플릿 3종(좌우 6개)에만 있다.

그 표가 존재하는 이유를 지우지 마라. **TOMAK79H는 이 저장소 내내 커스텀 정의에서
`MOUSE`·`NKRO`·`SPLIT LINK`가 빠진 채로 배포됐다.** 자기 공식 VIA JSON과 두 형제 스플릿
보드는 셋 다 갖고 있었는데도 아무것도 실패하지 않았다 — "어느 정의가 어느 기능을 갖는가"를
묻는 테스트가 없었기 때문이다. 정의는 펌웨어가 지원하는 메뉴를 조용히 빠뜨릴 수 있고, 그
손해는 커스텀 앱 사용자만 본다. 키보드나 기능을 추가한다는 것은 그 표를 **의도적으로**
고친다는 뜻이다.

## 3. wire 주소

앱이 보내는 것은 전부 기존 VIA 명령이다. 새 top-level command는 하나도 만들지 않았다.

| 주소 | 무엇 | 앱 소스 | 계약 |
| --- | --- | --- | --- |
| `GET_KEYBOARD_VALUE 0x02` + selector `0x06` | State Sync revision 봉투 v1 | `src/utils/era-state-sync.ts` | [ADR 0001](adr/0001-state-sync-protocol.md) |
| `0x02`/`SET_KEYBOARD_VALUE 0x03` + selector `0x07` | H7S USB 진단 세션 v1 | `src/utils/era-usb-diagnostics.ts` | [ADR 0002](adr/0002-h7s-usb-diagnostics.md) |
| `0x16` v1 | upstream Custom Menu invalidation hint. 의미를 바꾸지 않는다 | `src/utils/ui-sync.ts` | [ADR 0001](adr/0001-state-sync-protocol.md) |

exact-ms 값 주소 — 2 B big-endian `uint16`. 채널·value id는 계열마다 다르다.

| 컨트롤 | QMK | H7S |
| --- | --- | --- |
| 글로벌 TAPPING term | 채널 15 / value 5 | 채널 15 / value 5 |
| TD0–TD7 term | 채널 0 / value 72–79 | 채널 16 / value 41–48 |
| SET 허용 범위 | 1–65535 | 100–500 |
| MOUSE 메뉴 채널 | 13 | **17** — H7S에서는 13번을 USB POLLING이 점유한다 |
| SOCD command 접두사 | `id_qmk_socd_` | `id_qmk_kill_switch_` |

State Sync poll 간격은 `ERA_STATE_SYNC_POLL_INTERVAL_MS = 500`이다.

이 계약을 실제로 소유하는 코드는 다음과 같다. 여기 없는 곳에 freshness 판단을 새로
만들지 마라.

| 무엇 | 파일 |
| --- | --- |
| WebHID path별 listener·직렬 queue·pending matcher·connection generation | `src/utils/keyboard-api.ts`, `src/shims/node-hid.ts` |
| freshness coordinator (observed/accepted revision, candidate commit) | `src/store/stateSyncThunks.ts`, `src/store/stateSyncSlice.ts`, `src/store/stateSyncCandidateActions.ts` |
| device 선택·연결 수명주기 | `src/store/devicesThunks.ts`, `src/components/Home.tsx` |
| domain candidate가 커밋되는 곳 | `src/store/keymapSlice.ts`, `src/store/macrosSlice.ts`, `src/store/menusSlice.ts` |
| Custom pane 가용성 판정 | `src/store/menusSlice.ts`의 `getCustomMenuAvailabilityForDevice()` |
| 정의 우선순위 병합 | `src/utils/definition-priority.ts` |
| capability opt-in 조회 | `src/utils/era-advanced-metadata.ts` |

## 4. 정의 파이프라인

```
era-definitions/custom/v3/**.json    ← ERA 커스텀 정본 (사람이 쓴다)
config/era-definitions.manifest.json ← 경로·VID/PID·pair·capability opt-in
node_modules/via-keyboards           ← 공식 핀 스냅샷 (github:the-via/keyboards#79ae8d2 + patches/)
    src/**/*.json   1,484            공식 V2 원본
    v3/**/*.json    2,003            공식 V3 원본
        │
        │  scripts/build-keyboards.ts  →  node_modules/via-keyboards/scripts/build-all.ts
        ▼
public/definitions/
  v2/, v3/             공식 번들 그대로. ERA와 VPID가 겹쳐도 반드시 보존한다
  era/v3/              ERA overlay. 파일 수는 §2의 정의 수와 같아야 한다
  supported_kbs.json   V2 전체 + v2에 없는 V3 VPID만 담은 인덱스
  era_advanced.json    schemaVersion 2, 정의별 런타임 capability
  hash.json            캐시 무효화 키 (§7)
```

배포 워크플로의 `Verify build output`이 `dist/definitions/era/v3` 수 == 커스텀 소스 수,
`dist/definitions/v3` 수 == `node_modules/via-keyboards/v3` 수를 강제한다. 어긋나면 업로드가
일어나지 않는다.

런타임 lookup 우선순위는 **ERA overlay → 공식 스냅샷 → Design 업로드**다. 업로드는 앞의 두
built-in source를 덮지 못한다. `mergeDefinitionLookup()`이 구현이고
`tests/era-definition.test.ts`의 lookup 행렬 두 건이 그 계약을 문다.

`era-definitions/v3`(순정 복제 트리)와 원격 firmware verifier는 **만들지 않기로 한 것**이다.
부재 자체가 계약이며 `tests/era-definition.test.ts`가 매니페스트에 provenance 필드가
되살아나지 않는지 검사한다.

## 5. 검증 명령과 실제로 도는 것

```powershell
bun run test:transport   # 7개 파일, 0 fail — 전송·State Sync·진단·커스텀 메뉴 배치
bun run test:p1          # 6개 파일, 0 fail — 정의·로케일·피커·ms 입력·진단 기록·문서 정합
bun x tsc --noEmit       # 0
bun run build            # typecheck:scripts → build:kbs → tsc → vite build
```

- **PR CI는 `bun run build` 하나만 돈다.** 테스트는 로컬 전용 게이트다.
  (`.github/workflows/pr-build.yml`)
- `bun run build`의 `tsc`는 `tsconfig.json`의 `noEmit: true`를 쓰므로 타입 검사를 겸한다.
- `bun run dev`는 Vite 전에 정의를 다시 만든다. 정의 출력이 비었거나 낡은 채로 앱 빌드가
  성공한 것을 정상으로 보지 마라.
- **`bun run build:kbs`는 `dist/`를 지운다.** `node_modules/via-keyboards/scripts/build-all.ts`가
  cwd 기준으로 `fs.remove('dist')`를 먼저 부르기 때문이다. `bun run build`는 `build:kbs`를
  먼저 돌리므로 정상이지만, 빌드한 뒤에 정의 수를 다시 세려고 `build:kbs`만 실행하면
  방금 만든 `dist/`가 사라진다.
- `tests/deferred-apply.test.ts`는 **어느 스크립트에도 없다.** 직접 실행해야 돈다.
  `tests/docs-contract.test.ts`가 이 사실을 목록으로 잠그고 있으므로 조용히 늘어나지는 않는다.

## 6. 의도적으로 두 벌인 것 — 지우면 회귀다

죽은 코드처럼 보이지만 셋 다 "공식 VIA와 커스텀 VIA가 같은 HID 바이트로 호환된다"를
만드는 축이다. 한쪽을 지우면 공식 `usevia.app`이 깨지거나 커스텀 앱이 기능을 잃는다.

| 두 벌 | 공식 쪽 | 커스텀 쪽 |
| --- | --- | --- |
| tapping/TD term | legacy 1 B × 10 ms, 100–500 / 20 ms 그리드 | exact 2 B `uint16` |
| Tap Dance 키코드 | `customKeycodes`의 `CUSTOM(n)` | `tapdanceKeycodes`의 `TD(n)` — 같은 `QK_KB_n` 바이트 |
| 정의 번들 | `/definitions/v3` | `/definitions/era/v3` |

공식 JSON의 exact `options`를 커스텀 앱 범위로 넓히는 것은 회귀다.
legacy GET은 floor-to-20 ms로 투영만 하고 exact 저장값을 다시 쓰지 않는다.

## 7. 손으로 맞춰야 하는 이음매

테스트가 물지 못하는 곳이다. 건드릴 때 반대쪽을 같이 봐야 한다.

- **라우트 ↔ `public/_redirects`.** 라우트는 `src/utils/pane-config.ts`와
  `src/components/panes/errors.tsx`가 정본이고, 배포 rewrite 목록은 손으로 맞춘다.
  현재 `/diagnostics`는 `src/Routes.tsx`에서 `/`로 redirect되지만 `_redirects`에는 없다.
  즉 앱 안에서 이동하면 동작하고, 배포 호스트에 **콜드 딥링크로 들어오면 404**다.
- **`hash.json`은 플랫폼 의존이다.** 값이 다르다고 재현성이 깨진 것이 아니다. 차이의 출처는
  설치된 `via-keyboards`가 자체 빌드에서 만드는 `officialHash` 하나이며, 파일 순회 순서에
  의존한다. 앱은 이 값을 캐시 키로만 쓰고 배포본 안에서 `index.html`의 `data-hash`와
  일치하면 된다.
- **`supported_kbs.json`의 `generatedAt`.** 콘텐츠 해시 계산에서 의도적으로 제외된 필드다.
  두 번 clean build한 결과의 유일한 차이가 이것이면 정상이다.

## 8. 참조 저장소

전부 이 PC에만 있는 경로다. **승인 없이 수정·커밋·플래시·push하지 않는다.**
브랜치와 HEAD는 여기 적지 않는다 — 움직이므로 시작 전에 직접 확인한다.

| 경로 | 역할 |
| --- | --- |
| `D:\Engineering\qmk_firmware_eerraa` | QMK 26종 펌웨어(RP2040 25 + ATmega32U4 1). `keyboards/era/` |
| `D:\Engineering\eerraa-qmk-h7s-fw` | H7S 5종 펌웨어 (main) |
| `D:\Engineering\eerraa-qmk-h7s-fw-via`, `...-via2` | H7S 작업 워크트리 |

- H7S 저장소를 열 때는 **그쪽 `AGENTS.md`를 먼저 읽고 따른다.**
- 펌웨어 저장소를 cwd로 두고 세션을 열면 그쪽 규칙이 `graphify update .`를 걸어 이 앱
  저장소에 `graphify-out/`을 잘못 커밋한 사고가 있었다. **cwd는 앱에 둔다.**
- 펌웨어의 `*-VIA.json`은 firmware-local 사본이지 앱 lookup source가 아니다. 그러나
  기능을 추가할 때는 **양쪽에 넣어야 한다** — 커스텀 앱만 말할 수 있는 경로는 오류다
  (`docs/PROJECT_DIRECTION.md`).
- 원격 firmware verifier를 제거했으므로 펌웨어 wire/identity와 앱 커스텀 JSON이 따로
  바뀌면 CI가 cross-repository drift를 잡지 못한다. 양쪽이 함께 바뀌는 릴리스에서는
  로컬 호환성 감사가 필요하다.

## 9. 문서 규칙

- 문서에 저장소 경로를 쓸 때 `src/ tests/ config/ era-definitions/ public/ scripts/ docs/
  types/ patches/ .github/`로 시작하면 **이 저장소의 실재 파일**이어야 한다.
  다른 저장소 파일은 저장소 이름을 앞에 붙인다 (`eerraa-qmk-h7s-fw/src/...`).
  `tests/docs-contract.test.ts`가 검사한다.
- 날짜·HEAD 해시·PID·PR 번호·1회성 검증 결과는 쓰지 않는다. `git log`와 실행이 답한다.
- 제약을 적을 때는 **그 제약이 생긴 원인**을 함께 적는다. 원인이 없으면 다음 사람이
  규칙을 우회할 명분을 갖는다. 커밋은 변경 단위이고 제약은 계약 단위라 `git log`가
  이것을 대신하지 못한다.
- 문서가 `path:line` 주소를 적으면 그 줄이 실재해야 한다. 줄 번호는 그 위에 한 줄이
  삽입되는 순간 조용히 틀린다.
- ADR을 쓰거나 은퇴시키는 규칙은 [`docs/adr/README.md`](adr/README.md)에 있다.
- 위 두 가지와 아래 헤더 규약, 그리고 문서가 부르는 경로·명령·숫자는
  `tests/docs-contract.test.ts`가 검사한다. 문서가 어느 라우터에서도 도달할 수 없으면
  그것도 실패로 잡는다.

### 문서 헤더 — 네 저장소 공통 규약

`the-via-eerraa` · `qmk_firmware_eerraa` · `eerraa-qmk-h7s-fw` · `eerraa-54lm20-fw`가
같은 모양을 쓴다. 문서 집합이 있는 디렉터리 아래 모든 문서가 첫머리에 **두 줄**을 선언한다.

```
Genre: contract
Canonical for: 이 문서가 유일한 원본인 사실
```

- **`Genre`** — 이 문서가 담아도 되는 문장의 종류. `contract`(무엇이 참이어야 하는가) ·
  `map`(무엇이 어디 사는가) · `manual`(어떻게 돌리는가) · `state`(무엇이 빚이고 무엇이
  측정됐는가) · `entry`(진입 사슬). **다섯 뿐이고 늘리지 않는다.**
- **`Canonical for`** — 비어 있으면 안 된다. 빈 선언은 없는 것보다 나쁘다. 답한 것처럼 읽힌다.
- **`Status`는 실제로 값이 변하는 곳에만 둔다.** 여기서는 `docs/adr/` 아래뿐이며
  `Proposed` · `Accepted` · `Superseded`를 갖는다. 그 밖의 문서는 유효하거나 삭제되거나
  둘 중 하나라 상수가 된다. 규약의 출처인 `qmk_firmware_eerraa`에서 문서 21개 중 19개가
  `active`였고 나머지 둘은 서로 마침표 하나만 달랐다 — 아무도 읽지 않고 무엇도 검사하지
  않는 필드의 모습이다.
- **`Read when`은 두지 않는다.** 문서 쪽에서 "언제 읽는가"를 말하면 진입 색인이 작업
  쪽에서 말하는 것과 같은 사실을 손으로 두 벌 유지하게 된다. 라우팅은 색인 하나가 소유하고,
  모든 문서가 색인에서 도달 가능한지를 검사기가 강제한다.
- 저장소 루트의 `AGENTS.md`·`CLAUDE.md`는 헤더를 갖지 않는다. 진입 사슬 자체이지 그 사슬이
  라우팅하는 문서가 아니다.
- 장르를 디렉터리로 나눌지는 규모가 정한다. 문서가 20개를 넘으면 디렉터리가 곧 장르인 편이
  낫고(`qmk_firmware_eerraa`), 그 이하면 헤더 선언으로 충분하다(이 저장소).
