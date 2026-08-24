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

> 배치와 뷰 구성은 아래 "Diagnostics belongs under the polling-mode control"과
> "Information architecture" 절이 대체한다. 아래 목록은 어떤 정보를 제공하는지의
> 계약으로 남으며, 어디에 보이는지는 그 두 절을 따른다.

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

## Normalization basis and negotiated speed

Firmware는 session 시작 시점의 선택 mode에서 `expected interval`을 계산하고 모든
histogram bucket과 window multiplier를 그 값으로 정규화한다. 이 값은 실제 enumerate된
link speed가 아니다. FS 1K는 항상 Full Speed로, HS 2/4/8K는 항상 High Speed로
enumerate되므로, 선택 mode와 협상된 speed가 다르면(예: HS 8K 선택 상태로 FS만 지원하는
hub/port에 연결) 정규화 기준이 실제 polling 간격의 8배까지 어긋난다. 이 경우 raw
microsecond 값과 counter는 여전히 유효하지만 multiplier·quantile bound·trend는 선택
mode를 설명하지 않는다.

Firmware wire contract는 바꾸지 않는다. Snapshot이 이미 `polling mode`와 `negotiated
speed`를 함께 보내므로 app이 두 값의 정합성을 판정한다. 불일치하면 result view 상단에
전용 caveat panel을 띄우고, connection panel과 `Copy Diagnostic Report` 본문에 경고
문장을 넣으며, mode comparison table의 해당 row를 `speed mismatch`로 표시해 다른 row와
정규화 열을 비교하지 못하게 한다. 숫자를 숨기거나 자동으로 mode를 바꾸지는 않는다.

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
  generation이면 STOP을 queue해 high-resolution probe를 끈다. Polling loop는 이때
  수집한 partial snapshot을 aborted로 저장한 뒤 owner를 비우므로, page가 mount된 채
  connection generation만 바뀌어도 Start가 잠기지 않는다.
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

## Absolute microseconds are the comparison axis

1차 실기(BRICK60)에서 FS 1K / HS 2K / HS 4K의 평균 지연이 231 / 224 / 232 µs로 사실상
같았는데 정규화값은 0.23× / 0.45× / 0.93×로 갈려, 비교표가 FS를 최고·HS 4K를 최악으로
보여줬다. 리포트 방출이 firmware 디바운스의 1 ms tick 경계에 묶여 있어 지연의 절대 폭이
폴링 간격과 무관하기 때문이다. 따라서 mode comparison table은 **absolute µs(Avg/Max)를
기본 축**으로 제시하고, normalized column은 "그 mode가 자기 interval 예산 안에 있었는가"라는
별개 질문임을 명시한다. Normalized column을 없애지는 않는다 — budget 질문에는 여전히 맞다.

## Stored-result fallback must name its source

Session이 중단되면 `currentRun`과 live snapshot이 초기화되고 `comparableRuns[0]`으로
말없이 fallback해, "Unmatched firmware session" 배너와 이전 run의 "State: Complete"가
동시에 표시됐다. Copy Diagnostic Report도 그 이전 run을 복사했다. 표시 중인 결과가 현재
연결의 것이 아니면 mode·duration·outcome·timestamp를 명시한 caveat panel을 띄운다.

## Deferred (post-hardware)

실기 baseline 확보 후 착수한다. 판단 기준은 배포 위험이 아니라 구조적 정당성이다.
펌웨어 측 항목과 근거 전문은 `eerraa-qmk-h7s-fw-via2/docs/DECISIONS.md`의
"보류 항목 아키텍처 판단"에 있다.

