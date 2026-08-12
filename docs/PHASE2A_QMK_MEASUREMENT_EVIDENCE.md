# Phase 2A QMK 계측·fault-injection 근거

조사 기준일은 2026-08-13이다. 이 문서는 State Sync production protocol 설계가 아니라,
실기기 실험 전에 software-only로 닫을 수 있는 ownership·ordering·호환성 증거와 별도 QMK
수정 작업의 최소 경계를 기록한다.

## 조사 기준선

- App: `feat/era-state-sync` / `e3dddb2b110bb34eb707ff83dd902949d86909a4`
- QMK reference: `goal/era-arch-autonomous-run` /
  `391d31735eceabd3e26508035101d90c7335b420` (clean, 읽기 전용)
- H7S reference: `main` / `cd4473b7896549bb5481b873901da7fc8b5320e4`
  (clean, 읽기 전용)
- upstream `the-via/app` `main`: `510317d811efed929e5cc6543a7ea4495b03b00e`

QMK/H7S 기준선은 움직일 수 있다. 구현 에이전트는 작업 시작 직전에 다시 확인해야 하며,
위 해시가 다르면 이 문서의 line number보다 새 HEAD의 함수와 owner를 우선한다.

## 권고안

가장 작은 seam은 **기본값 off인 compile-time instrumentation**이다. QMK의 TEST 플랫폼은
이미 `platforms/test/timer.c`의 `set_time()`, `advance_time()`, `timer_read32()`를 제공하고,
`host_driver_t.send_raw_hid`는 별도 fake sender로 교체할 수 있다. 따라서 production 전역
callback, 새 weak ABI, 새 protocol command 또는 response tag는 필요 없다.

계측이 켜진 진단 image에서만 다음을 컴파일한다.

1. 요청별 내부 sequence와 고정 크기 trace ring
2. 특정 기존 command의 N번째 response만 복사해 보류하는 고정 크기 hold queue
3. `raw_hid_task()` 제어 경로의 non-blocking release pump
4. ChibiOS raw endpoint의 RX post, TX enqueue 결과, TX start/completion hook

계측이 꺼진 release image에는 모듈 source, state, hook call, symbol과 build define이 모두 없어야
한다. 계측이 켜져도 response 32 bytes에는 sequence, tag, debug byte를 삽입하지 않는다.

## 1. QMK VIA request/response call chain

TOMAK79H는 ChibiOS 경로를 사용하며 현재 `via_command_kb()`를 override하지 않는다.
`via_custom_value_command_kb()`만
`keyboards/era/common/split/era_split_board.c:113-149`에서 소유한다.

정확한 ordinary VIA 경로는 다음과 같다.

```text
USB OUT transaction completion (ISR)
  tmk_core/protocol/chibios/usb_driver.c:230-250
  usb_endpoint_out_rx_complete_cb()
    -> ibqPostFullBufferI(); 다음 OUT receive 시작

QMK main loop
  quantum/main.c:47-76
    -> raw_hid_task() at 53-56
  tmk_core/protocol/chibios/usb_main.c:517-522
    -> receive_report(USB_ENDPOINT_OUT_RAW, ..., TIME_IMMEDIATE)
       at 433-435
    -> raw_hid_receive(buffer, 32)

VIA dispatch/response-ready
  quantum/via.c:290-481 raw_hid_receive()
    -> via_command_kb() at 296 (TOMAK은 weak false 사용)
    -> command switch at 300
    -> 같은 32-byte buffer를 response로 변형
    -> raw_hid_send(data, length) at 481

Raw HID host driver
  quantum/raw_hid.c:7-9 raw_hid_send()
    -> tmk_core/protocol/host.c:345-351 host_raw_hid_send()
    -> tmk_core/protocol/chibios/chibios.c:69-78 chibios_driver.send_raw_hid
    -> tmk_core/protocol/chibios/usb_main.c:509-515 send_raw_hid()
    -> send_report(USB_ENDPOINT_IN_RAW, ...) at 392-394
    -> tmk_core/protocol/chibios/usb_driver.c:252-298
       usb_endpoint_in_send(..., TIME_MS2I(100), false)
    -> output buffer queue copy/flush
    -> usb_driver.c:55-73 obnotify()의 usbStartTransmitI()
    -> usb_driver.c:185-228 usb_endpoint_in_tx_complete_cb()
```

