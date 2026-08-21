# 0001 — State Sync revision validation protocol

Status: Accepted (G1 2026-08-21)

Selector `GET_KEYBOARD_VALUE` **`0x06`**, envelope version `0x01`. Exact-ms IDs:
global channel 15 value 5; QMK TD terms channel 0 values 72–79; H7S TD terms
channel 16 values 41–48. Exact wire is 2-byte big-endian `uint16` ms, range
100–500; out-of-range exact SET is rejected. Legacy GET projects floor-to-20 ms
and does not rewrite the exact store. Selected-visible-capable poll starts at
500 ms.

## Context

VIA는 장치 값을 Redux cache에 읽은 뒤, 보통 app이 직접 쓴 값만 cache에
반영한다. Firmware 내부 변경, 다른 host의 변경, split 반대편에서 반영된 변경은
이미 complete인 cache를 무효화하지 않는다. 실기로 재현된 TOMAK79H 실패는
다음과 같다.

```text
Left keymap 변경
  -> 기존 split storage가 Right에 durable apply
  -> Right의 app cache는 complete 상태 유지
  -> Right 선택 시 keymap GET 생략
  -> F5 전까지 오래된 keymap 표시
```

이 ADR의 목표는 모든 중간 event의 exactly-once 전달이 아니라, 기존 VIA GET이
반환하는 최종 firmware 상태로 자동 수렴하는 것이다. 일반 VIA keyboard의
definition과 command transcript, 공식 VIA client, 기존 `0x16` v1 Custom Menu
동작은 그 목표와 동등한 최종 구현 조건이다.

2026-08-13 재검토에서 app upstream `main`은 여전히
`510317d811efed929e5cc6543a7ea4495b03b00e`이고, 이 fork의 관련 transport,
keymap, menu 경로에는 upstream diff가 없음을 확인했다. 따라서 아래 문제는
ERA UI 우회가 아니라 VIA core correctness 문제다.

- `src/shims/node-hid.ts:7,183-217`은 write timestamp 하나를 모든 장치에
  공유하지만 buffer와 waiter는 path별이다.
- `src/shims/node-hid.ts:145-169`은 중앙 분류기 없이 임의 handler가 pending
  response보다 먼저 report를 소비할 수 있다.
- `src/utils/keyboard-api.ts:749-791`은 다음 report를 받은 뒤 echoed request
  prefix만 검사한다. Correlation tag와 실제 response timeout은 없다.
- `src/store/keymapSlice.ts:132-153`과
  `src/store/menusSlice.ts:350-409`은 명시적 device를 받으면서도 selected
  API/definition을 다시 읽는다.
- `src/store/keymapSlice.ts:137-139`은 load progress가 complete이면 freshness를
  확인하지 않고 keymap GET을 생략한다.
- `src/components/Home.tsx:187-195`의 `0x16` handler는 selected API에만 붙고
  selected-device thunk로 dispatch한다.

## Adversarial conclusion and recommendation

기존 제안의 semantic event + revision recovery는 최종 수렴에 필요한 것보다
강했다. Unsolicited event 한 종류를 추가하면 ARM, client nonce, lease 만료,
event sequence, descriptor queue, overflow/coalescing, H7S event TX arbitration이
연쇄적으로 필요하다. 그런데 event가 마지막 한 건에서 유실될 때 correctness를
보장하는 것은 결국 periodic revision query다.

**권고안은 event가 없는 polling-first revision validation이다.** 선택되어 있고
Configure가 보이는 capable device에만 작은 revision query를 저빈도로 보내고,
revision이 달라진 domain만 기존 VIA GET으로 다시 읽는다. Lifecycle 경계에서는
revision equality를 신뢰하지 않고 필요한 full refresh를 수행한다. `0x16` v1은
Custom Menu의 빠른 invalidation hint로 그대로 유지하되 correctness의 유일한
근거로 삼지 않는다.

이 축소안은 reconnect와 client replacement를 별도 subscription state machine
없이 복구하고, 공식 VIA client에 unsolicited packet을 보낼 가능성을 구조적으로
제거한다. Poll interval과 CONFIG refresh 비용이 실측상 수용 불가능할 때에만
semantic event를 후속 ADR로 다시 제안한다.

## Mechanism verdicts and five-question review

각 행은 요구된 다섯 질문에 답한다. `지금/후속` 열은 지금 필요한지 또는 실측
후 추가할지를, 마지막 열은 packet 유실·중복 시 최종 수렴을 설명한다.

