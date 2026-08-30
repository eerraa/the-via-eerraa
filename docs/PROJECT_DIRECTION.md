# ERA VIA Fork — 제품 방향

Genre: contract
Canonical for: 이 포크의 목적, 우선순위, 정의 소유권, Tap Dance와 exact-ms UI 계약,
State Sync 제품 보장, 영구 비목표

> 지속되는 프로젝트 브리프다. 제품이 무엇을 위한 것인지, 그리고 무엇이 절대 해서는
> 안 되는지를 적는다. 어떤 사실이 어디에 살고 어느 쪽이 정본인지는 `docs/MAP.md`다.
> 기각된 대안을 포함한 개별 결정은 `docs/adr/`에 있다. 일시적 상태는 어디에도
> 기록하지 않는다 — `git log`와 검증 명령이 답한다.

## 사명

ERA PCB와 펌웨어 작업을 위한, 제조사에 속하지 않는 비공식 VIA 포크를 만들되
upstream VIA의 경험과 호환성은 유지한다. 백지에서 다시 쓴 configurator가 아니고,
SIRIND·NEWONE·Linx3 또는 다른 키보드 제조사를 위한 리브랜딩도 아니다.
ERA/eerraa는 PCB/펌웨어 플랫폼과 포크 유지자를 가리킨다.

우선순위:

1. 펌웨어가 키보드 상태의 authority로 남는다.
2. 지원 키보드는 수동 JSON 로드나 페이지 새로고침 없이 동작한다.
3. 일반 VIA 키보드와 기존 VIA V3 정의/명령 경로는 계속 동작한다.
4. Configurator 제어면 트래픽이 8 kHz 입력 데이터면을 해치지 않는다.
5. 복잡성은 입증된 정확성·복구·유지보수 필요가 있을 때만 도입한다.

upstream diff 최소화는 유용하지만 더 이상 그 자체가 목적은 아니다. VIA의 기존
아키텍처가 실제 한계일 때, 잘 검증된 코어 개선이 ERA 전용 우회보다 낫다.

## 확정된 방향

### 정의

정의 소유권은 명시적이다:

- 이 앱 저장소의 `era-definitions/custom/v3`가 ERA 커스텀 정본이다. Tap Dance
  슬롯은 `tapdanceKeycodes`에 두고, `customKeycodes`는 일반 Custom 탭으로 남기며
  비어 있으면 생략한다. TD 이름을 `customKeycodes`에 넣지 않는다.
- `the-via/keyboards`의 `v3/`가 공식 VIA 정본이다. 설치된 `via-keyboards` 패키지는
  핀된 빌드 스냅샷일 뿐, 두 번째 정본이 아니다.
- QMK `keymaps/via`와 H7S 보드 로컬 `json` 파일은 펌웨어 로컬 호환·테스트·릴리스
  자료다. 앱 lookup 소스가 아니며 공식 JSON 소유권을 정하지 않는다.
- Design 업로드는 최후의 로컬 소스다. 기존 UX를 위해 유지하되, 번들된 ERA 또는
  공식 정의를 덮어쓰지 못한다.

> **REFUSED:** 한쪽 정본을 다른 쪽에서 생성하거나 `era-definitions/v3`를 순정 복제로
> 유지하기.
> **WHY:** 커스텀과 공식은 서로 다른 소유권이고, 생성된 산출물은 어느 정본도 대체하지
> 않는다.
> **REOPENS:** 없다.

앱과 펌웨어가 함께 바뀔 때 VID/PID, 명령 주소, 레이아웃, TD 슬롯 정체성은
여전히 릴리스 시점 호환성 검토가 필요하다. 앱 매니페스트는 커스텀 경로, identity,
split pair, 독립 런타임 capability만 기록한다. 통상 앱 빌드와 PR CI는 설치된 공식
스냅샷과 ERA 커스텀 소스를 읽는다. GitHub를 fetch하거나 펌웨어 저장소를 검사하지
않으며, remote-verifier provenance를 내보내지 않는다.