`usb_endpoint_in_send()`는 성공 시 caller buffer를 endpoint queue에 복사하고 flush하지만,
공간이 없으면 최대 100 ms 기다릴 수 있다. 현재 `send_raw_hid()`는 그 boolean 결과를 버린다.
`usbStartTransmitI()`는 controller 전송 시작이지 browser 수신이 아니며, IN completion callback도
device controller transaction 완료이지 OS/WebHID callback 완료가 아니다.

## 2. 관찰 가능한 timestamp와 의미

| event | exact hook | 의미 | 의미하지 않는 것 |
| --- | --- | --- | --- |
| RX complete/post | `usb_endpoint_out_rx_complete_cb()`가 RAW OUT buffer를 post하기 직전 | device USB stack이 OUT transaction을 완료해 queue에 공개한 시각 | dispatch 시작, browser send 시각 |
| dispatch start | `raw_hid_task()`가 RAW queue에서 32 bytes를 꺼낸 직후, `raw_hid_receive()` 직전 | main-loop queue 대기를 끝내고 handler를 시작한 시각 | USB wire 도착 시각 |
| response-ready | `quantum/via.c` 최종 `raw_hid_send()` 직전 | VIA handler가 response bytes를 완성한 시각 | endpoint enqueue 또는 전송 완료 |
| dispatch end | `raw_hid_receive()`가 `raw_hid_task()`로 반환한 직후 | handler 전체가 끝난 시각. immediate response에서는 TX call/enqueue 뒤일 수 있음 | response-ready와 동일한 경계 |
| TX call | ChibiOS `send_raw_hid()`가 `send_report()`를 호출하기 직전 | raw endpoint send 시도 | queue 성공 |
| TX enqueue result | `send_report()` 반환 직후 | 성공이면 endpoint output queue에 복사·flush됨. 전후 차이는 최대 100 ms wait도 포함 | controller/host 수신 |
| TX start | RAW endpoint의 `obnotify()` 또는 completion callback이 `usbStartTransmitI()`를 호출할 때 | controller가 해당 IN buffer 전송을 시작함 | host/browser 전달 |
| TX completion | RAW IN의 `usb_endpoint_in_tx_complete_cb()` | device controller가 IN transaction 완료를 알림 | OS가 HID report를 새 listener에 전달함 |

RP2040 진단 image의 trace clock은 ISR에서도 읽을 수 있는 monotonic microsecond source를 쓰고,
TEST 플랫폼에서는 기존 fake `timer_read32()`를 같은 내부 단위로 변환한다. hold deadline은
wrap-safe elapsed 비교를 사용한다. fake timestamp는 ordering/state-transition 증거일 뿐 실제
browser·USB·MCU latency 표본으로 보고하지 않는다.

ISR hook은 고정 크기 record 한 건 기록 외에 logging, formatting, allocation, CRC 전범위 계산,
blocking 또는 send를 해서는 안 된다. payload fingerprint가 필요하면 main-loop에서 계산하거나
ISR에서는 고정된 소수 byte만 복사한다.

## 3. hardware 없는 handler/fake-time/fake-TX 기반

기존 기반은 충분히 가깝지만 VIA 통합 test target은 아직 없다.

- `builddefs/build_test.mk:47-75`: `PLATFORM=TEST`, full gtest target 지원
- `builddefs/testlist.mk:1-23`: `tests/**/test.mk`를 자동 발견하므로
  `tests/era_via_phase2a/test.mk`는 `make test:era_via_phase2a`가 된다.
- `platforms/test/timer.c:56-71`: deterministic `timer_read32()`, `set_time()`,
  `advance_time()`
- `tmk_core/protocol/host_driver.h:26-35`: `RAW_ENABLE`에서
  `host_driver_t.send_raw_hid` 제공
- `tests/test_common/TestDriver`는 raw sender mock을 제공하지 않으므로 새 test fixture가 자체
  `host_driver_t`와 captured-report vector를 소유해야 한다.
- 현재 `tests/`에는 VIA/raw HID handler를 직접 검증하는 target이 없다.