| Mechanism | 판정 | 1. 해결하는 실제 실패 | 2. 기존 GET/lifecycle만으로 부족한 이유 | 3. 지금/후속 | 4. 추가 상태 복잡성 | 5. 유실·중복 시 수렴 |
| --- | --- | --- | --- | --- | --- | --- |
| Canonical definition/build metadata opt-in | **유지** | 일반 keyboard나 임의 sideload definition에 extension probe가 나가는 것을 막는다. | GET은 어떤 장치에 probe해도 안전한지 알려주기 전에 이미 전송돼야 하므로 단독으로 해결할 수 없다. | 지금 필요하다. | App build에 opt-in boolean과 생성된 trusted identity 목록만 추가한다. Firmware 상태는 없다. | Opt-in이 없으면 advanced 경로 자체가 없고 기존 VIA로 남는다. |
| Runtime capability confirmation | **단순화** | Opt-in VID/PID에 구형·비지원 firmware가 연결된 경우를 구분한다. | Build metadata는 실제 flash된 firmware 기능을 증명하지 못한다. | 지금 필요하다. 별도 CAPABILITIES state machine은 필요 없다. 첫 revision query의 정상 응답이 confirmation을 겸한다. | Connection별 `unsupported \| capable(mask)` 한 값이다. | Unhandled, malformed, timeout은 그 connection에서 legacy fallback이며 재probe하지 않는다. |
| 기존 `GET_KEYBOARD_VALUE (0x02)`의 새 read-only selector | **유지** | 하나의 작은 request/response로 capability와 domain revision을 얻는다. | 모든 값을 매 poll마다 GET하면 큰 keymap/macro를 불필요하게 읽는다. | 지금 필요한 유일한 wire extension 후보다. | Firmware의 세 RAM token과 app의 cached token 세 개다. | Query 실패는 cache를 dirty로 남긴다. 다음 visible poll/lifecycle refresh가 재시도한다. |
| 별도 새 top-level command | **제거** | 원안에서는 event/request/response를 분리하려 했다. | Event를 제거하면 기존 read-only Keyboard Value selector가 같은 일을 하며 새 command namespace가 필요 없다. | 지금 불필요하다. Selector 충돌 검토만 승인 후 수행한다. | 새 command classifier와 message-type table을 없앤다. | 해당 없음. 기존 `0x02` response 경로를 사용한다. |
| 16-bit request tag (새 selector 내부) | **유지** | Query timeout 뒤 늦은 query response가 새 query로 귀속되는 것을 막는다. | 기존 echoed prefix만으로 같은 query 세대를 구분할 수 없다. | 지금 필요하다. | App의 connection별 증가 tag 하나, firmware는 echo만 한다. | 중복·늦은 tag는 pending matcher와 맞지 않아 drop된다. Wrap 전 stale buffer를 generation reset으로 비운다는 전제가 필요하다. |
| Host nonce | **제거** | 원안에서는 이전 client의 event를 현재 client event와 구분했다. | Unsolicited event가 없고 response는 request tag와 connection generation으로 귀속된다. | Event를 다시 채택할 때만 재검토한다. | App/firmware nonce와 validation 분기를 모두 없앤다. | 해당 없음. |
| Expiring ARM lease 및 disarm | **제거** | 원안에서는 crash한 fork client 뒤에도 event가 계속 나가는 시간을 제한했다. | Firmware가 먼저 보내는 advanced packet이 없으므로 official client나 replacement client를 arm할 상태가 없다. | 불필요하다. | Deadline, renewal, expiry, pending-event clear가 사라진다. | 해당 없음. |
| Event sequence | **제거** | 원안에서는 중간 event gap을 빨리 발견했다. | 마지막 event 유실은 sequence로 못 찾고 어차피 revision poll이 필요하다. Polling-first에는 event gap이 없다. | Semantic event가 실측 후 승인될 때만 재검토한다. | 16-bit sequence와 modulo ordering이 사라진다. | Advanced event에 의존하지 않으므로 유실·중복·순서 변경이 correctness에 영향 없다. |
| Semantic event kind | **측정 후 결정** | Exact invalidation은 poll interval보다 빠른 visible update를 줄 수 있다. | Final convergence는 revision poll + GET으로 해결된다. 지금 남는 이점은 latency뿐이다. | Poll latency/traffic 실측이 acceptance를 만족하지 못할 때만 후속 ADR로 결정한다. | Firmware hook, event descriptor, app event router가 추가된다. | 채택하더라도 event는 hint여야 하며 revision poll이 최종 수렴을 담당해야 한다. |
| Range/cell hint | **제거** | 큰 domain에서 부분 GET 비용을 줄일 수 있다. | Correctness에는 domain invalidation으로 충분하고, 현재 setter coverage와 split exact range가 검증되지 않았다. | Domain refresh 비용을 먼저 측정한다. | Kind/argument grammar, range merge, partial freshness를 없앤다. | Domain 전체 재읽기라 hint 유실·중복 문제가 없다. |
| Event descriptor queue, coalescing, overflow flag | **제거** | Event burst가 TX queue를 넘을 때 정보를 축약하려 했다. | Event가 없고 revision token 자체가 coalesced final-state indicator다. | 불필요하다. | Firmware queue/flags/counters와 app overflow 분기가 사라진다. | Poll은 현재 revision만 읽으므로 중간 change 수와 무관하게 최종 상태로 간다. |
| Visible event watchdog | **단순화** | 마지막 event 유실과 selected device의 firmware-originated change를 찾는다. | Lifecycle full read만으로는 같은 visible session 중의 변경을 발견하지 못한다. | Event watchdog이 아니라 selected-visible revision poll로 지금 필요하다. Interval은 측정 후 확정한다. | App의 device별 단일 timer와 in-flight coalescing만 추가한다. Firmware timer는 없다. | 각 poll은 현재 token을 읽으므로 유실 개념이 없다. 실패한 poll은 fresh를 연장하지 않는다. |
| 네 domain (`KEYMAP`, `MACRO`, `CUSTOM_MENU`, `KEYBOARD`) | **단순화** | 서로 다른 읽기 비용을 격리한다. | Global token 하나는 작은 config 변경에도 큰 keymap과 macro를 모두 다시 읽는다. 반대로 `CUSTOM_MENU`와 `KEYBOARD`를 반드시 나눠야 한다는 측정은 없다. | 처음에는 세 domain으로 시작하고 CONFIG 비용을 측정한다. | Counter/cache 네 개를 세 개로 줄이고 ambiguous `KEYBOARD` adapter를 없앤다. | 각 domain은 독립 equality token이며 최종 GET으로 수렴한다. |
| Global revision 하나 | **제거** | 최소 RAM/state로 어떤 변경이 있었다는 사실은 알린다. | 어떤 GET을 해야 하는지 모르므로 매 change마다 keymap+macro+config full read가 필요하다. RGB/config burst가 refresh starvation을 만들 수 있다. | 사용하지 않는다. | Counter는 하나지만 app I/O와 retry 상태가 오히려 커진다. | 이론상 수렴하지만 지속 config 변경 중 큰 domain refresh가 안정화되지 않는 실용 반례가 있다. |
| Per-device transport ownership와 connection generation | **유지** | A/B 장치 traffic, old listener, late async completion이 서로의 cache/response를 오염시키는 문제를 막는다. | GET을 더 보내면 현재 global timestamp와 selected coupling race가 더 커진다. | 지금 필요한 core correction이다. | Path별 listener, serialized queue, pending matcher, timestamp, generation을 둔다. | Disconnect/timeout generation을 폐기하고 해당 device cache를 unknown으로 만들어 수렴한다. |
| Legacy command timeout poisoning | **유지** | Tag가 없는 동일 legacy command를 retry할 때 늦은 이전 response가 새 request로 오인되는 문제를 막는다. | Prefix가 같은 두 response는 app만으로 구분할 수 없다. | 지금 필요하다. | Timeout된 WebHID session을 더 이상 동일 command에 재사용하지 않는 terminal state가 추가된다. | Reopen이 USB pipe를 flush한다는 점을 검증하기 전에는 자동 retry하지 않고 fail closed한다. Reconnect 후 full refresh한다. |
| Revision-bracketed refresh와 atomic cache commit | **유지** | Multi-packet GET 도중 변경되어 torn snapshot을 fresh로 확정하는 것을 막는다. | Lifecycle read 한 번만으로는 read 도중 race를 검출하지 못한다. | 지금 필요하다. | Domain별 candidate buffer와 `dirty \| refreshing \| fresh(rev,generation,verifiedAt)` 상태가 추가된다. | Start/end token이 다르면 candidate를 버리고 재시도한다. 안정 구간이 오면 최종 GET이 commit된다. |
| Selected-layer provisional Redux patch | **제거** | 큰 keymap에서 현재 layer를 먼저 보이려 했다. | Per-layer revision 없이 일부 layer만 현재값으로 쓰면 partial state를 current로 오인할 수 있다. | 초기 구현에서는 하지 않는다. | 별도 partial freshness와 merge race를 없앤다. | 전체 keymap candidate가 안정된 뒤 한 번에 commit된다. |
| TOMAK post-readback/post-reload revision hook | **유지** | Source intent를 target cache에 미리 반영하거나 target의 실제 durable apply를 놓치는 문제를 막는다. | Source GET은 target 성공을 증명하지 못하고, target lifecycle full read만 기다리면 selected target의 자동 감지가 늦다. | QMK 변경 승인 후 필요하다. | 기존 7 storage domain을 3 host domain에 매핑하고 target commit 뒤 token을 증가시킨다. | Wire notification은 없다. Revision query가 target의 증가한 token을 읽으며, lifecycle full read도 복구 경로다. |
| H7S unsolicited-event TX dispatcher | **제거** | 원안에서는 response와 event의 VIA-IN endpoint 소유권 충돌을 풀려 했다. | Event가 없으므로 새 dispatcher가 해결할 failure도 없다. Query response는 기존 response queue를 사용한다. | Event가 측정 후 다시 채택될 때만 별도 설계한다. | 두-source queue/arbitration/counters가 사라진다. | Ordinary response만 존재하며 event가 response를 지연·유실시킬 수 없다. |
| ACK journal, subscription state machine, snapshot/value protocol, raw EEPROM address | **제거** | Exactly-once/history/value 전송 또는 storage-level targeting을 제공한다. | 현재-state convergence는 revision invalidation + 기존 GET으로 해결된다. | 요구하지 않는다. | 두 번째 authority와 retained client state를 만들므로 금지한다. | 없는 mechanism이며 final convergence는 firmware GET 하나만 authority로 둔다. |

