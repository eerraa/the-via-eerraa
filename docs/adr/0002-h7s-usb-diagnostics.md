# 0002 — H7S USB 전달 진단 계약과 VIA UX

Status: Accepted

## Context

기존 H7S firmware의 USB instability monitor는 SOF 간격을 heuristic score로 바꾸고
8K → 4K → 2K → FS downgrade, EEPROM BootMode 변경, reset까지 수행했다. 현재 제품
정책은 FS 1K를 기본으로 하되 고속 polling mode는 사용자가 직접 선택하고 firmware가
그 결정을 되돌리지 않는 것이다. SOF 도착은 실제 HID report 전달 완료도 아니므로 이
정책과 계측 의미를 함께 바로잡아야 했다.

Firmware audit에서 USB IRQ는 main loop와 별개이며 기존 monitor가 전제한 SOF score는
실제 report queue wait와 keyboard IN `DataIn` 완료를 측정하지 않는다는 점을 확인했다.
App audit에서는 WebHID transport가 path별 단일 직렬 queue, tagged response matcher,
connection generation invalidation을 이미 제공하고, chart dependency 없이 SVG/CSS로
작은 시각화를 통합할 수 있음을 확인했다.

## Decision

### 제품 경계

- Firmware는 USB 안정성 score나 stable/unstable 판정을 만들지 않는다.
- Diagnostics는 polling mode, EEPROM, reset, recovery state를 변경하지 않는다.
- 사용자가 VIA의 기존 BootMode control로 mode를 바꾸고 재부팅한 뒤 각각 별도
  10/30/60초 test를 실행한다. 앱은 mode를 자동 순회하지 않는다.
- Firmware 진단 state와 aggregate는 RAM-only다. 장기 history만 host localStorage에
  둔다.
- selector probe는 canonical ERA metadata의 `usbDiagnostics: true`인 다섯 H7S
  definition에서만 허용한다. Ordinary/official/upload definition에는 새 packet을
  전송하지 않는다.

### 계측

Always-on 계측은 사건이 실제 발생할 때만 포화형 `uint32` counter를 갱신한다.

- keyboard/EXK retry queue가 report를 받지 못한 실제 drop
- USB reset, HID configuration, suspend, negotiated speed change

On-demand session에서만 다음 timestamp를 읽는다.

- HID delivery: `usbHidSendReport()`가 report를 받은 시각부터 keyboard IN
  `DataIn` 완료까지. Queue에 들어갈 때 원 요청 시각과 session ID를 보존한다.
- Firmware timing: 연속 `qmkUpdate()` 진입 사이 gap, 최대 gap, 1000 µs 초과 건수
- Queue depth peak
- polling interval에 대한 0.5/0.75/1/1.25/1.5/2/4배 경계의 8-bin histogram
- hard event와 1 ms 초과 loop stall의 최근 8개 bounded timeline

Histogram quantile은 raw percentile이 아니라 해당 bucket의 상한 경계로 표시한다.
앱은 연속 coherent snapshot의 누적 histogram 차이로 약 1초 window의 p99 경계를
만들고, firmware가 매 snapshot마다 초기화하는 window maximum과 함께 time-series로
표시한다.

SOF high-resolution 계측은 제거한다. 매 125 µs hot path timestamp 비용이 있고 실제
HID delivery와 다른 신호인데도 과거 heuristic 오해를 다시 만들기 쉽다. Matrix timing
probe도 기존 개발용 instrumentation과 중복되므로 release session contract에 넣지
않는다. Synthetic health/quality/stability score와 arbitrary 색상 판정은 만들지 않는다.

### VIA 정보 구조

Diagnostics는 기존 global pane routing에 `/diagnostics`로 들어간다.

- connection: polling mode, negotiated speed, duration/state
- factual result summary: queue drop과 USB hard event의 관측 건수
- HID delivery: sample/min/average/max, queue peak, histogram quantile bound
- timing trend: 약 1초 window p99 bound, worst, configured interval reference
- normalized distribution: 8-bin count/rate
- firmware timing: main-loop max gap과 1 ms 초과 count
- USB event counters와 bounded timeline
- same VPID + firmware version + diagnostics protocol만 비교하는 local mode history
- factual text `Copy Diagnostic Report`

"No report queue drops were observed during this test"는 허용하지만 perfect/stable/
certified 같은 관측 범위를 넘는 표현은 금지한다.

## Wire contract

기존 VIA `GET_KEYBOARD_VALUE(0x02)` / `SET_KEYBOARD_VALUE(0x03)`에 selector
`0x07`을 추가한다. Packet은 report ID를 제외한 정확히 32 B, protocol v1,
big-endian이다. Firmware는 요청에 대한 응답만 보내며 unsolicited producer를 만들지
않는다.

### Request

| Byte | Field                                      |
| ---- | ------------------------------------------ |
| 0    | command: GET `0x02` 또는 SET `0x03`        |
| 1    | selector `0x07`                            |
| 2    | protocol version `0x01`                    |
| 3    | operation                                  |
| 4–5  | host tag, BE16                             |
| 6    | duration seconds 또는 snapshot chunk index |
| 7–8  | snapshot sequence; chunk 0은 0             |
| 9–31 | reserved, 반드시 0                         |

Operation은 capabilities `0x00` GET, snapshot `0x01` GET, start `0x10` SET,
stop `0x11` SET, clear `0x12` SET이다. Start duration은 10/30/60만 허용한다.

### Common response

| Byte  | Field                                           |
| ----- | ----------------------------------------------- |
| 0–5   | command, selector, v1, operation, echoed tag    |
| 6     | status                                          |
| 7     | state: idle 0, running 1, complete 2, stopped 3 |
| 8–9   | session ID, BE16; no session은 0                |
| 10–11 | frozen snapshot sequence, BE16                  |
| 12    | chunk index                                     |
| 13    | chunk count                                     |
| 14–31 | 18 B operation payload                          |