이 포크의 정의 lookup 순서는 다음과 같다:

1. 번들된 `era-definitions/custom` (`/definitions/era/v3/{vpid}.json`).
2. 설치된 공식 VIA 스냅샷 (`/definitions/v3/{vpid}.json`).
3. Design에서 사용자가 업로드한 JSON. 앞의 두 built-in 소스에 그 version/VPID가
   없을 때만.

정의가 없으면 unresolved다. 저장된 업로드는 앱 업데이트, 업로드 교체/해제, 장치
선택 변경, 재연결 뒤에 같은 우선순위로 다시 평가한다.

펌웨어는 두 표현을 모두 받는다. 공식 VIA는 TD0–TD7을 `CUSTOM(n)` / `QK_KB_n`으로
쓰고, 커스텀 앱은 `tapdanceKeycodes`의 같은 `QK_KB_n` 바이트를 `TD(n)`으로 쓴다.

인벤토리 자체 — 정의가 몇 개인지, 어느 보드가 어느 메뉴를 갖는지, 각 보드가 어느
capability에 opt-in하는지 — 는 여기에 다시 쓰지 않는다.
`config/era-definitions.manifest.json`과 정의 JSON이 정본이고,
`tests/era-definition.test.ts`가 묶으며, `docs/MAP.md` §2가 숫자를 든다.

한 항목은 인벤토리가 아니라 지속되는 제품 결정이다. `sirind/brick65`는 영구
ATmega32U4 예외다.

> **REFUSED:** `sirind/brick65`에 공통 ERA tapping·Tap Dance·exact-ms·State Sync
> capability를 넣기.
> **WHY:** 28,672 B 플래시 예산 때문에 순정 VIA만 유지하는 영구 ATmega32U4 예외다.
> **REOPENS:** 없다. 하드웨어 예산이지 결함이 아니다.

`build:kbs`는 설치된 공식 스냅샷을 `/definitions/v3` 아래에 패키징하고 ERA
overlay를 `/definitions/era/v3/{vpid}.json`으로 내보낸다. 두 소스에 같은 VPID가
있어도 공식 파일을 보존해야 하며, 병합된 V3 인덱스는 두 네임스페이스의 unique
union이다. 생성된 산출물은 어느 정본도 대체하지 않으며, provenance나 앱 순정
소스 트리도 만들지 않는다.

번들된 정의는 수동 JSON 업로드 없이 자동 로드된다. 실기에서 확인됐다.

> **REFUSED:** 병렬 런타임 로더나 외부 정의 서비스.
> **WHY:** 번들된 정의는 수동 JSON 업로드 없이 자동 로드되며 실기에서 확인됐다.
> **REOPENS:** 없다.

펌웨어 저장소는 USB identity와 프로토콜 구현의 authority로 남되, 공식 정의
소유권의 authority는 아니다. 앱은 커스텀 overlay와 설치된 공식 스냅샷을 검증하며,
펌웨어 JSON을 복제하거나 통상 빌드를 펌웨어 Git 이력에 묶지 않는다.

### Identity UI

승인된 전역 UI는 VIA의 시각 언어를 유지한다. 오른쪽 위에는 언어 선택과 클릭할 수
없는 은은한 `ERA` 워드마크가 있다.

> **REFUSED:** 제조사 브랜딩 또는 전체 인터페이스 재디자인.
> **WHY:** 이 포크는 백지 configurator도 제조사 리브랜딩도 아니며, 승인된 전역 UI는
> VIA의 시각 언어를 유지한다.
> **REOPENS:** 없다.

### Tap Dance

TOMAK 펌웨어와 VIA V3 JSON이 TD0–TD7, 네 개의 액션 슬롯, tapping term, 저장,
엔진을 구현한다. 커스텀 앱 UI 계약은 다음과 같다:

