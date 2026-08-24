# 0001 — State Sync revision validation protocol

Status: Accepted
Genre: contract
Canonical for: selector `0x06` 봉투 v1, 세 host domain과 revision-bracketed refresh, per-path transport
ownership, exact-ms 규칙, 그리고 제거한 메커니즘 15종과 각각을 제거한 이유

Selector `GET_KEYBOARD_VALUE` **`0x06`**, envelope version `0x01`.
Selected-visible-capable poll starts at 500 ms.

Exact-ms는 2-byte big-endian `uint16` ms다. **채널/value id 표는
`docs/MAP.md` §3이 정본이다.** 이 ADR은 규칙만 고정한다.

- QMK exact SET 범위는 1–65535(uint16 최대값; 99999는 이 인코딩에 들어가지 않는다)이고
  기존 exact ID에 additive다. H7S exact SET은 별도 승인 전까지 100–500이다.
- 범위를 벗어난 exact SET은 거절한다.
- 공식 VIA + 공식 정의는 계속 필수다. legacy ID는 1-byte × 10 ms의 100–500 / 20 ms 그리드로
  남고 공식 exact `options`는 `[100, 500]`이다. **공식 JSON의 options를 커스텀 앱 범위로
  넓히는 것은 회귀다.**
- legacy GET은 floor-to-20 ms로 투영만 하고 exact 저장값을 다시 쓰지 않는다.

Definition ownership은 이 wire 결정과 독립이다 — `docs/MAP.md` §1·§4를 따른다.

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

구현 전 coordinator에는 다음 독립적인 correctness 결함이 있었다.

- 한 query가 반환한 세 revision을 모두 accepted cache에 복사해, KEYMAP refresh 중
  관측한 CONFIG 변경을 CONFIG GET 없이 삼켰다.
- 초기 lifecycle GET과 capability probe 사이 변경이 발생하면 probe의 새 revision을
  probe 이전 데이터에 붙여 fresh로 표시했다.
- Capability가 확인된 뒤의 단일 timeout/malformed도 확인 불가 상태로 영구 강등했다.
- Refresh 전에 revision을 저장해 두어 candidate read가 실패한 dirty domain도 다음
  poll의 숫자 equality 때문에 건너뛰었다.
- Keymap layer/encoder, macro, layout/menu loader가 end revision 검증 전에 Redux를
  부분 갱신했다.
- Poll과 lifecycle full refresh가 서로 다른 in-flight set을 사용해 같은
  path/generation/domain을 동시에 소유할 수 있었다.

따라서 문제는 UI 예외가 아니라 transport generation, observed/accepted revision,
candidate commit을 함께 소유하는 VIA core freshness 문제다.

## Decision and rationale

기존 제안의 semantic event + revision recovery는 최종 수렴에 필요한 것보다
강했다. Unsolicited event 한 종류를 추가하면 ARM, client nonce, lease 만료,
event sequence, descriptor queue, overflow/coalescing, H7S event TX arbitration이
연쇄적으로 필요하다. 그런데 event가 마지막 한 건에서 유실될 때 correctness를
보장하는 것은 결국 periodic revision query다.

**채택한 방식은 event가 없는 polling-first revision validation이다.** 선택되어 있고
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