- ~~**Trend 창 정합성**~~ (V260824R1에서 수정함) (`buildUsbDiagnosticsTrend`): p99는 *채택된* snapshot 두 개 사이,
  window maximum은 *capture* 두 개 사이로 창 경계가 다르다. Snapshot 읽기가 중간에
  실패하면 그 주기의 chunk 0이 이미 firmware 창을 리셋했으므로 다음 점에서 두 계열의
  범위가 어긋난다. Firmware가 capture마다 증가하는 `sequence`를 이미 보내므로
  `sequence - previousSequence !== 1`을 host가 감지할 수 있다. Firmware 변경 없이
  host에서 불연속 구간의 window maximum을 제외하거나 점을 분리한다.
- ~~**localStorage 저장 실패 노출**~~ (V260824R1에서 수정함): `saveUsbDiagnosticsRun()`의 boolean 반환을
  `finishActive()`가 무시해 조용한 데이터 유실 경로가 된다. UI state로 전파한다.
  Quota가 실제 문제가 되면 IndexedDB 재설계 대신 오래된 run의 보관 snapshot 수를 줄인다.
- **Firmware D-1은 V260824R1에서 수정됨 → 재측정 필수**: IN endpoint busy state를 endpoint별로 분리하면
  keyboard와 EXK가 동시에 in-flight가 되어 delivery latency와 queue depth의 기준선이
  내려간다. 수정 전후 결과를 같은 비교 그룹에 넣지 않는다.

## Verification

- Firmware host test: protocol tag/version/reserved bytes, duration, busy/stop/clear,
  delivery queue wait, histogram, loop stall, hard event, frozen multi-chunk consistency,
  stale sequence, saturation, timer wrap, auto-complete
- Firmware May65 MinGW build와 legacy monitor/downgrade/reset/EEPROM symbol absence
- App fake transport: exact request, capability, sequential chunk read, stale/malformed,
  unsupported/timeout/disconnect, SET control
- App history: schema/corruption/bounds/version grouping/aborted exclusion/report text
- App result render: factual summary, trend, histogram, timeline, comparison, score 문구 부재
- App normalization basis: mode↔negotiated speed 정합성 판정, 불일치 caveat/report
  warning/comparison row marking
- Existing definition, locale, state-sync/transport test와 production build

실기기에서는 FS 1K 및 HS 2/4/8K 각각에 대해 diagnostics off/on keyboard interval,
queue drop, VIA response latency를 여러 host controller/hub/cable에서 비교해야 한다.
자동 build와 host fixture는 이 물리 검증을 대신하지 않는다.

## Phase-independent metrics are the comparison axis (2차 실기 정정)

2차 실기에서 같은 firmware·같은 mode인데 재열거만으로 min/avg가 크게 이동했다
(FS 166/231 → 512/558 µs, HS 4K 8/232 → 140/184 µs). Report가 firmware debounce의
1 ms tick 경계에서 방출되고 그 tick과 host USB frame의 위상차가 boot마다 무작위로
정해지기 때문이며, `min`이 곧 그 위상이다. 같은 boot 안의 두 run은 `min`이 동일하고
다른 boot이면 달라진다.

따라서 "absolute µs를 기본 축으로" 삼은 직전 결정은 불충분하다. Comparison table의
기본 축은 **phase-independent metric**이다.

- `Spread` = (Max − Min) / interval — 몇 개의 추가 polling interval을 더 기다렸는가
- `Queue` = queue depth peak
- `Drops`, `Loop max`

`Avg`/`Max`는 유지하되 "연결마다 재추첨되는 고정 offset이 포함되어 run 간 비교 불가"임을
표에 명시한다. Normalized column(p99 bound, > 2×)은 "그 mode가 자기 interval 예산 안에
있었는가"라는 별개 질문에만 답한다.

## Finished sessions are recoverable from the keyboard

실기에서 절전으로 중단된 session이 page 기록을 전혀 남기지 못했다. Firmware는 그 결과를
CLEAR나 다음 START 전까지 RAM에 유지하는데 app이 읽을 방법을 제공하지 않았다.
`sessionState`가 `complete(2)` / `stopped(3)`이고 page가 그 session을 따라가지 못했으면
`Show It`(구 `Read Device Result`)로 읽어 표시한다.