## Consistency and freshness contract

Firmware가 기존 VIA GET으로 반환하는 값만 authoritative value다. 새 selector는
값을 운반하지 않고 어느 host domain이 변했는지만 equality token으로 알려준다.

- `fresh(revision, connectionGeneration, verifiedAt)`은 같은 connection
  generation에서 revision으로 bracket한 기존 GET snapshot이 end revision 시점에
  일관됐다는 뜻이다. 미래 변경까지 잠그는 뜻은 아니다.
- `dirty`는 UI가 continuity를 위해 이전 값을 흐리게 표시할 수는 있어도 현재값으로
  확정하거나 write의 기준으로 쓰면 안 된다는 뜻이다.
- `refreshing`은 domain당 한 loop만 candidate를 소유한다는 뜻이다. 추가 invalidation은
  다음 pass 하나로 coalesce한다.
- Successful SET은 즉시 UI feedback을 줄 수 있지만, advanced device에서는 후속
  revision query와 authoritative GET이 끝나기 전까지 cache를 fresh로 연장하지 않는다.
- Poll 사이에 변경이 일어나면 짧은 stale window는 분산 read 모델상 피할 수 없다.
  목표는 poll interval로 그 window를 제한하고 최종값으로 수렴하는 것이다.
- Hidden 상태에는 periodic traffic이 없다. Resume은 revision equality와 무관하게
  구현된 domain을 full refresh하여 hidden 중 disconnect/reboot를 놓친 경우를 덮는다.
- Reconnect와 connection generation 교체도 cached revision equality와 무관하게 full
  refresh한다.

### Initial three host domains

Host domain은 EEPROM 주소가 아니라 existing GET family와 read cost의 경계다.

| Bit | Domain | Authoritative existing reads | TOMAK storage mapping |
| ---: | --- | --- | --- |
| `0` | `KEYMAP` | dynamic keymap layer/buffer GET, encoder GET | `DYNAMIC_KEYMAP` |
| `1` | `MACRO` | macro count/size/buffer GET | `DYNAMIC_MACRO` |
| `2` | `CONFIG` | applicable persistent Keyboard Value/layout GET와 V3 Custom Value GET (`0x08`) | `ERA_CONFIG`, `QMK_RGB_MATRIX`, `QMK_KEYMAP_CONFIG`, `QMK_DEFAULT_LAYER`, `VIA_LAYOUT_OPTIONS` |

Uptime, switch-matrix telemetry, firmware version처럼 cache freshness 대상이 아닌
Keyboard Value는 CONFIG refresh에 포함하지 않는다. Firmware는 지원 mask를
반환한다. 지원하지 않는 domain은 기존 VIA 동작을 유지하며 advanced freshness로
거짓 표시하지 않는다.

각 token은 nonzero 32-bit RAM equality token이다. Corresponding GET이 새 값을
반환할 수 있는 commit boundary 뒤에 증가하고 wrap 시 zero를 건너뛴다. 숫자
대소가 아니라 equality만 비교한다. 32-bit 전체가 두 관측 사이에 정확히 한 바퀴
도는 경우는 alias 반례이므로, 구현 전에 실제 최대 semantic commit rate가
visible poll interval 안에서 wrap 불가능함을 계측 또는 상한으로 입증해야 한다.