- VIA의 기존 category/card 키코드 피커를 추출·재사용한다
- V3 `keycode` 컨트롤이 그 피커를 연다
- 검색, 지우기, modifier, layer, Mod-Tap과 Layer-Tap 조합을 지원한다
- 알 수 없는 16비트 값은 hex로 보존하고, 텍스트/hex 입력은 고급 escape hatch로
  남긴다

키코드 조합은 Layers 전용, 점진적 흐름이다. 사용자는 먼저 Layer-Tap, Mod-Tap,
또는 Modifier를 고른 뒤, 호환되는 Basic tap 키와 필요한 hold 액션을 명시적으로
선택한다. 그리드에서 그 tap 키를 고르는 것은 composer만 채우며, 선택된 키보드
키에 할당하지 않는다. Special 카테고리의 Any 카드는 고급 QMK/hex escape hatch로
남는다. 이전에 할당된 그리드 카드에서 compose base를 추론하거나, 일반 카테고리에
상시 compose 폼을 노출하지 않는다.

V3 `keycode` 액션 컨트롤은 일반 keymap 피커와 같은 왼쪽 카테고리 탐색과 카드
그리드를 가진 고정 폭의 넓은 다이얼로그를 쓴다. 다이얼로그 폭은 선택된 카테고리의
내용에 의존하지 않는다. 액션 피커는 연결된 정의가 활성화한 모든 키코드 카테고리를
노출하며 `MO(n)` 같은 layer 카드도 포함하고, Any/hex는 고급 escape hatch로
남긴다. 이것이 `LT`/`MT` 안의 Basic 키만 피연산자로 쓰는 규칙을 완화하지는
않으며, 선택된 16비트 액션의 런타임 의미는 펌웨어가 authority다.

Tapping 계열 시간 값은 정수 밀리초로 직접 편집할 수 있어야 한다. 첫 범위는
글로벌 TAPPING term과 TD0–TD7 term이다. boolean tapping 옵션과 무관한 debounce나
KKUK 타이밍은 조용히 포함하지 않는다. `137 ms` 같은 대표적 비스텝 값이
round-trip되고 지속되며 런타임 동작을 구동해야 하고, 레거시 20 ms 그리드에
스냅되지 않아야 한다.

펌웨어는 공식 VIA 앱(`www.usevia.app`)과 공식 V3 정의로 계속 동작해야 한다.
커스텀 앱만 말할 수 있는 경로는 오류다. 공식 VIA는 기존 레거시 1바이트
드롭다운(100–500 ms / 20 ms 그리드)과 공식 exact 범위 `options: [100, 500]`을
계속 쓴다. QMK 보드의 커스텀 VIA JSON은 같은 2바이트 exact ID에서 exact
`options: [1, 65535]`(uint16 최대값; 99999는 들어가지 않는다)를 쓴다. H7S는
펌웨어가 맞춰지도록 승인될 때까지 공식 정의와 앱 소유 커스텀 JSON에서 100–500을
유지한다.

이것은 펌웨어 레거시 호환을 제거하는 것이 아니라, additive exact-ms wire 경로다.
모든 레거시 value ID와 공식 VIA 동작을 보존하되, ERA 커스텀 JSON은 아홉 개의
exact 컨트롤만 노출하고 그 레거시 드롭다운을 복제하지 않는다. 일반 공식 정의나
업로드된 정의는 레거시 컨트롤을 계속 가질 수 있다. 커스텀 JSON은
`tapdanceKeycodes`를 추가 필드로 넣을 수 있고, 공식 JSON은 넣으면 안 된다.
커스텀 앱은 이 컨트롤에 기본으로 숫자 `ms` 입력을 보여야 한다. 이후 TAPPING 시간
필드에 그 입력을 재사용하려면 저장과 wire 의미를 감사한 뒤에만 한다.

Vial은 인터랙션 디자인을 참고하는 용도로만 쓴다.