- Page가 시작 시각을 모르므로 **local history에 저장하지 않는다.** 표시와 Copy만 한다.
  History entry는 알려진 start time과 identity를 유지해야 한다는 기존 원칙을 지킨다.
- 표시할 때는 "read from the keyboard, not from a test this page ran"으로 출처를 명시한다.
- Copy Diagnostic Report는 화면에 보이는 run을 따라간다. 다른 run을 복사하면 직전에 고친
  stale-result 결함과 같은 문제가 된다.

## Diagnostics belongs under the polling-mode control, not in its own tab

`/diagnostics`를 최상위 아이콘 바 페이지로 둔 최초 결정은 발견성에서 실패했다. 사용자는
`CONFIGURE → SYSTEM → USB POLLING`에서 mode를 바꾼 뒤 그 효과를 보려 했는데 기능이 전혀
다른 곳에 있어 찾지 못했다. 최상위 탭은 또한 31개 definition 중 다섯 H7S에서만 의미가
있는데도 모든 keyboard에 항상 보였고, 이는 "ordinary VIA keyboard의 시각 언어와 workflow를
보존한다"는 fork 계약과 어긋난다.

**결정: inline.** 진단 블록은 `USB POLLING` submenu의 `Apply Selected Mode` 아래에 항상
펼쳐진 상태로 렌더링한다. Modal은 기능을 다시 한 단계 숨기고, session이 열려 있어야 하는
10/60초 동안 실수로 닫으면 firmware session만 남는 위험을 키우므로 채택하지 않았다.
Accordion도 같은 이유로 발견성 이득이 줄어 채택하지 않았다.

Definition JSON은 바꾸지 않는다. `menu-generator`가 그 submenu의 item 중
`id_qmk_usb_bootmode` command가 있는지만 보고 `UsbDiagnosticsSection`을 렌더링하며,
section 자체가 다시 `shouldProbeUsbDiagnostics()`로 ERA 소스 + `usbDiagnostics: true`
opt-in을 확인한다. 이중 gate이므로 official snapshot이나 Design upload로 열린 같은
keyboard에도 selector `0x07`은 나가지 않는다. 이 배치는 `custom-control.tsx`의
`ExactMillisecondControl`과 같은 계열의 escape hatch지만, 렌더링 대상이 값 control이
아니라 전폭 block이므로 `ControlRow` 안이 아니라 submenu 끝에 붙인다.

부수 효과로, polling mode를 바꾸는 화면을 떠나지 않고 측정할 수 있게 되어 mode 변경 →
측정 → 비교 순환에서 page 이동으로 session이 중단되던 경로가 하나 사라진다. 반대로
submenu/category를 옮기면 section이 unmount되어 기존 `/diagnostics` 이탈과 동일하게
session이 `aborted`로 저장되므로, 실행 중에는 그 사실을 명시하는 문구를 띄운다.

`/diagnostics` route는 제거하되 `/`로 redirect만 남긴다. 열려 있던 tab이나 bookmark가
빈 화면이 되지 않게 하는 용도이며, global icon bar에서는 사라진다.

### 측정 조건이 달라진 점 (실기 확인 필요)

기존에는 `/diagnostics`에 있는 동안 `configureVisible`이 false여서 State Sync의 500 ms
recovery poll이 멈춰 있었다. Inline 배치에서는 Configure가 보이는 상태로 측정하므로 그
poll이 diagnostics snapshot 읽기와 같은 직렬 WebHID queue에서 함께 돈다. Control-plane
request가 초당 약 2건 늘어나며, main-loop에서 처리되므로 `loop max`/stall count의
baseline이 올라갈 수 있다.

Diagnostics session 동안 State Sync poll을 멈추지는 않는다. `PROJECT_DIRECTION.md`가
selector `0x07`을 "polling mode나 recovery에 결합하지 않는다"로 못박았고, 측정 창을 위해
recovery 동작을 바꾸는 것은 UI 재배치의 범위를 넘는다. 대신 재측정 시 이 변화를 확인해야
하며, 이전 배치에서 저장된 run과 loop timing을 직접 비교하지 않는다.