| Mechanism                                                                            | 판정             | 1. 해결하는 실제 실패                                                                                     | 2. 기존 GET/lifecycle만으로 부족한 이유                                                                                                              | 3. 지금/후속                                                                          | 4. 추가 상태 복잡성                                                                                            | 5. 유실·중복 시 수렴                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical definition/build metadata opt-in                                           | **유지**         | 일반 keyboard나 임의 sideload definition에 extension probe가 나가는 것을 막는다.                          | GET은 어떤 장치에 probe해도 안전한지 알려주기 전에 이미 전송돼야 하므로 단독으로 해결할 수 없다.                                                     | 지금 필요하다.                                                                        | App build에 opt-in boolean과 생성된 trusted identity 목록만 추가한다. Firmware 상태는 없다.                    | Opt-in이 없으면 advanced 경로 자체가 없고 기존 VIA로 남는다.                                                                                                           |
| Runtime capability confirmation                                                      | **단순화**       | Opt-in ERA VPID에 실제로 State Sync가 응답하는지를 연결 세대별로 확인한다.                                | Build metadata는 실제 flash된 firmware 기능을 증명하지 못하고, 무응답만으로 구형 firmware와 통신 오류를 구분할 수도 없다.                             | 별도 CAPABILITIES command 없이 첫 revision query의 정상 응답이 confirmation을 겸한다. | Connection generation별 `unknown \| probing \| unverified \| capable` 한 값이다.                               | 새 generation의 초기 unhandled/malformed/timeout은 확인 불가 안내와 Custom I/O 차단으로 끝낸다. 이미 capable이면 transient failure가 capability를 내리지 않고 freshness만 dirty로 둔다. |
| 기존 `GET_KEYBOARD_VALUE (0x02)`의 새 read-only selector                             | **유지**         | 하나의 작은 request/response로 capability와 domain revision을 얻는다.                                     | 모든 값을 매 poll마다 GET하면 큰 keymap/macro를 불필요하게 읽는다.                                                                                   | 채택한 유일한 wire extension이다.                                                     | Firmware의 세 RAM token과 app의 observed/accepted token이다.                                                   | Query 실패는 cache를 dirty로 남긴다. 다음 visible poll/lifecycle refresh가 재시도한다.                                                                                 |
| 별도 새 top-level command                                                            | **제거**         | 원안에서는 event/request/response를 분리하려 했다.                                                        | Event를 제거하면 기존 read-only Keyboard Value selector가 같은 일을 하며 새 command namespace가 필요 없다.                                           | 불필요하다. G1은 기존 namespace의 selector `0x06`을 확정했다.                         | 새 command classifier와 message-type table을 없앤다.                                                           | 해당 없음. 기존 `0x02` response 경로를 사용한다.                                                                                                                       |
| 16-bit request tag (새 selector 내부)                                                | **유지**         | Query timeout 뒤 늦은 query response가 새 query로 귀속되는 것을 막는다.                                   | 기존 echoed prefix만으로 같은 query 세대를 구분할 수 없다.                                                                                           | 지금 필요하다.                                                                        | App의 connection별 증가 tag 하나, firmware는 echo만 한다.                                                      | 중복·늦은 tag는 pending matcher와 맞지 않아 drop된다. Wrap 전 stale buffer를 generation reset으로 비운다는 전제가 필요하다.                                            |
| Host nonce                                                                           | **제거**         | 원안에서는 이전 client의 event를 현재 client event와 구분했다.                                            | Unsolicited event가 없고 response는 request tag와 connection generation으로 귀속된다.                                                                | Event를 다시 채택할 때만 재검토한다.                                                  | App/firmware nonce와 validation 분기를 모두 없앤다.                                                            | 해당 없음.                                                                                                                                                             |
| Expiring ARM lease 및 disarm                                                         | **제거**         | 원안에서는 crash한 fork client 뒤에도 event가 계속 나가는 시간을 제한했다.                                | Firmware가 먼저 보내는 advanced packet이 없으므로 official client나 replacement client를 arm할 상태가 없다.                                          | 불필요하다.                                                                           | Deadline, renewal, expiry, pending-event clear가 사라진다.                                                     | 해당 없음.                                                                                                                                                             |
| Event sequence                                                                       | **제거**         | 원안에서는 중간 event gap을 빨리 발견했다.                                                                | 마지막 event 유실은 sequence로 못 찾고 어차피 revision poll이 필요하다. Polling-first에는 event gap이 없다.                                          | Semantic event가 실측 후 승인될 때만 재검토한다.                                      | 16-bit sequence와 modulo ordering이 사라진다.                                                                  | Advanced event에 의존하지 않으므로 유실·중복·순서 변경이 correctness에 영향 없다.                                                                                      |
| Semantic event kind                                                                  | **측정 후 결정** | Exact invalidation은 poll interval보다 빠른 visible update를 줄 수 있다.                                  | Final convergence는 revision poll + GET으로 해결된다. 지금 남는 이점은 latency뿐이다.                                                                | Poll latency/traffic 실측이 acceptance를 만족하지 못할 때만 후속 ADR로 결정한다.      | Firmware hook, event descriptor, app event router가 추가된다.                                                  | 채택하더라도 event는 hint여야 하며 revision poll이 최종 수렴을 담당해야 한다.                                                                                          |
| Range/cell hint                                                                      | **제거**         | 큰 domain에서 부분 GET 비용을 줄일 수 있다.                                                               | Correctness에는 domain invalidation으로 충분하고, 현재 setter coverage와 split exact range가 검증되지 않았다.                                        | Domain refresh 비용을 먼저 측정한다.                                                  | Kind/argument grammar, range merge, partial freshness를 없앤다.                                                | Domain 전체 재읽기라 hint 유실·중복 문제가 없다.                                                                                                                       |
| Event descriptor queue, coalescing, overflow flag                                    | **제거**         | Event burst가 TX queue를 넘을 때 정보를 축약하려 했다.                                                    | Event가 없고 revision token 자체가 coalesced final-state indicator다.                                                                                | 불필요하다.                                                                           | Firmware queue/flags/counters와 app overflow 분기가 사라진다.                                                  | Poll은 현재 revision만 읽으므로 중간 change 수와 무관하게 최종 상태로 간다.                                                                                            |
| Visible event watchdog                                                               | **단순화**       | 마지막 event 유실과 selected device의 firmware-originated change를 찾는다.                                | Lifecycle full read만으로는 같은 visible session 중의 변경을 발견하지 못한다.                                                                        | Event watchdog이 아니라 eligible connection의 500 ms revision poll로 채택했다.        | App의 단일 timer와 path/generation coordinator owner만 추가한다. Firmware timer는 없다.                        | 각 poll은 현재 token을 읽으므로 유실 개념이 없다. 실패한 poll은 fresh를 연장하지 않는다.                                                                               |
| 네 domain (`KEYMAP`, `MACRO`, `CUSTOM_MENU`, `KEYBOARD`)                             | **단순화**       | 서로 다른 읽기 비용을 격리한다.                                                                           | Global token 하나는 작은 config 변경에도 큰 keymap과 macro를 모두 다시 읽는다. 반대로 `CUSTOM_MENU`와 `KEYBOARD`를 반드시 나눠야 한다는 측정은 없다. | 처음에는 세 domain으로 시작하고 CONFIG 비용을 측정한다.                               | Counter/cache 네 개를 세 개로 줄이고 ambiguous `KEYBOARD` adapter를 없앤다.                                    | 각 domain은 독립 equality token이며 최종 GET으로 수렴한다.                                                                                                             |
| Global revision 하나                                                                 | **제거**         | 최소 RAM/state로 어떤 변경이 있었다는 사실은 알린다.                                                      | 어떤 GET을 해야 하는지 모르므로 매 change마다 keymap+macro+config full read가 필요하다. RGB/config burst가 refresh starvation을 만들 수 있다.        | 사용하지 않는다.                                                                      | Counter는 하나지만 app I/O와 retry 상태가 오히려 커진다.                                                       | 이론상 수렴하지만 지속 config 변경 중 큰 domain refresh가 안정화되지 않는 실용 반례가 있다.                                                                            |
| Per-device transport ownership와 connection generation                               | **유지**         | A/B 장치 traffic, old listener, late async completion이 서로의 cache/response를 오염시키는 문제를 막는다. | GET을 더 보내면 global timestamp와 selected coupling race가 더 커진다.                                                                               | 구현된 core correction이다.                                                           | Path별 listener, serialized queue, pending matcher, timestamp, generation을 둔다.                              | Disconnect와 untagged legacy timeout은 generation을 폐기한다. Tagged State Sync timeout은 request만 끝내고 freshness를 dirty로 둔다.                                   |
| Legacy command timeout poisoning                                                     | **유지**         | Tag가 없는 동일 legacy command를 retry할 때 늦은 이전 response가 새 request로 오인되는 문제를 막는다.     | Prefix가 같은 두 response는 app만으로 구분할 수 없다.                                                                                                | 지금 필요하다.                                                                        | Timeout된 WebHID session을 더 이상 동일 command에 재사용하지 않는 terminal state가 추가된다.                   | Reopen이 USB pipe를 flush한다는 점을 검증하기 전에는 자동 retry하지 않고 fail closed한다. Reconnect 후 full refresh한다.                                               |
| Revision-bracketed refresh와 atomic cache commit                                     | **유지**         | Multi-packet GET 도중 변경되어 torn snapshot을 fresh로 확정하는 것을 막는다.                              | Lifecycle read 한 번만으로는 read 도중 race를 검출하지 못한다.                                                                                       | 구현된 correctness 경계다.                                                            | Domain별 observed/accepted revision, `unknown \| dirty \| refreshing \| fresh`, isolated candidate가 추가된다. | Start/end token이 다르면 candidate를 버리고 즉시 세 번까지 재시도한다. 안정화되지 않으면 dirty로 남아 다음 poll이 다시 읽는다.                                         |
| Selected-layer provisional Redux patch                                               | **제거**         | 큰 keymap에서 현재 layer를 먼저 보이려 했다.                                                              | Per-layer revision 없이 일부 layer만 현재값으로 쓰면 partial state를 current로 오인할 수 있다.                                                       | 사용하지 않는다.                                                                      | 별도 partial freshness와 merge race를 없앤다.                                                                  | 전체 keymap candidate가 안정된 뒤 한 번에 commit된다.                                                                                                                  |
| TOMAK post-readback/post-reload revision hook                                        | **유지**         | Source intent를 target cache에 미리 반영하거나 target의 실제 durable apply를 놓치는 문제를 막는다.        | Source GET은 target 성공을 증명하지 못하고, target lifecycle full read만 기다리면 selected target의 자동 감지가 늦다.                                | QMK에 구현된 durable boundary다.                                                      | 기존 7 storage domain을 3 host domain에 매핑하고 target commit 뒤 token을 증가시킨다.                          | Wire notification은 없다. Revision query가 target의 증가한 token을 읽으며, lifecycle full read도 복구 경로다.                                                          |
| H7S unsolicited-event TX dispatcher                                                  | **제거**         | 원안에서는 response와 event의 VIA-IN endpoint 소유권 충돌을 풀려 했다.                                    | Event가 없으므로 새 dispatcher가 해결할 failure도 없다. Query response는 기존 response queue를 사용한다.                                             | Event가 측정 후 다시 채택될 때만 별도 설계한다.                                       | 두-source queue/arbitration/counters가 사라진다.                                                               | Ordinary response만 존재하며 event가 response를 지연·유실시킬 수 없다.                                                                                                 |
| ACK journal, subscription state machine, snapshot/value protocol, raw EEPROM address | **제거**         | Exactly-once/history/value 전송 또는 storage-level targeting을 제공한다.                                  | 현재-state convergence는 revision invalidation + 기존 GET으로 해결된다.                                                                              | 요구하지 않는다.                                                                      | 두 번째 authority와 retained client state를 만들므로 금지한다.                                                 | 없는 mechanism이며 final convergence는 firmware GET 하나만 authority로 둔다.                                                                                           |