`CUSTOM_MENU`와 `KEYBOARD` 분리는 correctness 경계가 아니다. CONFIG full refresh가
실측상 크거나 layout change가 per-key RGB reread를 과도하게 유발하면 그때 네 번째
domain을 추가한다. Domain 수 변경은 envelope version 변경 없이 reserved mask bit와
후속 revision layout을 쓰지 말고, wire version을 올리는 별도 승인 대상으로 둔다.

## Capability gates

두 gate는 역할이 다르므로 둘 다 유지한다.

1. `config/era-definitions.lock.json`의 canonical entry가 State Sync probe를 명시적으로
   opt in하고 build가 trusted runtime metadata를 생성한다. VIA V3 JSON schema나
   arbitrary sideload JSON에는 transport flag를 추가하지 않는다.
2. 그 metadata로 opt in된 연결만 아래 revision selector를 한 번 읽는다. 정상
   version/status/mask/tag/reserved-byte response만 capability confirmation이다.

이 구조의 구현 invariant는 **generic device scan, protocol-version check, ordinary
definition load에서는 probe 함수를 호출할 수 없고, canonical opt-in branch만 호출할
수 있다**는 것이다. Non-opt-in fake device의 command transcript가 upstream과
byte-for-byte 같다는 자동 test를 acceptance gate로 둔다. 현재 app에는 probe가
아예 없으며, 이 ADR은 구현 시 그 invariant를 요구한다.

Opt-in identity의 구형 firmware에는 probe 한 건이 갈 수 있다. 현재 QMK
`quantum/via.c:360-365,471-481`과 H7S
`src/ap/modules/qmk/quantum/via.c:340-345,451-461`은 unknown value/command를
`id_unhandled (0xFF)`로 돌려보내는 기존 pattern을 가진다. TOMAK79H와 BRICK60은
top-level `via_command_kb()`를 override하지 않아 구형 image에서도 이 default 경로가
적용된다. 새 selector의 unhandled,
malformed response, timeout은 예상 가능한 fallback으로 처리하여 error banner나
반복 probe를 만들지 않는다. 실제 배포 firmware가 이 동작과 같은지는 hardware
transcript로 승인 전에 확인한다.

## Recommended 32-byte wire candidate

새 top-level command 대신 기존 read-only `GET_KEYBOARD_VALUE (0x02)`에 selector
**`0x06`** 을 쓴다. G1에서 확정했다.

WebHID report id `0`을 제외한 32-byte VIA payload 기준이다. Multi-byte integer는
기존 VIA와 같이 big-endian이고 모든 reserved byte는 zero여야 한다.

### Request

| Byte | Meaning |
| ---: | --- |
| `0` | existing `GET_KEYBOARD_VALUE (0x02)` |
| `1` | `0x06` state-sync selector |
| `2` | candidate envelope version `0x01` |
| `3` | zero |
| `4..5` | host request tag |
| `6..31` | zero |

### Response

| Byte | Meaning |
| ---: | --- |
| `0..2` | echoed command, selector, envelope version |
| `3` | status: candidate `OK=0`, `UNSUPPORTED_VERSION=1`, `INVALID=2` |
| `4..5` | echoed request tag |
| `6` | supported-domain mask; initial known bits are `0..2` |
| `7` | zero |
| `8..11` | `KEYMAP` revision, or zero if unsupported |
| `12..15` | `MACRO` revision, or zero if unsupported |
| `16..19` | `CONFIG` revision, or zero if unsupported |
| `20..31` | zero |

별도 CAPABILITIES, ARM, REVISIONS message type, feature bits, nonce, lease, event
sequence, semantic kind, range argument는 없다. 정상 response 자체가 capability와
세 revision을 한 번에 제공한다. Request tag는 새 selector에만 적용되며 tag 없는
legacy VIA command의 timeout ambiguity를 해결한 것으로 간주하지 않는다.

## App transport and refresh algorithm

각 WebHID path는 input listener 하나, serialized request queue 하나, pending response
matcher 하나, per-path write timestamp, connection generation 하나를 소유한다.
Selected Redux state는 transport identity가 아니다.

Input report 분류 순서는 다음과 같다.

1. 길이, version, type/count 범위를 모두 만족하는 legacy `0x16` v1 request
2. 현재 serialized request의 response matcher
3. bounded diagnostic/drop

현재 host command ID는 `0x01..0x15`이고 `0x16`은 host가 요청하지 않는 unsolicited
grammar이므로 strict v1 packet과 legacy response가 겹치지 않는다. State Sync는
`0x02` response이므로 pending matcher가 selector, version, request tag까지 검사한다.
Probe의 `0xFF` unhandled response는 그 probe에만 허용되는 explicit fallback이다.

Tag 없는 legacy command는 command와 immutable echoed arguments로만 match한다.
Timeout 뒤 같은 matcher를 같은 WebHID session에서 retry하면 늦은 이전 response와
구분할 방법이 없다. 따라서 timeout은 그 transport generation을 poisoned로 만들고,
pending/queued work를 reject하며 freshness를 unknown으로 만든다. `close/open`이 USB
pipe를 확실히 flush하는지 browser와 hardware로 증명되기 전에는 같은 generation의
자동 retry를 허용하지 않는다.

모든 thunk와 adapter는 explicit device path/API/definition과 시작 generation을
capture한다. Redux commit 직전에 path와 generation을 다시 확인한다. 이는 필요한
core correction이지만 Redux 전면 재작성은 아니다.

Domain refresh는 다음 순서다.

1. Domain을 `refreshing`으로 만들고 start revision을 읽는다.
2. 기존 VIA GET 결과를 Redux 밖의 isolated candidate에 모두 읽는다.
3. End revision을 읽는다.
4. Start/end revision이 같고 connection generation이 유지된 경우에만 candidate
   전체를 한 번에 commit하고 `fresh(endRevision, generation, verifiedAt)`로 둔다.