## Information architecture: default summary, advanced on demand

패널 9개 + 경고 배너를 한 번에 보여주던 결과 화면은 일반 사용자가 읽을 수 없었다. 정보를
"필요한 것만 남기고 나머지는 report 텍스트로" 옮기는 안은 채택하지 않았다. §"Phase-independent
metrics" 절이 요구하는 mode 비교표는 복사-붙여넣기 텍스트로 옮기면 기능 자체가 죽고,
`Spread`/`Queue` 열과 그 설명이 사라지면 6-1~6-3의 오독이 그대로 돌아온다.

**결정: 기본 요약 뷰 + `Advanced metrics and mode comparison` 토글.** VIA Settings의
`Show Diagnostic Information` 토글과 같은 계열의 기존 패턴이다.

요약 뷰가 답하는 질문은 하나다 — "이 모드로 이번 창에서 문제가 있었는가". 답에 필요한
다섯 가지만 각각 한 문장으로 서술한다.

- report queue drops
- USB hard event (reset / configuration / suspend / speed change)
- 1 ms 초과 firmware main-loop gap
- queue depth peak
- 선택 mode ↔ 협상 speed 정합

Caveat panel 두 개(정합성 불일치, 현재 결과가 아닌 결과의 출처)는 **요약 뷰에도 항상**
보인다. 판단을 뒤집는 정보이므로 토글 뒤에 두지 않는다.

절대 µs(min/avg/max), 정규화 분위수, 히스토그램, 추세 그래프, 타임라인, 부팅 누계는
advanced로 옮겼다. 이들은 caption 없이 읽으면 반드시 오독되는 값이고(6-1, 6-2, 6-5, 6-6),
caption은 각 패널에 그대로 남아 있다. 요약 뷰는 숫자를 caption 없이 보여주는 대신 아예
보여주지 않는 쪽을 택했다.

새로 추가한 두 문장도 관측 범위 제약을 지킨다.

- "Each line above covers only the category it names, over the window this test ran.
  Categories this test does not measure are not covered by it." — `No failures observed`
  형태의 포괄 진술 금지(6-4)를 UI 문구로 명시한 것.
- report sample이 0이면 "No HID keyboard reports were sent during this test"를 덧붙인다.
  키를 누르지 않은 창에서는 delivery 관련 문장이 공허하게 참이 되어 깨끗한 결과처럼
  읽히기 때문이다.

Control은 상시 6개를 전부 disabled로 두던 방식에서, 실제로 동작할 수 있는 순간에만
나타나도록 바꿨다. `Stop`은 session이 running이거나 firmware에 미매칭 session이 있을 때,
`Read Device Result`/`Clear Device Result`는 keyboard가 끝난 session을 들고 있을 때
(`sessionState` 2/3), `Copy Diagnostic Report`는 표시할 run이 있을 때만 렌더링한다.
`sessionState`가 idle(0)일 때의 CLEAR는 지울 대상이 없으므로 사라진다.

## Name the situation, not the operation

실사용자(저장소 소유자 본인) 피드백: "Read Device Result 등 무슨 기능이고 어떻게
해석해야 되는지 모르겠다."

원인은 길이가 아니라 추상성이었다. `Read Device Result`는 이미 짧지만 *동작*(장치에서
결과를 읽는다)을 이름으로 삼아 *상황*(절전·새로고침·재연결로 테스트가 끊겼는데 결과는
키보드에 남아 있다)을 말하지 않았다. 더 줄이면 더 모호해진다. 따라서 정보를 더 압축하는
방향이 아니라 다음 세 가지를 적용했다.