## Consistency and freshness contract

Firmware가 기존 VIA GET으로 반환하는 값만 authoritative value다. 새 selector는
값을 운반하지 않고 어느 host domain이 변했는지만 equality token으로 알려준다.

- `observedRevision`은 어떤 query에서든 firmware가 마지막으로 보고한 token이다.
  다른 domain refresh의 end query가 새 token을 관측해도 그 domain은 dirty가 될 뿐,
  `acceptedRevision`은 전진하지 않는다.
- `acceptedRevision`은 그 domain의 authoritative GET candidate가 같은 start/end token으로
  검증된 뒤 Redux에 한 번 commit된 revision이다.
- `fresh(acceptedRevision, connectionGeneration)`은 같은 connection
  generation에서 revision으로 bracket한 기존 GET snapshot이 end revision 시점에
  일관됐다는 뜻이다. 미래 변경까지 잠그는 뜻은 아니다.
- `dirty`는 UI가 continuity를 위해 이전 값을 흐리게 표시할 수는 있어도 현재값으로
  확정하거나 write의 기준으로 쓰면 안 된다는 뜻이다.
- `refreshing`은 domain당 한 loop만 candidate를 소유한다는 뜻이다. 추가 invalidation은
  같은 path/generation owner에 coalesce하며 lifecycle full refresh가 진행 중 domain에
  도착하면 그 lifecycle 경계 뒤에 해당 domain을 한 번 더 읽는다.
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