우선 `VIA_ENABLE=yes`인 full test target을 compile flag `no`와 `yes` 두 clean configuration으로
실행하고 실제 `quantum/via.c::raw_hid_receive()`를 링크한다. on test는 production과 같은
`dispatch_begin -> raw_hid_receive -> dispatch_end -> pump`를 호출하고 fake host driver가
32-byte response를 복사하며, off test도 같은 ordinary fixture를 검사한다. 의존성 때문에 full
VIA handler link가 현재 TEST 플랫폼에서
불가능하면 instrumentation state machine만 test-only translation unit로 시험하고, handler
통합은 TOMAK compile-only 증거로 분리해 보고해야 한다. 이를 hardware-tested라고 표현하지 않는다.

## 4. 최소 production seam

다섯 선택지 중 주 seam은 **compile-time flag**다.

- `ERA_VIA_PHASE2A_INSTRUMENTATION_ENABLE ?= no`를
  `keyboards/era/era_build_options.mk`에 선언한다.
- 진단 source/`-D`는 해당 selector가 `yes`일 때만 ERA rule fragment에서 추가한다.
- TOMAK production/release profile은 명시적으로 `no`를 유지한다.
- `#if defined(ERA_VIA_PHASE2A_INSTRUMENTATION_ENABLE)` 내부에서만 QMK core hook을 보이게 한다.
- `no`/미지정 빌드에서는 기존 `raw_hid_send(data, length)` statement가 그대로 전처리 결과에
  남아야 한다.

link-time override는 `raw_hid_send()`가 weak가 아니어서 부적합하고, 이를 새 weak ABI로 바꾸면
전체 QMK raw HID surface를 넓힌다. production injected callback도 불필요하다. fake clock은 기존
TEST timer, fake TX는 기존 host driver seam을 사용한다. test-only translation unit는 실제 VIA
통합 link가 불가능할 때만 제한적인 fallback이다.

## 5. 동일 legacy GET의 provenance와 결정적 교차

계측 owner는 VIA handler와 raw endpoint 사이의 compile-gated 모듈이다. 상태는 다음으로
한정한다.

- monotonically increasing internal `request_seq` (`0`은 untracked/reserved)
- RX ordinal/timestamp를 dispatch에 순서대로 연결하는 bounded FIFO
- command prefix + occurrence index를 대조하는 fault configuration
- `{seq, ready_at, release_at, length, response[32], fingerprint}`의 bounded hold queue
- successful TX enqueue 순서를 `{seq, fingerprint}`로 보존하는 bounded provenance FIFO
- fixed-size trace ring과 dropped/overflow counter

예를 들어 기존 `id_get_protocol_version`의 첫 번째 response만 match해 복사·보류한다.
동일한 두 번째 GET은 즉시 기존 TX path로 보낸다. fake time advance 또는 test-only explicit
release 뒤 pump가 첫 번째를 보낸다. wire bytes가 두 response에서 같아도 trace의
`seq=2 TX_*` 뒤 `seq=1 TX_*`로 provenance를 구분한다. sequence/tag는 response payload에
넣지 않는다.

TX start/completion은 successful-enqueue FIFO의 head와 결합한다. 계측되지 않은 raw send는
`seq=0`으로 넣어 FIFO 정렬을 보존한다. reset, USB deconfigure/disconnect/suspend 또는 queue
상태 불일치는 hold/provenance state를 비우고 explicit reset record를 남긴다.

## 6. non-blocking hold/release 경계

보류는 response-ready에서 32 bytes를 고정 queue에 복사하고 즉시 반환한다. sleep, busy wait,
timer loop 또는 기존 caller buffer 보관은 금지한다. caller의 stack buffer는
`raw_hid_task()` 다음 iteration에서 재사용되므로 반드시 복사해야 한다.

release pump는 matrix ISR/scan이 아니라 `usb_main.c::raw_hid_task()`의 RAW control path 끝에서만
동작한다. 보류 항목이 있고 deadline/explicit release가 충족된 경우에만
`usb_endpoint_in_is_inactive(&usb_endpoints_in[USB_ENDPOINT_IN_RAW])`
(`usb_driver.c:326-334`)를 확인한다. idle일 때 한 항목만 기존 `raw_hid_send()`에 넘긴다.
같은 main-loop owner 안에서는 check와 enqueue 사이에 다른 raw sender가 끼어들지 않으므로,
100 ms queue wait를 회피한다. busy/USB inactive이면 그대로 보존하고 다음 pump에서 재시도한다.

