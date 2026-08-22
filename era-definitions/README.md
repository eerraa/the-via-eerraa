# ERA keyboard definitions

이 앱 저장소는 커스텀 VIA용 ERA V3 JSON만 보관한다.

| 정의 종류     | canonical source                        |
| ------------- | --------------------------------------- |
| ERA 커스텀 V3 | 이 저장소의 `era-definitions/custom/v3` |
| 공식 VIA V3   | `the-via/keyboards` 저장소의 `v3/`      |

설치된 `via-keyboards` 패키지는 공식 저장소의 pinned build snapshot이다. QMK/H7S의
`*-VIA.json`은 firmware-local copy, 테스트 자료 또는 릴리스 보조 자료일 수 있지만 앱
lookup source나 공식 source of truth가 아니다. 순정 복제 트리 `era-definitions/v3`를
운영하지 않으며, 어느 canonical source도 다른 쪽에서 생성하지 않는다.

커스텀 VIA 앱의 JSON 우선순위는 다음과 같다.

1. `era-definitions/custom` 빌드 산출(`/definitions/era/v3`)
2. 설치된 공식 VIA snapshot 빌드 산출(`/definitions/v3`)
3. Design 탭에서 사용자가 올린 JSON(앞의 두 source에 해당 VPID/version이 없을 때만)

업로드는 보관할 수 있지만 ERA 또는 official definition을 override하지 않는다. replace,
unload, 앱 업데이트, device selection 전환, reconnect 뒤에도 같은 우선순위를 적용한다.

커스텀 JSON은 `tapdanceKeycodes`와 `customKeycodes`를 모두 지원한다. TAPDANCE 탭은
`tapdanceKeycodes`가 있을 때, Custom 탭은 비어 있지 않은 `customKeycodes`가 있을 때만
나타난다. TD0–TD7은 `tapdanceKeycodes`에만 둔다.

manifest의 QMK ERA custom 범위는 현재 26개 변형이다. ATmega32U4 `sirind/brick65`는
공통 tapping/Tap Dance/exact-ms/State Sync를 넣지 않는 영구 예외이고, 나머지 25개
RP2040 변형만 해당 capability를 선언한다.

## 커스텀 JSON 수정

- QMK exact `options`는 `[1, 65535]`다.
- H7S exact `options`는 `[100, 500]`을 유지한다.
- VID/PID, legacy/exact command 주소, 레이아웃을 바꾸면 공식 source와 관련 firmware의
  compatibility를 release 작업에서 함께 검토한다.
- 앱의 일반 build는 설치된 `via-keyboards` snapshot과 이 저장소의 custom source만
  읽는다. firmware 저장소나 GitHub를 읽지 않고 원격 firmware verifier를 사용하지 않는다.
- custom definition에는 legacy tapping/TD term dropdown을 두지 않는다. QMK exact
  control은 9개이고 H7S exact control도 9개이며, firmware legacy GET/SET은 별도
  compatibility 계약으로 유지한다.

## 새 keyboard 추가

1. 공식 지원이 필요하면 `the-via/keyboards/v3`에 별도 절차로 definition을 추가한다.
2. `era-definitions/custom/v3/<keyboard>/`에 커스텀 VIA V3 JSON을 추가한다.
3. `config/era-definitions.manifest.json`에 custom `path`, VID/PID와 독립 capability를
   추가한다.
4. split Left/Right는 동일한 `pair` 값을 사용한다.
5. `bun run test:p1`, `bun run build`와 실제 keyboard 자동 인식을 확인한다.

`public/definitions`와 `dist`는 생성 결과이므로 직접 수정하거나 commit하지 않는다.
동일 VPID가 공식 snapshot에도 있어도 `/definitions/v3` 파일을 지우지 않는다. 커스텀 파일은
별도 `/definitions/era/v3` overlay에만 출력한다.