| Bit | Domain   | Authoritative existing reads                                                   | TOMAK storage mapping                                                                          |
| --: | -------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `0` | `KEYMAP` | dynamic keymap layer/buffer GET, encoder GET                                   | `DYNAMIC_KEYMAP`                                                                               |
| `1` | `MACRO`  | macro count/size/buffer GET                                                    | `DYNAMIC_MACRO`                                                                                |
| `2` | `CONFIG` | applicable persistent Keyboard Value/layout GET와 V3 Custom Value GET (`0x08`) | `ERA_CONFIG`, `QMK_RGB_MATRIX`, `QMK_KEYMAP_CONFIG`, `QMK_DEFAULT_LAYER`, `VIA_LAYOUT_OPTIONS` |

Uptime, switch-matrix telemetry, firmware version처럼 cache freshness 대상이 아닌
Keyboard Value는 CONFIG refresh에 포함하지 않는다. Firmware는 지원 mask를
반환한다. 지원하지 않는 domain은 기존 VIA 동작을 유지하며 advanced freshness로
거짓 표시하지 않는다.

각 token은 nonzero 32-bit RAM equality token이다. Corresponding GET이 새 값을
반환할 수 있는 commit boundary 뒤에 증가하고 wrap 시 zero를 건너뛴다. CONFIG의
RAM-first VIA setter는 값이 실제로 바뀐 semantic SET에서 바로 증가하고, 그
이미 공개된 runtime을 EEPROM에 쓰는 SAVE는 같은 전이를 다시 증가시키지 않는다.
setter를 거치지 않는 직접 EEPROM/firmware 변경은 기존 changed-run 탐지를 유지한다. 숫자
대소가 아니라 equality만 비교한다. Counter increment는 wrap 시 zero를 건너뛴다.
32-bit 전체가 두 관측 사이에 정확히 한 바퀴 도는 경우는 이론적 alias 반례지만,
500 ms poll 사이에 nonzero token 공간을 소진하려면 초당 약 86억 번의 semantic
commit이 필요하므로 현재 control-plane에서 도달할 수 없는 전제 위반으로 취급한다.

`CUSTOM_MENU`와 `KEYBOARD` 분리는 correctness 경계가 아니다. CONFIG full refresh가
실측상 크거나 layout change가 per-key RGB reread를 과도하게 유발하면 그때 네 번째
domain을 추가한다. Domain 수 변경은 envelope version 변경 없이 reserved mask bit와
후속 revision layout을 쓰지 말고, wire version을 올리는 별도 승인 대상으로 둔다.

## Capability gates

두 gate는 역할이 다르므로 둘 다 유지한다.

1. `config/era-definitions.manifest.json`의 canonical entry가 State Sync probe를 명시적으로
   opt in하고 build가 trusted runtime metadata를 생성한다. VIA V3 JSON schema나
   arbitrary sideload JSON에는 transport flag를 추가하지 않는다.
2. 그 metadata로 opt in된 연결만 아래 revision selector를 한 번 읽는다. 정상
   version/status/mask/tag/reserved-byte response만 capability confirmation이다.