hold queue가 가득 차면 fail-open으로 원래 32 bytes를 즉시 기존 path로 보내고 overflow trace를
남긴다. provenance/trace ring이 가득 찬 경우 오래된 trace를 overwrite하거나 신규 trace를
drop하는 정책을 하나 명시하되, response는 버리지 않는다. send/enqueue 실패는 해당 held item을
유지해 bounded retry하고 disconnect/reset에서 폐기한다. 한 pump에서 여러 send, allocation,
print, EEPROM 또는 split-wire 작업을 하지 않는다.

## 7. transcript와 production 격리 증명

hardware 없이 다음 세 층을 증명한다.

1. host-native actual VIA handler test에서 계측 off, 계측 on/fault disabled가 같은 request
   fixture에 대해 response bytes, length와 ordering이 완전히 같은지 byte-for-byte 비교한다.
2. fault enabled test에서는 의도된 ordering만 다르고 각 response 32 bytes가 uninstrumented
   baseline과 같은지 비교한다.
3. 같은 clean HEAD와 고정 build date로 TOMAK release를 flag 미지정과 explicit `no`로 각각
   빌드해 ELF/UF2 hash, section/symbol/map을 비교한다. `nm`/map에
   `era_via_phase2a_*` symbol과 instrumentation source가 없어야 한다.

on image의 timing/state는 진단 비용을 가진다. 따라서 on/off timing 동일성을 주장하지 않는다.
off image의 code/state/config 부재와 on/no-fault transcript 동등성을 각각 증명한다.

## 8. App Phase 1이 이미 증명한 것과 firmware evidence

`tests/transport-phase1.test.ts`의 9개 focused test와 `src/shims/node-hid.ts` fake hooks가 이미
software-only로 증명한 것은 다음과 같다.

- path-local queue/pending/listener/generation ownership과 request serialization
- timeout 뒤 generation poison 및 그 generation의 queued/pending reject
- replacement generation이 생긴 뒤 old listener callback이 발생해도 drop됨
- disconnect/reconnect 뒤 old listener callback drop
- strict `0x16 v1` report는 pending matcher보다 먼저 UI-sync handler로 분류됨
- ordinary `KeyboardAPI` request가 report ID 0 + 32-byte VIA payload를 유지함
- malformed `0x16 v1` grammar/bounds reject
- device/definition selection 전환 시 captured old API가 새 cache를 완료하지 못함

현재 `configureHIDTransport({now})`는 diagnostic/write timestamp만 deterministic하게 하고,
timeout scheduler 자체는 real `setTimeout`을 쓴다. 이를 fake scheduler로 바꾸면 test 안정성은
개선할 수 있지만 browser/OS가 old endpoint packet을 새 listener에 배달하는지 증명하지는
못한다. 이번 Phase 2A ownership 질문을 추가로 닫지 않으므로 app test/source를 바꾸지 않는다.

firmware evidence가 더 필요한 것은 동일 legacy response의 생성 request provenance,
response-ready/TX enqueue/start/completion ordering, 지연된 첫 response가 timeout/replacement와
교차하는 transcript, 그리고 계측 off production 격리다. wire tag가 없는 동일 legacy GET은
app에서 bytes만 보고 원래 request를 식별할 수 없다는 한계도 그대로 남는다.

## 9. TOMAK durable commit와 H7S 비교 경계

TOMAK peer storage의 local intent와 durable peer commit을 혼동하지 않는다.

- local EEPROM write 관찰:
  `era_host_peer_storage.c:956-1008`의
  `era_host_peer_storage_note_domain_dirty()` / `nvm_eeprom_changed_kb()`
- sliced peer write:
  `era_host_peer_storage.c:1940-1951`의 `eeprom_update_block()`
- durable readback + CRC + runtime reload:
  `era_host_peer_storage_apply_write_finish():1953-2006`, reload at 1965
- push responder의 같은 경계:
  `era_host_peer_storage_push_apply_finish():2009-2057`, reload at 2026
- domain reload owner:
  `keyboards/era/sirind/common/tomak_common.c:290-316`

향후 revision hook을 검토한다면 peer 값이 GET으로 읽힐 수 있는 최초 경계는 successful
readback/CRC와 `era_split_eeprom_sync_reload_domain_kb()` 직후다. TRANSFER, APPLY_READY 또는
source-half intent가 아니다. 이번 계측 hook은 그 사실을 관찰할 수는 있어도 revision counter,
selector 또는 event를 구현하지 않는다.