5. 다르면 candidate를 버리고 bounded retry/backoff한다. 실패하면 `dirty`로 남겨
   다음 visible poll 또는 lifecycle에서 재시도한다.

Keymap은 selected layer부터 wire로 읽을 수는 있지만, 초기 구현에서는 full-domain
bracket이 끝나기 전에 Redux current state를 patch하지 않는다. Progress UI가
필요하면 candidate 진행률만 표시한다.

End revision response 뒤와 Redux commit 사이에 firmware change가 생기는 창은 어떤
lock-free read protocol에도 남는다. 그 snapshot은 end query 시점에는 일관됐고 다음
visible poll에서 token mismatch로 dirty가 된다. 이 짧은 창까지 제거하려면 firmware
snapshot lock/value protocol이 필요하며 현재 목표보다 강하므로 추가하지 않는다.

## Lifecycle policy without a subscription state machine

- Selected capable device가 Configure에 들어오면 첫 query로 capability를 확인하고
  unknown domain을 full refresh한다.
- 같은 connection generation에서 다른 device로 전환하면 그 path의 cached revision을
  현재 query와 비교한다. Unknown/mismatch domain만 refresh한다.
- Configure를 떠나면 poll을 중단하고 active freshness의 `verifiedAt`을 만료시킨다.
- `document.hidden`에서는 periodic request를 보내지 않는다. Resume은 세 implemented
  domain을 revision equality와 무관하게 full refresh한다.
- Disconnect는 listener와 pending work를 제거하고 generation을 증가시키며 모든
  implemented domain을 unknown으로 둔다. Reconnect는 revision 숫자가 우연히 같아도
  full refresh한다.
- Client replacement에는 firmware subscription state가 없다. 새 client는 opt-in
  gate와 read-only query부터 시작하고, official VIA client는 아무 advanced packet도
  받지 않는다.

Firmware reboot는 정상적으로 USB disconnect/re-enumeration을 일으킨다는 전제에서
connection generation으로 복구된다. 지원 firmware에 host가 관측하지 못하는 in-place
reset 경로가 있다면 같은 revision 값으로 복귀하는 반례가 생긴다. 그런 경로가
실측되기 전에는 boot/session token을 wire에 추가하지 않고, reset/re-enumeration
behavior를 구현 전 확인 항목으로 둔다.

## Convergence proof and counterexamples

Supported domain `d`에 대해 다음 전제를 둔다.

1. Firmware-readable state `S_d`를 바꾸는 모든 semantic commit은 GET이 새 값을
   반환할 수 있게 된 뒤 token `R_d`를 정확히 한 번 바꾼다.
2. Selected visible 상태에서는 revision poll이 결국 성공하고, lifecycle full refresh도
   재시도 가능하다.
3. 충분한 시점 `T` 이후 state가 안정된다.
4. 비교 가능한 두 query 사이에 token이 32-bit 전체를 정확히 한 바퀴 돌지 않는다.
5. Connection이 불확실한 경계에서는 equality 비교가 아니라 full refresh한다.

`T` 뒤 첫 성공 query가 cached token과 `R_d`의 차이를 찾으면 app은 기존 GET을
start/end `R_d`로 bracket한다. State가 안정됐으므로 두 token은 같고 GET candidate는
최종 `S_d`다. Atomic commit 후 cache는 `S_d`가 된다. Query/GET이 일시 실패하면
dirty 상태와 후속 poll이 같은 절차를 반복한다. 따라서 전제 아래 eventual
convergence가 성립한다.

| Fault | Advanced-capable device | Legacy `0x16` v1-only device |
| --- | --- | --- |
| 마지막 event 유실 | Advanced event 자체가 없다. 다음 revision poll이 최종 token을 읽는다. | **반례:** 후속 `0x16`이나 lifecycle reload가 없으면 마지막 Custom Menu change는 자동 복구되지 않는다. 이 제한을 v1 compatibility로 유지한다. |
| Duplicate `0x16` | 같은 CONFIG invalidation을 coalesce하며 GET 결과가 최종 권위다. | 중복 GET이 생길 수 있으나 값은 수렴한다. |
| `0x16` 순서 변경 | Hint가 값을 싣지 않으므로 순서는 correctness에 영향 없다. | 각 hint가 범위를 좁힐 뿐이며 GET이 현재값을 읽는다. |
| Event overflow/coalescing | Advanced event queue가 없다. Revision token이 모든 중간 change를 final-state token 하나로 자연스럽게 coalesce한다. | Firmware가 마지막 v1 hint까지 잃으면 위 반례와 같다. |
| Refresh 도중 변경 | Start/end token mismatch로 candidate를 폐기한다. End 뒤 변경은 다음 poll이 찾는다. | 추가 v1 hint가 있으면 다음 pass를 queue한다. 마지막 hint가 없으면 lifecycle 전까지 보장되지 않는다. |
| Revision wrap | Poll 사이 정확한 full wrap은 equality alias 반례다. Commit-rate bound로 금지해야 한다. | 해당 없음. |
| Firmware reboot | Re-enumeration generation과 full refresh로 숫자 equality를 무시한다. In-place silent reset은 아직 확인할 반례다. | Lifecycle full refresh가 있으면 복구한다. |
| Reconnect/device switch | Path+generation별 freshness만 사용한다. Reconnect는 full refresh, switch는 같은 generation에서 query validation한다. | 기존 VIA lifecycle load 범위만 보장한다. |
| Hidden/resume | Hidden poll은 0이고 resume full refresh로 revision equality를 신뢰하지 않는다. | Resume full refresh를 app core 정책으로 적용하면 복구한다. |

이 증명은 firmware가 token increment hook을 빠뜨린 경우에는 성립하지 않는다. 그
failure는 event/ACK로도 고칠 수 없으며 setter coverage test와 TOMAK durable-boundary
fault injection으로 검증해야 한다.

## TOMAK durable peer boundary