이 구조의 구현 invariant는 **generic device scan, protocol-version check, ordinary
definition load에서는 probe 함수를 호출할 수 없고, effective source가 ERA overlay인
canonical opt-in branch만 호출할 수 있다**는 것이다. 같은 VPID의 official snapshot이나
Design upload가 effective source인 경우도 probe하지 않는다. Non-opt-in fake device의
command transcript가 upstream과 byte-for-byte 같다는 자동 test를 acceptance gate로
둔다.

Opt-in identity의 구형 firmware에는 probe 한 건이 갈 수 있다. 두 firmware 저장소 모두
`quantum/via.c`에서 unknown value/command를 `id_unhandled (0xFF)`로 돌려보내는 기존 pattern을
가진다(`qmk_firmware_eerraa`, `eerraa-qmk-h7s-fw`). TOMAK79H와 BRICK60은
top-level `via_command_kb()`를 override하지 않아 구형 image에서도 이 default 경로가
적용된다. 새 generation의 첫 selector query에서 unhandled, malformed response,
timeout은 구형 firmware와 통신 오류를 구분할 증거가 아니므로 `unverified`로 처리하고
반복 probe를 만들지 않는다. Raw Custom menu는 유지하되 모든 Custom GET/SET/SAVE와
per-key RGB I/O를 막고, 각 pane에 “지원 여부를 확인할 수 없습니다. 키보드를
재연결하세요. 문제가 지속되면 최신 펌웨어로 업데이트하세요.”를 표시한다. Capability가
이미 확인된 generation의 같은 오류는 transient poll failure로 처리하여 capability를
유지하고 다음 poll에서 dirty domain을 재시도한다. 실제 배포 firmware의 transcript는
실기기에서 별도로 확인한다.

## Accepted 32-byte wire contract

새 top-level command 대신 기존 read-only `GET_KEYBOARD_VALUE (0x02)`에 selector
**`0x06`** 을 쓴다. G1에서 확정했다.

WebHID report id `0`을 제외한 32-byte VIA payload 기준이다. Multi-byte integer는
기존 VIA와 같이 big-endian이고 모든 reserved byte는 zero여야 한다.

### Request

|    Byte | Meaning                              |
| ------: | ------------------------------------ |
|     `0` | existing `GET_KEYBOARD_VALUE (0x02)` |
|     `1` | `0x06` state-sync selector           |
|     `2` | envelope version `0x01`              |
|     `3` | zero                                 |
|  `4..5` | host request tag                     |
| `6..31` | zero                                 |

### Response

|     Byte | Meaning                                              |
| -------: | ---------------------------------------------------- |
|   `0..2` | echoed command, selector, envelope version           |
|      `3` | status: `OK=0`, `UNSUPPORTED_VERSION=1`, `INVALID=2` |
|   `4..5` | echoed request tag                                   |
|      `6` | supported-domain mask; initial known bits are `0..2` |
|      `7` | zero                                                 |
|  `8..11` | `KEYMAP` revision, or zero if unsupported            |
| `12..15` | `MACRO` revision, or zero if unsupported             |
| `16..19` | `CONFIG` revision, or zero if unsupported            |
| `20..31` | zero                                                 |

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

State Sync query는 예외적으로 16-bit request tag를 matcher에 포함한다. Timeout된
tag의 late response는 다음 tag를 resolve할 수 없으므로 그 pending request만 reject하고
transport generation과 이미 확인된 capability는 유지한다. 초기 probe timeout은
capability가 아직 없으므로 그 generation에서만 `unverified`로 기록하며, firmware
미지원인지 통신 오류인지는 단정하지 않는다.

모든 thunk와 adapter는 explicit device path/API/definition과 시작 generation을
capture한다. Redux commit 직전에 path와 generation을 다시 확인한다. 이는 필요한
core correction이지만 Redux 전면 재작성은 아니다.

이전 device의 늦은 completion은 **같은 path/generation의 아직 유효한 cache만** 갱신할 수
있고, 새로 선택된 device의 ready/current 상태는 절대 갱신하지 못한다. 마찬가지로 이전
selection generation은 새 selected device를 ready로 표시할 수 없다.

Domain refresh는 다음 순서다. Poll, initial confirmation, selection, reconnect, resume은
모두 같은 path/generation coordinator owner를 사용한다.

1. Domain start query를 읽고, 함께 관측된 세 token을 각각 observed로 기록한다. 이
   관측은 어떤 domain의 accepted revision도 대신 전진시키지 않는다.
2. 대상 domain을 `refreshing`으로 만들고 기존 VIA GET 결과를 Redux 밖의 isolated
   candidate에 모두 읽는다.
3. Domain end query를 읽고 세 observed token을 다시 기록한다.
4. 대상의 start/end revision이 같고 connection/selection generation, path, 그리고
   candidate를 해석한 definition identity/epoch가 유지된 경우에만 candidate 전체를
   Redux action 하나로 commit하고 `fresh(endRevision, generation)`로 둔다.