1. **상황을 문장으로 먼저 말하고, 동작 버튼을 그 문장 안에 넣는다.** 복구·정리 동작은
   컨트롤 행에서 빠지고, 그 상황을 설명하는 note 안으로 들어갔다. 버튼이 설명을 이름에
   담을 필요가 없어지므로 `Show It` / `Discard It` / `Stop It`로 충분해진다.

   | 이전 | 이후 |
   | --- | --- |
   | `Read Device Result` (항상 표시, 대개 비활성) | "A finished test is still on the keyboard" 카드 안의 `Show It` |
   | `Clear Device Result` | 같은 카드 안의 `Discard It` |
   | `Stop Device Session` | "A test was already running when this page connected" 카드 안의 `Stop It` |

   기본 컨트롤 행은 `Test duration` + `Start Test`만 남는다.

2. **각 수치에 평문 주제를 붙인다.** 요약 뷰는 문장 목록에서 2열 정의 목록으로 바꿨다.
   왼쪽은 무엇에 대한 이야기인지("Lost key reports", "USB link interruptions",
   "Firmware pauses", "Busiest queue moment", "Link speed"), 오른쪽은 관측 사실만.
   글자 수는 오히려 줄었고 §6-4의 서술 범위 제약은 그대로다. 하드 이벤트가 관측되면
   개수만 세지 않고 어떤 종류였는지 함께 보여준다.

3. **섹션 도입부가 측정 항목이 아니라 답하는 질문을 말한다.**

## Localisation

진단은 이 앱에서 가장 설명이 많은 화면이므로, 영어만으로는 비영어권 사용자가 판단할 수
없다. 두 컴포넌트를 `react-i18next`로 옮기고 지원 6개 로케일(de/en/es/ja/ko/zh) 전부에
140개 키를 추가했다. 키는 앱의 기존 관례대로 영어 원문이므로, 번역이 없으면 읽을 수 있는
영어로 degrade한다.

- **번역은 문구 확정 이후에 했다.** 순서를 반대로 하면 모호한 문장을 6개 언어로 번역한 뒤
  다시 6번 고쳐야 한다.
- **USB·펌웨어 식별자는 번역하지 않는다.** `FS 1K` / `HS 8K` / `Full Speed` /
  `High Speed` / `p50·p95·p99` / `EEPROM` / `RAM`은 비교표, 복사된 보고서, 펌웨어 문서가
  부르는 이름과 같아야 한다.
- **`Copy Diagnostic Report` 본문은 영어로 남긴다.** 이 텍스트는 유지보수자에게 붙여넣는
  버그 리포트다. 사용자의 언어로 번역되면 받는 쪽이 읽지 못한다. 부수적으로
  `usb-diagnostics-history.ts`(측정 로직)를 건드리지 않아도 된다.
- **§6-4는 번역에서도 강제한다.** 유창한 번역이 "관측되지 않았습니다"를 "안정적입니다"나
  "문제 없습니다"로 승격시키면 계약이 깨진다. `tests/locales.test.ts`가 관측 서술 16개
  키에 대해 6개 언어별 판정 표현 정규식을 검사하고, 모든 `{{placeholder}}`가 번역에서
  살아남는지도 함께 검사한다.

`t()`는 세션 콜백에서 ref로 참조한다. 의존성 배열에 넣으면 언어 변경 시 `finishActive`의
identity가 바뀌고, 그것에 의존하는 정리 effect가 실행 중인 측정을 중단시킨다.

## Explanation is not content

실기 화면에서 결과가 네 화면을 넘겼고, 그 세로 공간의 대부분은 측정값이 아니라 상시
렌더링된 주석 문단이었다. 사용자 피드백: "한 눈에 들어오는 글자가 너무 많고 스크롤이
너무 많아져서 한 눈에 들어오지 않는다."

문구를 더 줄이는 것은 답이 아니다. §6의 caveat는 지울 수 없고, 줄이면 모호해진다.
대신 **텍스트를 지우지 않고 화면에서만 물러나게** 했다.