QMK reference는 세션 시작 시 ADR 원안의 `d61f6ce...`가 아니라
`c0f86a98d4576b662abf3e009b20aa48947cfd13`이었고 기존 user dirty 변경 두 개를
포함했다. 검토 도중 외부 작업이 같은 branch를 `2cd4dcd10596d0bcafc26ce6cb9b0ddd6dce530f`로
전진시키고 graph output 네 개를 dirty로 만들었다. 최종 실제 상태를 다시 검증했다.
`d61f6ce...` 이후 relevant diff는 storage schema assert의 18줄 변경과
TOMAK79H의 무관한 deferred-flush housekeeping 3줄 제거뿐이며 durable apply 순서는
유지됐다.

현재 `era_host_peer_storage.c:1940-1950`은 bounded slice write를 수행한다.
`:1959-1965`와 `:2020-2026`은 전체 domain을 다시 읽어 CRC를 확인한 뒤 runtime
reload를 호출한다. Pull 경로는 그 뒤 `:1988-2005`에서 publish/rotate하고, push
경로는 `:2048-2056`에서 publish 후 durable state를 선언한다.

Target half의 host revision increment boundary는 다음과 같아야 한다.

```text
full readback CRC success
  -> runtime reload 완료 (keymap/macro no-op 포함)
  -> target host-domain revision increment
  -> 나머지 split publish/rotation/close
```

Readback 실패에는 increment가 없어야 한다. 반대로 readback/reload가 성공한 뒤
deferred abort나 publish/rotation이 실패해도 target의 readable state는 이미
바뀌었으므로 revision은 증가해야 한다. 즉 split episode의 최종 성공 통지가 아니라
**target GET readability**가 boundary다. Source half의 intent나
`TRANSFER_VERIFIED`/`APPLY_READY`에서는 target revision을 올리면 안 된다.

기존 seven storage domain은 위 three host domain에만 매핑한다. 새 split
exact-range protocol은 추가하지 않는다. Wire event가 없으므로 peer notification
유실 문제도 없고, app은 target을 query해서 그 target이 실제로 증가시킨 revision을
읽는다. Lifecycle full refresh는 revision hook 누락을 영구적으로 가릴 수는 있지만,
그 누락을 correctness로 허용하지는 않는다.

## H7S response ownership and 8 kHz boundary

H7S reference는 clean `main`의
`cd4473b7896549bb5481b873901da7fc8b5320e4`이고 origin `main`과 같다.
Committed graph를 먼저 질의했으며, read-only 제약 때문에 hook 설치와 graph sync를
수행하는 `tools/graphify/bootstrap.py`는 실행하지 않았다.

현재 H7S ownership은 다음과 같다.

- `via_hid.c:69-88`은 USB RX를 16-entry queue에 복사한다.
- `via_hid.c:91-116`은 main loop에서 `raw_hid_receive()`로 request buffer를
  mutate한 뒤 그 buffer를 `usbHidEnqueueViaResponse()`에 한 번 넣는다.
- `via_hid.c:64-67`의 `raw_hid_send()`는 빈 stub이다.
- `usbd_hid.c:146-150,1224-1249`은 ordinary VIA response용 128-entry queue와
  enqueue owner를 가진다.
- Keyboard input report는 `usbd_hid.c:1251-1283`의 별도 queue/endpoint 경로다.

Polling-first에서는 unsolicited event가 없으므로 H7S에 두 번째 VIA-IN producer나
event dispatcher를 만들지 않는다. 새 selector handler는 기존 request buffer만
채우고, 현재 main-loop response owner가 ordinary response와 같은 방식으로 한 번
enqueue해야 한다. `raw_hid_send()`를 채우거나 별도 enqueue하면 중복 response가 된다.

다만 `usbd_hid.c:1175-1179`에서 VIA descriptor의 IN endpoint `0x84`가 아니라
`HID_VIA_EP_OUT (0x04)`을 `USBD_LL_Transmit()`에 넘기는 source discrepancy는
실제 hardware가 동작한다는 이유로 추정 수정하면 안 된다. Lower-layer direction
처리와 completion/busy ownership을 read-only trace하고 hardware로 확인한 뒤에만
H7S 구현 계획을 승인한다.

Revision poll은 ordinary request/response 하나이므로 event가 response를
지연·유실시키는 경우는 없다. 그래도 H7S의 20 ms VIA response pacing과 HS 8 kHz
입력에 대해 poll on/off A/B로 keyboard interval/jitter, input queue overflow,
VIA latency/timeout을 측정한다. Poll interval은 그 결과 전에는 고정하지 않는다.

## Compatibility conclusion

| Target | Conclusion and invariant |
| --- | --- |
| 일반 VIA keyboard | Canonical opt-in metadata가 없으므로 capability selector를 포함한 새 command가 단 한 건도 나가지 않는다. 기존 V3 definition load와 `0x01..0x15` transcript가 upstream과 같아야 한다. |
| ERA opt-in definition + 구형/비지원 firmware | Read-only selector probe 한 건의 `0xFF` unhandled/malformed/timeout을 예상 fallback으로 처리하고 ARM/poll을 시작하지 않는다. 이후 기존 VIA와 `0x16` v1 경로만 쓴다. |
| Official VIA client + advanced ERA firmware | Firmware는 unsolicited advanced packet을 보내지 않는다. Official client가 새 selector를 요청하지 않으므로 기존 command 의미와 response는 그대로다. |
| `0x16` v1 | Advanced capability와 무관하게 기존 packet grammar와 Custom Menu GET adapter를 유지한다. Suppression, v2 reinterpretation, ARM 의존성을 추가하지 않는다. |
| Protocol versions 7–13 | Version 숫자를 State Sync capability로 재해석하지 않는다. 오직 canonical opt-in 뒤 selector response만 capability다. |

현재 두 reference firmware에서 이름 기반 검색으로 `0x16` v1 emitter/parser는
확인되지 않았다. 따라서 “기존 v1 유지”는 app compatibility 결론이며, 실제 배포
ERA image의 v1 transcript와 advanced firmware에서의 병존은 hardware로 확인해야
한다.

## Removed overdesign and excluded alternatives

이번 재검토에서 초기 slice에서 제거·단순화한 항목은 다음과 같다.

- Semantic event, nonce, expiring ARM lease, event sequence, descriptor queue,
  coalescing/overflow flag와 H7S event TX dispatcher를 모두 제거했다.