> **REFUSED:** 라이선스가 호환되지 않거나 불분명한 Vial 구현 코드 복사.
> **WHY:** Vial은 인터랙션 디자인을 참고하는 용도이며 VIA React 코드에서 독립 구현한다.
> **REOPENS:** 호환되고 검증된 라이선스 근거가 있을 때.

## 상태 동기화

### 관측된 실패

VIA는 UI가 값을 쓸 때 캐시를 갱신하지만, 키보드에서 시작된 변경은 대체로 그
캐시를 무효화하지 않는다. Upstream `UI_SYNC_REQUEST 0x16 v1`은 선택적 V3 Custom
Menu 읽기를 요청할 수 있으나, keymap을 다루지 않고 lifecycle 복구도 제공하지
않는다.

재현된 TOMAK 사례는 구체적이다:

```text
L keymap 변경
  -> 기존 EEPROM SYNC가 그것을 R에 커밋
  -> R에 이미 로드된 앱 캐시는 complete로 남은 채
  -> R을 선택하면 keymap 읽기를 건너뜀
  -> F5 전까지 낡은 keymap이 남음
```

### 일관성 계약

제품이 필요한 것은 현재 상태 수렴이지, 모든 중간 설정 이벤트의 exactly-once
보존이 아니다.

- 선택된 활성 장치의 변경은 보통 즉시 나타난다.
- 놓친 이벤트는 F5 없이 자동 복구된다.
- 장치 선택, Configure 진입, 재연결, 탭 재개는 낡은 캐시를 현재로 보여주기 전에
  freshness를 검증한다.
- 빠른 중간 변경은 합쳐질 수 있다. 최종으로 읽을 수 있는 펌웨어 값이 이겨야
  한다.
- split peer는 그 peer가 상태를 적용하고 돌려줄 수 있게 된 뒤에만 갱신된 것으로
  본다.
- 숨은 페이지는 연속 트래픽을 만들지 않고, 다시 활성화되면 따라잡는다.

### 구현된 메커니즘

위 계약을 충족하는 메커니즘 — `GET_KEYBOARD_VALUE` selector `0x06` 위의
polling-first revision validation, 세 host domain, revision-bracketed atomic
refresh, path별 transport ownership, 기각된 모든 대안과 그 이유 — 는
[ADR 0001](adr/0001-state-sync-protocol.md)에 있다. 여기에 다시 쓰지 않는다.

세 경계는 기록이 아니라 방향에 남긴다. State Sync와 무관한 작업까지 제약하기
때문이다. 거절 세 줄은 [ADR 0001](adr/0001-state-sync-protocol.md)에 있다.

- 호스트 프로토콜에 raw EEPROM 주소를 노출하지 않는다.
- `UI_SYNC_REQUEST 0x16 v1`은 기존 의미를 유지한다.
- 더 넓은 Redux 상태는 이 계약이 요구하는 곳에서만 리팩터한다.

실기기 검증은 소프트웨어만의 증거가 결정적 시뮬레이션, 호스트 테스트, 캡처된
transcript 재생, 정적 ownership 증명으로 답할 수 없는 구체적 질문을 남길 때까지
미룬다. 하드웨어 데이터가 없다는 사실은 명시적 불확실성으로 남아야 하며, 브라우저
닫기/열기, USB 엔드포인트 flushing, 응답 지연, 8 kHz 성능에 대한 가정으로
대체하면 안 된다.

## 호환성과 성능 기대

- 확장 없는 일반 키보드는 기존 VIA 경로를 그대로 쓴다.
- v1 가능 펌웨어는 Custom Menu 동기화를 유지한다.
- 고급 ERA 펌웨어는 unsolicited State Sync 트래픽을 보내지 않는다.
- 공식 VIA 클라이언트는 기존 명령을 계속 쓰며 arm/subscription 흐름이 필요 없다.
- 현재 펌웨어는 공식 VIA + 공식 정의의 유효한 장치로 남는다. 커스텀 앱만의
  value ID, 범위, 인코딩은 허용되는 대체가 아니다.