1. **Disclosure.** `src/components/inputs/explain.tsx`. 제목 옆의 작은 ⓘ 버튼과, 그
   아래로 펼쳐지는 본문. 떠 있는 popover가 아니라 흐름 안의 요소이므로 카드
   `overflow`에 잘리지 않고, 터치에서 동작하며, 키보드 접근성이 기본으로 따라온다.
   접힌 상태에서도 **본문은 DOM에 남고 `hidden`으로만 감춘다.** 브라우저 찾기와
   보조기술이 여전히 도달할 수 있고, §6 문구를 검사하는 기존 테스트가 그대로 유효하다.

2. **Tabs.** 고급 지표를 `Measurements / Timing / Events / Mode comparison` 네 그룹으로
   나눴다. 비선택 그룹은 unmount하지 않고 `hidden` 처리한다 — 차트가 레이아웃을 유지하고
   그룹 전환 비용이 없다. 네 화면이 한 화면이 된다.

3. **토글 위치.** `Advanced metrics and mode comparison` 스위치가 자기가 여는 내용보다
   *아래*에 있었다. 켜면 위아래 양쪽에 내용이 나타나 어디를 봐야 할지 알 수 없었다.
   스위치를 요약 카드 바로 아래, 고급 영역 바로 위로 옮겼다.

### 접히지 않고 화면에 남는 것

판단을 뒤집는 사실은 disclosure 뒤에 두지 않는다.

- 속도 불일치 caveat 전문 (§6-7) — 조건부로만 나타나므로 나타났을 때는 전부 보인다.
- 표시 중인 run의 정체와 "진단 보고서 복사도 이 결과를 복사한다" (§6-8).
- 부팅 누계의 "이 테스트가 끝난 시점에 캡처된 값이며 실시간 값이 아닙니다" (§6-6).
  실기에서 두 번 오판이 나온 지점이라 한 줄로 줄이되 화면에는 남긴다.
- 비교표의 "실행 비교는 스프레드·유실·큐로 하세요 — 평균과 최대에는 다시 꽂을 때마다
  새로 뽑히는 오프셋이 들어 있습니다" (§6-1, §6-3). 표가 바로 옆에서 비교를 유도하므로
  한 줄 요지는 상시 노출하고, 근거 전문만 접는다.

`tests/diagnostics-pane.test.tsx`가 이 구분을 검사한다. 접힌 본문을 제거한 마크업에
대해 "화면에 남아야 하는 것"은 있어야 하고, 관측 범위 단서 같은 "접혀도 되는 것"은
없어야 한다.

## Plain words, and a stated type scale

사용자 지적 두 가지.

**"리포트/열거 같은 표현이 이해되지 않는다."** `report`는 HID 용어, `enumerate`는 USB
스펙 용어, `queue depth`는 펌웨어 용어다. 폴링 속도를 바꾸러 온 사람에게는 아무 의미가
없다. 측정 대상은 그대로 두고 부르는 말만 바꿨다.

| 이전 | 이후 |
| --- | --- |
| Lost key reports / 유실된 키 리포트 | Lost key presses / 키 입력 유실 |
| USB link interruptions / USB 링크 중단 | USB link changes / USB 연결 변화 |
| Busiest queue moment / 큐가 가장 붐빈 순간 | Most waiting to send / 전송 대기 최대 |
| Link speed, "Enumerated at …" | Connection speed, "High Speed — matches HS 8K" |
| Negotiated USB speed / 협상된 USB 속도 | Connected USB speed / 연결된 USB 속도 |
| Resets / Configurations / Suspends | Disconnects / Reconnects / Sleeps |
| Since firmware boot / 펌웨어 부팅 이후 | Since the keyboard powered on / 키보드를 켠 이후 |

`FS 1K` `HS 8K` `Full Speed` `High Speed` `p50/p95/p99` `EEPROM` `RAM`은 그대로 둔다.
식별자이고, 복사된 보고서·비교표·펌웨어 문서가 부르는 이름과 같아야 한다. `enumerate`는
고급 비교표의 접힌 해설에만 남는다 — 거기서는 정확한 단어이고, 펼친 사람은 정밀함을 원한다.