- 별도 CAPABILITIES/ARM/REVISIONS message family를 기존 `0x02` read-only selector
  한 번으로 줄였다.
- 네 host domain을 read-cost 기준 세 domain으로 줄였다.
- Selected-layer provisional Redux patch를 제거하고 atomic full-domain candidate만
  허용했다.
- Five-second watchdog와 15-second lease 같은 미측정 상수를 protocol에서 제거했다.

다음 대안은 제외한다.

- **`0x16`을 bidirectional v2로 확장:** v1 unsolicited grammar와 response matching을
  섞고 공식 behavior를 불필요하게 바꾼다.
- **별도 새 top-level command:** polling-only candidate에는 기존 read-only Keyboard
  Value selector면 충분하다.
- **Global revision 하나:** 작은 CONFIG 변경이 큰 KEYMAP/MACRO full read를 유발한다.
- **Event-only sync:** 마지막 event 유실을 복구하지 못한다.
- **Value snapshot/new value protocol:** 기존 VIA serialization과 authority를 복제한다.
- **ACK journal/exactly-once:** current-state convergence보다 강한 문제를 푼다.
- **Raw EEPROM address/range:** QMK, TOMAK, H7S layout을 host contract로 누출한다.
- **Subscription mask/renew state machine:** polling-first에는 subscription이 없다.
- **New split exact-range transport:** 기존 durable apply boundary와 domain mapping이면
  correctness에 충분하다.
- **Redux-wide rewrite:** explicit-device thunk와 작은 freshness coordinator면 된다.

## Consequences

초기 firmware/app 상태는 세 revision token, read-only query, per-device freshness로
제한된다. Official client 안전성은 lease timeout의 확률적 보호가 아니라 unsolicited
advanced traffic이 없다는 구조적 성질이 된다. 그 대가로 selected visible device의
변경 표시 latency는 poll interval만큼 생기며, CONFIG domain을 합친 refresh 비용과
H7S control-plane 영향은 실측해야 한다.

Legacy v1-only device는 기존보다 나빠지지 않지만 마지막 `0x16` 유실을 자동 복구하지
못한다. Advanced-capable device만 bounded automatic convergence를 얻는다. 이 Proposed
결론을 사용자가 승인하면 `docs/PROJECT_DIRECTION.md`의 기존 semantic-event working
architecture를 polling-first 방향으로 함께 갱신해야 한다.

## Verification

### App fake-device and transport tests

1. Non-opt-in ordinary keyboard transcript는 latest upstream과 byte-for-byte 같고
   `<STATE_SYNC_VALUE>` selector가 없다.
2. Opt-in old QMK/H7S device의 `0xFF`, malformed response, timeout은 사용자 오류 없이
   legacy fallback하며 반복 probe/poll이 없다.
3. Valid query는 selector/version/tag/reserved bytes를 검사하고 device A/B의 listener,
   queue, timestamp, generation이 서로 독립이다.
4. Strict `0x16` v1 packet이 pending legacy 또는 State Sync response를 소비하지 않고,
   State Sync `0x02` response도 v1 handler로 가지 않는다.
5. Legacy timeout 뒤 늦은 동일 response가 새 request를 resolve하지 못한다. WebHID
   reopen flush가 증명되지 않으면 transport는 fail closed한다.
6. Domain refresh 중 revision이 바뀌면 candidate를 버리고, stable second pass만 atomic
   commit한다.
7. Selected layer를 먼저 읽어도 full keymap bracket 전에는 Redux current state가
   부분 patch되지 않는다.
8. Device switch 중 old completion은 old path에도 generation이 맞을 때만 commit하고
   new selected device ready 상태를 바꾸지 않는다.
9. Reconnect, hidden/resume, firmware reboot simulation에서 revision 숫자가 같아도 full
   refresh한다.
10. Poll failure는 fresh timestamp를 연장하지 않고 dirty/backoff 후 최종값으로
    수렴한다.
11. `0x16` all/channel-command/command-id 중복·순서 변경을 idempotent하게 처리하며
    v1-only final-loss 반례를 test로 문서화한다.
12. Counter wrap 인접값은 equality로만 처리하고, connection generation은 counter
    equality보다 우선한다.

### Firmware and hardware tests after separate approval

1. 각 local setter와 external change가 해당 GET readability 뒤 세 host token 중
   정확히 하나를 증가시킨다.
2. Rapid change가 intermediate 값을 건너뛰어도 final GET과 revision bracket이 최종값을
   반환한다.
3. TOMAK pull/push를 final chunk, pre-write, mid-write, readback CRC failure,
   post-reload, publish/rotation에서 fault-inject한다. Readback/reload 전 increment는
   불가능하고, 그 뒤 split close failure에는 increment가 유지돼야 한다.
4. 양 TOMAK orientation과 DUAL-HOST device selection이 F5 없이 수렴한다.
5. Official VIA와 fork VIA의 ordinary command transcript를 advanced firmware에서
   비교한다. Firmware는 어떤 client에도 unsolicited advanced packet을 보내지 않는다.
6. Deployed `0x16` v1 behavior가 advanced capability 유무와 무관하게 유지되는지
   capture한다.
7. H7S endpoint trace를 해소하고 poll off/on에서 8 kHz interval/jitter, input queue,
   VIA response latency/timeout을 비교한다.

## Reviewed live evidence

- App branch/HEAD: `feat/era-state-sync` /
  `88e96deef32868c67811c02ed783d6ab637234e6`.
- App working tree at review start: this ADR만 untracked. `origin`에는
  `feat/era-state-sync` remote branch가 없었다.
- Latest upstream app `main`: `510317d811efed929e5cc6543a7ea4495b03b00e`;
  relevant six paths의 fork diff는 없다.