5. 다르면 candidate를 버리고 즉시 세 번까지 같은 bracket을 재시도한다. 세 번 모두
   churn이거나 GET/query가 실패하면 accepted snapshot은 그대로 두고 `dirty`를 유지해
   다음 visible poll 또는 lifecycle에서 다시 읽는다. Dirty domain은 observed 숫자가
   이전 관측과 같아도 반드시 재시도한다.

KEYMAP candidate는 모든 layer와 encoder map, MACRO candidate는 전체 macro buffer,
CONFIG candidate는 layout option과 적용 가능한 V3 menu/per-key RGB 값을 포함한다.
각 candidate는 full-domain bracket이 끝나기 전에 Redux current state를 patch하지
않는다. Ordinary lifecycle loader는 기존 동작을 유지한다.

End revision response 뒤와 Redux commit 사이에 firmware change가 생기는 창은 어떤
lock-free read protocol에도 남는다. 그 snapshot은 end query 시점에는 일관됐고 다음
visible poll에서 token mismatch로 dirty가 된다. 이 짧은 창까지 제거하려면 firmware
snapshot lock/value protocol이 필요하며 현재 목표보다 강하므로 추가하지 않는다.

## Lifecycle policy without a subscription state machine

- Selected capable device가 Configure에 들어오면 첫 query로 capability를 확인하고,
  probe 전에 lifecycle GET이 이미 끝났더라도 세 domain을 full refresh한다.
- 같은 connection generation에서 다른 device로 전환했다가 돌아오면 그 path의 세
  domain을 dirty로 두고 full refresh하여 selection 경계 밖 cache를 current로 간주하지
  않는다.
- Configure를 떠나면 poll을 중단한다. 다시 들어오면 eligibility가 회복되는 즉시
  revision poll을 수행한다.
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

| Fault                     | Advanced-capable device                                                                                            | Legacy `0x16` v1-only device                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 마지막 event 유실         | Advanced event 자체가 없다. 다음 revision poll이 최종 token을 읽는다.                                              | **반례:** 후속 `0x16`이나 lifecycle reload가 없으면 마지막 Custom Menu change는 자동 복구되지 않는다. 이 제한을 v1 compatibility로 유지한다. |
| Duplicate `0x16`          | 같은 CONFIG invalidation을 coalesce하며 GET 결과가 최종 권위다.                                                    | 중복 GET이 생길 수 있으나 값은 수렴한다.                                                                                                     |
| `0x16` 순서 변경          | Hint가 값을 싣지 않으므로 순서는 correctness에 영향 없다.                                                          | 각 hint가 범위를 좁힐 뿐이며 GET이 현재값을 읽는다.                                                                                          |
| Event overflow/coalescing | Advanced event queue가 없다. Revision token이 모든 중간 change를 final-state token 하나로 자연스럽게 coalesce한다. | Firmware가 마지막 v1 hint까지 잃으면 위 반례와 같다.                                                                                         |
| Refresh 도중 변경         | Start/end token mismatch로 candidate를 폐기한다. End 뒤 변경은 다음 poll이 찾는다.                                 | 추가 v1 hint가 있으면 다음 pass를 queue한다. 마지막 hint가 없으면 lifecycle 전까지 보장되지 않는다.                                          |
| Revision wrap             | Poll 사이 정확한 full wrap은 equality alias 반례다. Commit-rate bound로 금지해야 한다.                             | 해당 없음.                                                                                                                                   |
| Firmware reboot           | Re-enumeration generation과 full refresh로 숫자 equality를 무시한다. In-place silent reset은 아직 확인할 반례다.   | Lifecycle full refresh가 있으면 복구한다.                                                                                                    |
| Reconnect/device switch   | Path+generation별 freshness만 사용한다. 둘 다 revision equality를 신뢰하지 않고 full refresh한다.                  | 기존 VIA lifecycle load 범위만 보장한다.                                                                                                     |
| Hidden/resume             | Hidden poll은 0이고 resume full refresh로 revision equality를 신뢰하지 않는다.                                     | Resume full refresh를 app core 정책으로 적용하면 복구한다.                                                                                   |

이 증명은 firmware가 token increment hook을 빠뜨린 경우에는 성립하지 않는다. 그
failure는 event/ACK로도 고칠 수 없으며 setter coverage test와 TOMAK durable-boundary
fault injection으로 검증해야 한다.

## TOMAK durable peer boundary

QMK의 `era_host_peer_storage.c`는 bounded slice write 동안 host revision을 올리지
않는다. Pull과 push durable tail은 전체 domain을 다시 읽어 episode CRC와 비교하고,
성공한 경우 runtime reload를 끝낸 뒤 `era_state_sync_note_storage_domain()`을 호출한다.
그 뒤의 snapshot publish, rotation, close가 실패하더라도 기존 VIA GET이 읽을 수 있는
target state는 이미 바뀌었으므로 revision 증가는 유지된다.

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