**"긴 문장을 선호하지 않는다."** 2열 배치가 이미 주어를 제공하므로 값은 문장이 아니라
조각이면 된다. `"이 테스트에서는 관측되지 않았습니다."` → `"관측되지 않음"`. 관측 범위
제약(§6-4)은 값이 아니라 **행 이름과 그 위 제목**이 진다: `이 30초 테스트가 관측한 것`
아래의 `키 입력 유실 / 관측되지 않음`은 이 테스트가 본 것에 한정된 서술이다. 항상 보이는
문단은 전부 한두 줄로 줄이고 근거는 disclosure로 넘겼다.

### 타입 스케일

화면에서 두 가지 결함이 보였다. 요약 부제(20px)가 그 위 패널 제목(18px)보다 커서 위계가
뒤집혀 있었고, 보조 문구에는 크기가 지정되어 있지 않아 VIA 메뉴 행 크기를 상속받았다 —
카드에서 가장 덜 중요한 `State: Complete · 30.0 / 30s`가 가장 큰 글자 중 하나로 렌더링됐다.
밀도 높은 데이터 패널은 상속이 아니라 명시된 스케일이 필요하다.

```
18  섹션 제목
16  요약 부제
15  섹션 본문 · 패널 제목 · 요약 답변 행
14  지표 라벨/값 · 탭 · 안내 문구
13  보조 문구 · disclosure 본문 · 비교표 · 히스토그램
```

버튼과 select도 VIA의 20px 메뉴 행 기준(40px 높이)에서 이 블록 기준(36px)으로 낮췄다.

## UI verification

자동 검사는 `tests/diagnostics-pane.test.tsx`(요약/전체 뷰 문구와 §6 안전장치)와
`tests/custom-menu-pane.test.tsx`(배치와 opt-in gate)가 담당하며, 후자는
`bun run test:transport`에 편입했다.

실기에서는 다음을 확인한다. 코드만으로 판정할 수 없다.

1. `CONFIGURE → SYSTEM → USB POLLING`에서 `Apply Selected Mode` 아래에 진단 블록이
   바로 보인다. 상단 아이콘 바에 Diagnostics 아이콘이 없다.
2. H7S가 아닌 keyboard와 official/upload로 열린 H7S에서는 블록이 없고 selector `0x07`
   packet이 나가지 않는다.
3. 30초 test 중 polling mode dropdown을 건드리지 않고 그대로 두면 test가 완주한다.
   측정 중 다른 submenu로 이동하면 `aborted`로 저장되고 `Read Device Result`로 복구된다.
4. 같은 mode·같은 boot에서 이전 배치(`/diagnostics`)와 새 배치의 `loop max`,
   `stall count`, `queue peak`를 비교해 State Sync poll 동시 실행의 영향 크기를 기록한다.
5. Advanced 토글을 켰을 때 비교표의 `Spread`/`Queue` 열과 `speed mismatch` 표시가
   그대로 보인다.
6. 언어를 ko/ja/zh/de/es로 바꿔 요약 뷰와 상황 카드가 잘리거나 겹치지 않는지 본다.
   독일어가 가장 길어 2열 정의 목록의 왼쪽 열 폭에서 먼저 문제가 드러난다.
7. 결과가 나온 상태에서 스크롤 없이 요약 카드 전체가 보이는지, ⓘ를 열었을 때 카드가
   밀리기만 하고 잘리지 않는지 본다.
8. 고급 탭 네 개를 각각 열어 한 화면에 들어오는지, 전환 시 차트가 다시 그려지며
   깜빡이지 않는지 본다.
9. 위 타입 스케일이 실제 화면에서 위계로 읽히는지 본다. 특히 `State: …` 줄이 답변 행보다
   작아야 하고, 요약 부제가 패널 제목보다 크면 안 된다.