- QMK reference: 세션 시작은 local `goal/era-arch-autonomous-run` at
  `c0f86a98d4576b662abf3e009b20aa48947cfd13`와 existing dirty
  `keyboards/era/sirind/tomak/post_rules.mk`, `tomak.c`였다. 세션 도중 외부 작업이
  HEAD를 `2cd4dcd10596d0bcafc26ce6cb9b0ddd6dce530f`로 바꿨고 최종 상태는 origin HEAD
  `0ac4a79bd039d1c35e859c67d77a241e024aadf8` 대비 `641 ahead / 2 behind`,
  `graphify-out/.graphify_labels.json`, `GRAPH_REPORT.md`, `graph.json`,
  `manifest.json` dirty다. 이 세션에서는 reference file을 수정하지 않았다.
- QMK durable boundary:
  `keyboards/era/common/split/era_host_peer_storage.c:1940-2057`와
  `keyboards/era/sirind/tomak79h/tomak79h.c:327-352`.
- H7S reference: clean `main` at
  `cd4473b7896549bb5481b873901da7fc8b5320e4`, origin과 동일,
  `_DEF_FIRMWARE_VERSION "V260720R1"`.
- H7S ownership:
  `src/ap/modules/qmk/port/via_hid.c:58-116`,
  `src/hw/driver/usb/usb_hid/usbd_hid.c:1146-1249,1251-1283`, endpoint
  constants `usbd_hid.h:48-49`.

Review 시작 시 `127.0.0.1:5173`에는 이 repository의 Vite process가 listen 중이었지만
첫 root HTTP request는 `404`였다. 후속 `curl` 검증에서는 같은 process가 `200 OK`와
VIA HTML을 반환했다. 최종 handoff 재검증에서는 `curl` 5회와
`Invoke-WebRequest`가 모두 `200`, 2673-byte HTML을 반환했다. 초기 `404`의 원인은
확정하지 않았지만 현재 server 응답은 정상이다.

## Remaining uncertainties

- `<STATE_SYNC_VALUE>` selector는 할당되지 않았다. Official VIA/QMK Keyboard Value
  namespace와 future conflict review가 필요하다.
- Visible poll interval은 정하지 않았다. QMK/H7S response latency, browser timer
  throttling, desired UI latency, H7S 8 kHz A/B 결과로 결정한다.
- CONFIG full refresh 비용, 특히 per-key RGB Custom Menu가 큰 keyboard에서 세-domain
  모델이 충분한지 측정하지 않았다.
- 32-bit token full-wrap은 이론적 alias 반례다. 실제 최대 semantic commit rate의
  상한이 필요하다.
- Supported firmware의 모든 reboot가 WebHID disconnect/re-enumeration으로 보이는지,
  in-place silent reset 경로가 있는지 확인하지 않았다.
- Browser `HIDDevice.close()/open()`이 late legacy response와 endpoint buffer를
  확실히 폐기하는지 확인하지 않았다. 확인 전 timeout은 fail-closed다.
- 모든 QMK/H7S setter의 정확한 GET-readability hook coverage는 아직 inventory하지
  않았다.
- QMK local branch와 pinned origin history가 크게 갈라져 있고 세션 중에도 HEAD와
  dirty set이 외부에서 바뀌었으므로 prototype base를 명시적으로 고정해야 한다.
  Dirty reference worktree는 사용할 수 없다.
- H7S `IN 0x84` descriptor와 SOF transmit의 `OUT 0x04` discrepancy, busy/completion
  ownership은 hardware trace 전까지 미해결이다.
- 두 reference firmware에서 `0x16` v1 counterpart를 이름으로 찾지 못했다. 실제
  배포 image capture가 필요하다.
- H7S committed graph의 최신성은 read-only 제약 때문에 bootstrap/sync하지 못했다.

## Approval status and remaining decision gates

2026-08-13 사용자는 event-free polling-first working direction, 기존 VIA GET value
authority, 일반 VIA/공식 client/`0x16 v1` 호환성, 그리고 wire와 무관한 App
Transport/Cache Phase 1을 승인했다. Phase 1 승인은 per-device HID demultiplexing,
connection generation, legacy-timeout fail-closed, strict `0x16 v1` 분류,
explicit-device thunk와 generation-guarded 기존 cache completeness까지만 포함한다.

같은 날 사용자는 Phase 2A의 software-first evidence/measurement 설계 진입도 승인했다.
이 승인은 live app/QMK/H7S 코드 경로의 read-only 재검증, deterministic fake WebHID와
transcript replay, 가능한 host-native firmware test/fault injection 설계, 그리고 별도
QMK 수정 에이전트에게 전달할 codebase-specific prompt 작성까지 포함한다. 실기기 검증은
software-only 방법으로 해소할 수 없는 구체적 가설에만 후순위로 요청한다. 이 승인은
reference firmware 수정, measurement hook 구현, selector 할당, capability/revision query,
polling 또는 production State Sync 구현을 아직 허용하지 않는다.

다음 Phase 2 및 firmware 항목은 여전히 구현 전 별도 승인이 필요하다.

1. 새 top-level command 대신 기존 `GET_KEYBOARD_VALUE (0x02)`의 아직 할당하지 않은
   `<STATE_SYNC_VALUE>` selector를 쓰는 wire 후보와 실제 selector 숫자.
2. Initial three-domain model과 TOMAK seven-to-three mapping.
3. Canonical definition opt-in identities와 capability를 포함할 minimum firmware builds.
4. 실측으로 poll interval을 정하는 gate와 selected-visible-only, hidden-zero-traffic,
   resume/reconnect-full-refresh lifecycle policy.
5. Per-domain freshness coordinator와 revision-bracketed atomic refresh.
6. 선택한 QMK base의 별도 clean worktree/branch에서 수행할 TOMAK post-readback/reload
   revision hook 계획.
7. H7S endpoint/ownership read-only trace와 8 kHz A/B gate를 포함한 별도 변경 계획.
8. Selector allocation 전에 upstream namespace 검토와 `0x16` v1/deployed firmware
   hardware transcript 검증.

Phase 2A 결과와 후속 승인이 있기 전에는 selector 값을 확정하거나 revision query/polling을
구현하지 않고, 두 reference firmware repository를 수정하지 않는다. 이 ADR은 wire
allocation과 hardware measurement 불확실성이 남아 있으므로 `Status: Proposed`를 유지한다.