- Revision 카운터는 RAM에 남고 EEPROM 마모를 늘리지 않는다.
- scan/ISR 경로에서 동기화 송신이 일어나지 않는다.
- 숨은 페이지는 revision-poll 트래픽을 멈춘다.
- H7S 검증은 8 kHz 입력 아래에서 polling off/on의 report interval, jitter,
  queue overflow를 비교한다.

## State Sync 수락 기준

- 같은 유닛의 물리 변경은 측정된 visible polling 한도 안에서 F5 없이 나타난다.
- 반대 TOMAK 반쪽에서 커밋된 변경은 USB 쪽 UI에 F5 없이 수렴한다.
- 빠른 변경은 최종 펌웨어 값으로 정착한다.
- 놓친 `0x16 v1` hint는 고급 가능 펌웨어에서 revision 또는 lifecycle 검사로
  복구된다.
- 장치 전환, 뽑기/다시 꽂기, 탭 숨김/표시는 낡은 캐시를 현재로 표시한 채로 두지
  않는다.
- 일반 VIA와 v1-only 펌웨어 동작은 그대로다.
- 숨은 상태는 진행 중인 revision-poll 트래픽이 없다.
- polling이 켜진 상태에서 H7S 입력 타이밍과 큐에 의미 있는 8 kHz 회귀가 없다.

timeout과 rate 값은 영구 추측이 아니라 측정된 파라미터로 다룬다.

## 남은 결정 게이트

1. 받아들여진 `0x02`/`0x06`/v1 wire 봉투, 세 domain 모델, 500 ms eligibility
   정책, 기존 VIA 값 authority, exact-ms 식별자를 보존한다.
2. 물리 TOMAK split 수렴과 공식 클라이언트 transcript 검사를 완료하되, 자동화된
   펌웨어 빌드를 플래시나 장치 관측의 대체로 취급하지 않는다.
3. USB 진단 selector `0x07`의 읽기 전용·opt-in·RAM-only 경계와, polling mode·State
   Sync 복구 결합 거절은 [ADR 0002](adr/0002-h7s-usb-diagnostics.md)가 정한다. Mode
   선택은 항상 사용자의 것이다.
4. semantic/range event, ACK, 추가 domain, 두 번째 값 프로토콜의 재검토 조건은
   [ADR 0001](adr/0001-state-sync-protocol.md)의 REFUSED 블록이 정한다.

펌웨어 저장소를 수정하거나 프로토콜을 고정하기 전에 필요성, 앱과 펌웨어 변경,
호환성, 실패 동작, 하드웨어 테스트 계획을 보고한다. Cloudflare Pages, DNS,
프로덕션 배포, 그 밖의 외부 서비스 변경도 명시적 승인이 필요하다.

## 영구 비목표

목록이지 거절 블록의 모음이 아니다. 세 줄은 결정이 있는 자리에 있다.

- 기존 V3 Custom Value 기능을 중복 React 상태나 프로토콜로 다시 만들지 않는다 —
  [ADR 0001](adr/0001-state-sync-protocol.md)
- Tap Dance 엔진이나 split EEPROM 동기화를 대체하지 않는다.

> **REFUSED:** Tap Dance 엔진이나 split EEPROM 동기화를 이 앱에서 대체하기.
> **WHY:** 펌웨어가 키보드 상태의 authority로 남고, TOMAK 펌웨어와 VIA V3 JSON이 엔진·슬롯·저장을
> 이미 구현한다.
> **REOPENS:** 없다.

- ERA 전용 디자인 시스템이나 제조사 브랜딩을 만들지 않는다 — 위 Identity UI
- 생성된 정의를 소스로 유지하지 않는다 — 위 정의
- 호환되고 검증된 라이선스 근거 없이 Vial 구현 코드를 복사하지 않는다 — 위 Tap Dance
- 입증된 정확성을 희생하며 작은 diff를 최적화하지 않되, 측정된 필요가 없는
  추측성 프레임워크도 피한다.