H7S의 VIA response는 **single producer**다. `via_hid.c`가 USB RX를 bounded queue에 복사하고,
main loop에서 `raw_hid_receive()`로 request buffer를 mutate한 뒤 그 buffer를
`usbHidEnqueueViaResponse()`에 **한 번** 넣는다. 같은 파일의 `raw_hid_send()`는 빈 stub이고,
`usbd_hid.c`가 ordinary VIA response queue와 enqueue owner를 가진다. Keyboard input report는
별도 queue/endpoint 경로다.

Polling-first에서는 unsolicited event가 없으므로 H7S에 두 번째 VIA-IN producer나 event
dispatcher를 만들지 않는다. selector handler는 기존 request buffer만 채우고, 현재 main-loop
response owner가 ordinary response와 같은 방식으로 한 번 enqueue한다.
**`raw_hid_send()`를 채우거나 별도로 enqueue하면 중복 response가 된다.**

`usbd_hid.c`에서 VIA descriptor의 IN endpoint `0x84`가 아니라 `HID_VIA_EP_OUT (0x04)`을
`USBD_LL_Transmit()`에 넘기는 source discrepancy가 있다. **실제 hardware가 동작한다는 이유로
추정 수정하면 안 된다.** lower-layer direction 처리와 completion/busy ownership을 read-only
trace하고 hardware로 확인한 뒤에만 손댄다.

Revision poll은 ordinary request/response 하나이므로 event가 response를 지연·유실시키는
경우는 없다. H7S에서 20 ms VIA response pacing과 HS 8 kHz 입력에 대한 poll off/on A/B —
keyboard interval/jitter, input queue overflow, VIA latency/timeout — 는 아직 남은 실기
측정이다.

## Compatibility conclusion

| Target                                       | Conclusion and invariant                                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 일반 VIA keyboard                            | Canonical opt-in metadata가 없으므로 capability selector를 포함한 새 command가 단 한 건도 나가지 않는다. 기존 V3 definition load와 `0x01..0x15` transcript가 upstream과 같아야 한다. |
| ERA opt-in definition + 확인 불가 firmware    | Read-only selector probe 한 건의 `0xFF` unhandled/malformed/timeout을 `unverified`로 처리하고 ARM/poll 및 Custom I/O를 시작하지 않는다. Raw Custom 메뉴와 재연결/최신 firmware 안내는 유지한다. |
| Official VIA client + advanced ERA firmware  | Firmware는 unsolicited advanced packet을 보내지 않는다. Official client가 새 selector를 요청하지 않으므로 기존 command 의미와 response는 그대로다.                                   |
| `0x16` v1                                    | Advanced capability와 무관하게 기존 packet grammar와 Custom Menu GET adapter를 유지한다. Suppression, v2 reinterpretation, ARM 의존성을 추가하지 않는다.                             |
| Protocol versions 7–13                       | Version 숫자를 State Sync capability로 재해석하지 않는다. 오직 canonical opt-in 뒤 selector response만 capability다.                                                                 |

현재 두 reference firmware에서 이름 기반 검색으로 `0x16` v1 emitter/parser는
확인되지 않았다. 따라서 “기존 v1 유지”는 app compatibility 결론이며, 실제 배포
ERA image의 v1 transcript와 advanced firmware에서의 병존은 hardware로 확인해야
한다.

## Excluded alternatives

위 판정표가 제거한 메커니즘 외에 다음 설계도 제외한다. 표에 없는 것만 적는다.

- **`0x16`을 bidirectional v2로 확장:** v1 unsolicited grammar와 response matching을
  섞고 공식 behavior를 불필요하게 바꾼다.
- **Event-only sync:** 마지막 event 유실을 복구하지 못한다.
- **New split exact-range transport:** 기존 durable apply boundary와 domain mapping이면
  correctness에 충분하다.
- **Redux-wide rewrite:** explicit-device thunk와 작은 freshness coordinator면 된다.

미측정 상수(five-second watchdog, 15-second lease)를 protocol에 넣지 않는다. timeout과
rate는 측정된 파라미터로 다룬다.

## Consequences

초기 firmware/app 상태는 세 revision token, read-only query, per-device freshness로
제한된다. Official client 안전성은 lease timeout의 확률적 보호가 아니라 unsolicited
advanced traffic이 없다는 구조적 성질이 된다. 그 대가로 selected visible device의
변경 표시 latency는 poll interval만큼 생기며, CONFIG domain을 합친 refresh 비용과
H7S control-plane 영향은 실측해야 한다.

State Sync opt-in이 아닌 legacy v1-only device는 기존 동작을 유지하지만 마지막 `0x16`
유실을 자동 복구하지 못한다. Opt-in ERA overlay에서 capability를 확인하지 못한 연결은
일반 VIA keymap 흐름을 유지하되 Custom I/O를 의도적으로 차단하고 안내문을 표시한다.
Advanced-capable device만 bounded automatic convergence를 얻는다.

## Verification