Status는 OK 0, unsupported version 1, invalid 2, busy 3, no session 4,
stale snapshot 5다.

### Capabilities payload

| Payload byte | Field                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| 0            | flags: report timing `0x01`, histogram `0x02`, firmware timing `0x04`, timeline `0x08`, boot counters `0x10` |
| 1            | duration mask: 10/30/60초 bits `0x07`                                                                        |
| 2–3          | histogram bin count 8, timeline capacity 8                                                                   |
| 4–5          | recommended snapshot interval 1000 ms, BE16                                                                  |
| 6–7          | endian 1(big), time unit 1(µs)                                                                               |
| 8            | firmware version length, 최대 9                                                                              |
| 9–17         | ASCII firmware version과 zero padding                                                                        |

### Snapshot chunks

Chunk 0 요청은 새 coherent frozen snapshot과 nonzero sequence를 만든다. Host는 그
sequence로 후속 chunk를 정확히 하나씩 읽는다. Session/state/sequence/index/count가
하나라도 달라지거나 다른 host가 frozen snapshot을 교체해 `STALE_SNAPSHOT`이 오면
전체 snapshot을 폐기하고 다음 주기에 chunk 0부터 다시 시작한다.

| Chunk | 18 B payload                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | mode U8, speed U8, duration U8, event count U8, elapsed ms U32, expected interval µs U32, report samples U32, bin/timeline count U8×2 |
| 1     | latency min/average/max/window max U32×4, queue peak U16                                                                              |
| 2–3   | histogram U32×4씩                                                                                                                     |
| 4     | loop samples/max/window max/stall count U32×4, stall threshold U16                                                                    |
| 5     | boot drops/resets/configurations/suspends U32×4                                                                                       |
| 6     | boot speed changes, session drops/resets/configurations U32×4                                                                         |
| 7     | session suspends/speed changes/timeline overwrites U32×3, zero padding                                                                |
| 8–11  | event 두 개씩: type U8 + relative ms U32 + value U32                                                                                  |

기본 chunk는 8개이며 event 두 개마다 한 개를 더해 최대 12개다. Firmware는 짧은
critical-section copy 뒤 wire snapshot을 freeze하므로 ISR/main-loop update 중 torn
field를 노출하지 않는다.

## Host persistence and comparison

Local storage key는 `era.usbDiagnostics.history.v1`, envelope schema version은 1이다.
각 run은 VPID, product name, firmware version, diagnostics protocol, mode/speed,
duration, start/end timestamp, complete/stopped/aborted outcome, 최대 65개 snapshot을
가진다. 최대 24개 run만 보존하며 corrupt/unknown-schema record는 무시한다.

Comparison은 aborted run을 제외하고 VPID + firmware version + protocol version이
모두 같은 결과만 묶는다. Firmware/version이 다른 결과를 같은 조건으로 합치지 않는다.
Device path나 raw HID 식별자는 저장하지 않는다.

## Failure and lifecycle behavior

- Unhandled `0xFF` 또는 unsupported-version status는 graceful unsupported UI가 된다.
- Ordinary device는 metadata gate에서 끝나므로 selector probe 자체가 없다.
- 모든 request는 기존 path별 WebHID queue에서 직렬화하고 generation을 보존한다.
- Timeout/malformed snapshot은 최대 세 번 연속 실패까지 재시도한다. Disconnect 또는
  세 번 실패는 session을 aborted로 끝내며 captured partial snapshot이 있으면 저장한다.
- Page/device/connection generation이 바뀌면 polling owner를 취소하고, 아직 같은
  generation이면 STOP을 queue해 high-resolution probe를 끈다.
- Reconnect 후 firmware에 출처를 알 수 없는 running session이 남아 있으면 자동으로
  history에 붙이지 않는다. 사용자가 그 session을 stop한 뒤 새 test를 시작한다.
- STOP은 final coherent snapshot을 한 번 읽는다. CLEAR는 running 중 사용하지 않고
  device RAM의 session result만 지우며 local history와 boot counter는 지우지 않는다.

## Consequences

Diagnostics OFF에는 SOF timestamp나 scan-level probe가 없고, hard event의 rare counter
increment와 session-active branch만 남는다. ON에서는 main loop 한 번, keyboard report
request/completion 경계의 timer read와 약 1 Hz multi-packet aggregate read가 추가된다.
Raw 8 kHz sample stream, heap, firmware history buffer, EEPROM write가 없다.

App에는 독립 chart dependency를 추가하지 않았다. SVG/CSS view가 VIA theme variable을
사용하고 responsive grid와 horizontal table overflow로 기존 dark/light theme와 좁은
viewport를 따른다.

## Verification

- Firmware host test: protocol tag/version/reserved bytes, duration, busy/stop/clear,
  delivery queue wait, histogram, loop stall, hard event, frozen multi-chunk consistency,
  stale sequence, saturation, timer wrap, auto-complete
- Firmware May65 MinGW build와 legacy monitor/downgrade/reset/EEPROM symbol absence
- App fake transport: exact request, capability, sequential chunk read, stale/malformed,
  unsupported/timeout/disconnect, SET control
- App history: schema/corruption/bounds/version grouping/aborted exclusion/report text
- App result render: factual summary, trend, histogram, timeline, comparison, score 문구 부재
- Existing definition, locale, state-sync/transport test와 production build

실기기에서는 FS 1K 및 HS 2/4/8K 각각에 대해 diagnostics off/on keyboard interval,
queue drop, VIA response latency를 여러 host controller/hub/cable에서 비교해야 한다.
자동 build와 host fixture는 이 물리 검증을 대신하지 않는다.