H7S `cd4473b...`는 비교 ownership만 확인했다. `via_hid.c:69-88`은 ISR callback에서 16-entry
RX queue로 복사하고, `via_hid_process():91-116`은 main loop에서 `raw_hid_receive()` 후
`usbHidEnqueueViaResponse()`를 한 번 호출한다. H7S의 `raw_hid_send():64-67`은 빈 stub이고,
`usbd_hid.c:1224-1249`가 별도 VIA response queue owner다. 따라서 QMK seam을 H7S에 그대로
적용하거나 H7S TX owner를 이번 작업에서 바꾸지 않는다.

## Software-only test matrix

| case | proof |
| --- | --- |
| ordinary GET/SET/custom fixtures, instrumentation off | actual handler response baseline |
| instrumentation on, fault disabled | bytes/length/order가 baseline과 동일 |
| fake time fixed/advanced | trace timestamp와 deadline transition이 입력값대로 재현됨 |
| 첫 동일 GET hold, 둘째 immediate, 첫째 release | captured TX order `seq2, seq1`; 두 response bytes는 baseline과 동일 |
| endpoint busy/fake sender unavailable | pump가 block/drop하지 않고 항목을 유지 |
| hold queue overflow | fail-open immediate send, overflow counter/trace |
| trace wrap | bounded overwrite/drop 정책과 counter |
| disconnect/reset | held/provenance state 폐기, 이전 sequence가 새 session과 결합되지 않음 |
| transcript replay | ordinary request/response fixture가 off/on-no-fault에서 동일 |
| TOMAK release compile, flag absent/no | instrumentation source/symbol/config 없음; artifact 동등성 |
| diagnostic TOMAK compile | enabled hooks와 bounded static state만 포함; 새 selector 없음 |

이 matrix는 ownership, ordering, timeout state transition과 transcript compatibility를
증명한다. fake delay percentile은 실제 latency가 아니므로 만들거나 5000 ms app timeout을
조정하는 근거로 사용하지 않는다.

## Hardware-only uncertainty와 최소 후속 실험

software-only로 원리상 확인할 수 없는 항목은 다음과 같다. 이번 세션에는 수행하지 않는다.

1. **browser/OS callback latency와 timer throttling**: 별도 승인 후 한 OS/browser 조합에서
   firmware TX completion trace와 WebHID `inputreport` 시각을 같은 ordinary GET에 대해 최소
   반복 측정한다. artificial delay 표본은 실제 latency 분포에서 제외한다.
2. **close/open 또는 물리 재열거 중 endpoint packet 보존**: 첫 동일 GET을 보류하고 app
   timeout/generation poison 뒤 명시적으로 재열거한 다음 old response를 release해 새
   `HIDDevice` listener에 전달되는지 확인한다. 이는 OS별 동작이며 fake WebHID가 증명할 수 없다.
3. **실제 MCU/USB SOF에서 enqueue/start/completion 간격**: QMK/TOMAK 계측 image로 RAW queue
   wait, controller scheduling과 disconnect failure를 측정한다. firmware timestamp와 browser
   수신 사이 구간은 별도다.
4. **8 kHz input jitter/endpoint contention**: production-off와 diagnostic-on을 양쪽 TOMAK
   orientation에서 비교하고 scan/report jitter와 queue overflow를 확인한다. H7S는 별도 승인된
   polling 구현이 있을 때만 기존 input/VIA queue를 A/B 측정한다.
5. **실기기 배포 firmware 기능/리셋 형태**: `0x16 v1` 실제 지원, unknown selector unhandled,
   in-place silent reset 대 USB 재열거 여부는 대상 firmware/board에서 최소 한 번 확인한다.

## 아직 결정하지 않는 production Phase 2 gate

- `GET_KEYBOARD_VALUE` selector 숫자와 wire layout
- capability/revision query와 KEYMAP/MACRO/CONFIG domain model
- polling interval, visible-only policy, resume/reconnect full refresh
- revision-bracketed atomic refresh와 CONFIG read cost
- semantic/range event, nonce, ARM/lease, subscription, event sequence
- H7S unsolicited VIA TX ownership

ADR `0001-state-sync-protocol.md`는 계속 `Status: Proposed`다. 위 software 증거와 필요한 최소
hardware 결과를 검토한 뒤 별도 승인 전에는 production State Sync app/firmware 구현으로
진입하지 않는다.