### App fake-device and transport tests

`tests/state-sync-transport.test.ts`, `tests/transport-phase1.test.ts`,
`tests/era-state-sync.test.ts`가 아래를 검증한다.

1. Non-opt-in ordinary keyboard transcript에는 selector `0x06`이 없고 기존 VIA 흐름이
   유지된다.
2. Opt-in old firmware의 tagged `0xFF`, malformed response, initial timeout은 한 번만
   probe하고 `unverified` 안내 상태가 되며, Custom GET/SET/SAVE는 0건이고 늦은 응답이
   다음 command를 소비하지 않는다.
3. Envelope version, status, tag, mask, reserved bytes와 nonzero big-endian revision을
   strict하게 검사한다.
4. Initial lifecycle GET과 probe 사이 race에서 probe revision을 stale snapshot에
   붙이지 않고 capability confirmation 뒤 full bracket을 수행한다.
5. 한 domain refresh의 query에서 관측한 다른 domain revision은 그 domain을 dirty로만
   만들며 accepted revision을 전진시키지 않는다.
6. Capable connection의 일시 timeout/malformed는 capability를 유지하고 다음 poll에서
   회복한다. Dirty domain은 observed revision equality와 무관하게 재시도한다.
7. 세 번의 churn 동안 candidate를 모두 폐기하고, 다음 poll의 stable bracket에서
   최종값으로 수렴한다.
8. Keymap layer/encoder, macro, layout/menu/per-key RGB candidate는 stable bracket 전
   Redux에 노출되지 않는다.
9. Poll과 lifecycle full refresh가 하나의 path/generation owner로 coalesce하고,
   lifecycle 요청이 in-flight domain 뒤 재검증을 보장한다.
10. Device A/B, selection generation, reconnect generation이 격리되며 hidden traffic은
    계속 0이고 resume은 full refresh한다.
11. Strict `0x16 v1` all/channel-command/command-id semantics, raw Custom menu 유지,
    초기 확인 실패 후 Custom GET/SET/SAVE 0건을 검증한다.

### QMK automated evidence

1. Host test는 accepted envelope, unsupported version, invalid reserved/short buffer,
   big-endian tag/revision, seven-to-three mapping, counter wrap zero skip를 검증한다.
2. Dynamic keymap와 encoder range, macro, VIA layout options, ERA syncable CONFIG,
   `EECONFIG_RGB_MATRIX`, `EECONFIG_KEYMAP`, `EECONFIG_DEFAULT_LAYER`의 changed write가
   정확한 host domain만 올리고 unchanged write는 올리지 않음을 검증한다.
3. ERA protected local-policy range는 CONFIG revision을 올리지 않는다.
4. QMK EEPROM changed-run hook이 실제 변경 span만 전달하고, split durable tail이 full
   readback CRC와 runtime reload 뒤에만 host-domain revision을 올리는 source boundary를
   유지한다. 전체 split fault-injection seam은 이 계약만을 위해 새로 만들지 않는다.
5. Host tests와 각 TOMAK VIA release build에는 document/source-map/knowledge-graph gate와
   copy-to-RAM residency gate를 적용한다.
6. Official VIA + official JSON 경로: legacy 1-byte SET/GET(10/14/50 → 100/140/500 ms),
   exact range SET 100–500, custom exact store 1/65535에 대한 legacy GET clamp,
   그리고 GET가 exact store를 다시 쓰지 않음을 검증한다. JSON `options`를 커스텀
   앱 범위로 넓히는 것은 회귀다.

## Probe 대상과 앱에서 보이는 결과

앱은 매니페스트에서 `stateSync: true`인 정의로 열린 연결에만 probe한다. 현재 그 대상은
31종 중 30종이다(`brick65` 제외 — `docs/MAP.md` §2). **여기에는 H7S 5종도 포함된다.**

probe가 `unverified`로 끝나면 `getCustomMenuAvailabilityForDevice()`가 그 장치의 **Custom
pane 전체**를 안내 문구로 대체한다. keymap 등 일반 VIA 흐름은 유지되지만 Custom GET/SET/SAVE와
per-key RGB I/O는 그 connection generation 동안 막힌다. USB 진단 블록도 Custom pane 안에 있으므로
함께 사라진다([ADR 0002](0002-h7s-usb-diagnostics.md) §"State Sync opt-in과의 결합").

## 남은 실기 증거

자동 검증은 실기기 증거를 대신하지 않는다. 남은 항목:

- 실제 TOMAK 좌·우 플래시 후 반대편 durable apply와 UI 수렴 관찰
- official VIA client 및 배포 firmware의 `0x16 v1` transcript
- USB reconnect / in-place silent reset 행동
- legacy timeout 뒤 endpoint flush 행동 (이것이 확인되기 전에는 fail-closed를 유지한다)
- H7S의 8 kHz poll off/on 성능 측정

실기기 플래시나 펌웨어 변경은 이 ADR의 구현 완료를 이유로 자동 승인되지 않는다.
