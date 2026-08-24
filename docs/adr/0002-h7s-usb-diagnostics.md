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

## Named for the setting it sits under

`USB Delivery Diagnostics`는 계측 대상(HID report delivery)을 이름으로 삼았다. 블록이
`USB POLLING` submenu 안에 있고, 답하는 질문도 "이 폴링 모드가 어떤가"이므로 화면 맥락과
어긋난다. **`USB Polling Diagnostics` / `USB 폴링 진단`**으로 바꾼다. 계측 대상은 그대로다.

## Help for the rest of the ERA menus

진단 블록만 설명을 갖고 나머지 ERA 기능은 이름만 있는 상태였다. `TAPDANCE`, `SOCD`,
`DEBOUNCE` 같은 메뉴는 이름이 곧 설명이 되지 못하고, 값 하나를 어느 방향으로 움직여야
하는지도 화면에 없다. 진단에 쓴 disclosure를 그대로 재사용해 각 submenu 위에 한 줄 요약과
접힌 상세를 붙인다.

`src/utils/era-feature-help.ts`가 표를 갖고, `feature-help.tsx`가 `menu-generator`의
submenu 항목 위에 렌더링한다.

**메뉴 label이 아니라 command id로 키를 잡는다.** label은 자유 문구라 일반 VIA 정의도
`TAPPING`이라는 메뉴를 가질 수 있지만, `id_qmk_tapping_*`은 ERA 펌웨어에만 있다. 따라서
구현이 다른 남의 키보드가 ERA 기능 설명을 가져가는 일이 없다. 진단 블록이 쓰는 게이트와
같은 원리다.

내용 출처는 펌웨어 저장소의 사용자 안내
`qmk_firmware_eerraa/keyboards/era/common/docs/user/readme.txt`(및 split 판)다. 그대로
옮기지 않고 다시 썼다. 안내문은 "VIA CONFIGURE → FEATURE → DEBOUNCE에서 조정합니다"처럼
경로를 알려주는데, 이 텍스트를 읽는 사람은 이미 그 화면에 있다. 남는 것은 **그 설정이 무엇을
하는지와 값을 어느 방향으로 움직여야 하는지**뿐이므로 그 두 가지만 남기고 나머지는 버렸다.
안내문에 없던 판단 기준(예: DEBOUNCE에서 1 ms를 더할 때마다 인식 시간도 1 ms 늘어난다는
사실, TAPPING 토글은 하나씩 시험하라는 조언)은 정의 JSON의 옵션과 펌웨어 동작에서 확인해
새로 썼다.

덮는 메뉴: TAPDANCE, SOCD, Anti-Ghosting, DEBOUNCE, TAPPING, MOUSE, NKRO, USB POLLING,
BOOT, EEPROM CLEAN, SPLIT LINK, SPLIT SYNC, VERSION, INDICATOR, LIGHTING.

### 판정 표현 금지의 범위

§6-4는 **진단의 관측 서술**에 대한 제약이지 설정 안내문에 대한 제약이 아니다. "연결이 실제로
불안정할 때만 속도를 낮추세요"는 케이블에 대한 조언이고 여기서 "불안정"은 옳은 단어다.
번역 검사기가 처음에 이런 문장을 여섯 건 잡아냈으므로, 검사 범위를
`tests/locales.test.ts`의 `DIAGNOSTIC_OBSERVATION_KEYS`와 동일하게 좁혔다. 검사기는 그
목록을 테스트 파일에서 직접 읽으므로 두 곳이 어긋날 수 없다.

## Sentences a person would say

"AI가 쓴 것 같다"는 지적에 따라 항상 보이는 문구를 다시 썼다. 고친 것은 길이가 아니라
성격이다.

- 자기 방어용 절 제거. `각 줄은 그 줄이 가리키는 범주만을, 이 테스트가 도는 동안에 한해
  다룹니다. 이 테스트가 측정하지 않는 범주는 포함되지 않습니다.` →
  `이 다섯 줄이 이번 테스트가 보는 전부입니다. 그 밖에 잘못될 수 있는 것들은 이 테스트가
  재는 범위 밖입니다.` 관측 범위 제약은 그대로 유지된다.
- 사람이 궁금해하는 것을 먼저. `이 테스트가 끝난 시점에 캡처된 값이며 실시간 값이
  아닙니다.` → `테스트가 끝난 순간에 읽은 값입니다. 보고 있는 동안 올라가지 않습니다.`
- 결과가 뭔지 말하기. `이 결과를 로컬 기록에 저장하지 못했습니다.` 뒤에 "그러면 나중에
  비교표에도 나오지 않습니다"를 붙였다. 실패의 의미는 저장이 아니라 비교표 부재다.
- 오류 문구에서 "세션"·"스냅숏"·"펌웨어가 반환했습니다" 같은 구현 어휘를 걷어내고
  키보드를 주어로 세웠다. `펌웨어에서 이미 진단 세션이 진행 중입니다.` →
  `키보드가 이미 테스트를 돌리고 있습니다.`

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
10. FEATURE·TAPDANCE·SYSTEM·Lighting의 각 submenu 위에 한 줄 요약이 뜨는지, ⓘ를 열었을 때
    컨트롤이 밀리기만 하고 잘리지 않는지 본다. 일반 VIA 키보드에서는 그 줄이 없어야 한다.

## Anti-Ghosting 설명은 기능을 잘못 서술하고 있었다

기존 문구는 "누르고 있는 키를 다시 보내서 PC가 잊지 않게 합니다"였다. 이것은 **다른
기능의 설명**이다. 실제 동작은 `eerraa-qmk-h7s-fw-via2/src/ap/modules/qmk/port/kkuk.c`를
읽어 확인했다.

- `kkuk_process()`가 기본 키코드의 누름/뗌을 세어 `key_cnt`를 유지한다. SOCD(`kill_switch`)에
  지정된 키는 세지 않는다.
- `kkuk_idle()`은 `key_cnt >= 2`이고 마지막 키 변화로부터 `delay_time`이 지나면 모드에
  진입한다. **키 하나만 누르고 있으면 아무 일도 일어나지 않는다.**
- 모드 중에는 `repeat_time`마다 `clear_keys()` + `send_keyboard_report()`로 **묶음 전체를
  뗀 리포트**를 보내고, 곧바로 원래 리포트를 복원해 다시 보낸다.

즉 `asd`를 누르고 있으면 OS 자동 반복의 `asddddd`가 아니라 `asdasdasd`가 들어간다. 한국
사용자가 아는 이름은 **꾹보드**이고, 이 한 단어가 어떤 설명보다 빠르다. 한국어 문구는
꾹보드를 두 번(정체 규정과 마지막 문장) 넣었다.

영어 키에는 `KKUK`을 병기하지 않았다. 영어 문자열은 6개 언어 전체의 번역 키이므로, 한국어
통칭을 키에 넣으면 독일어·스페인어 독자에게 의미 없는 고유명사가 그대로 실린다. 대신
**`asd` → `asdasdasd` 예시를 요약 첫 줄에 올렸다.** 예시는 언어와 무관하게 읽히고, 추상적
서술보다 짧다.

메뉴 이름이 `Anti-Ghosting`인 것은 펌웨어 정의가 그렇기 때문이라 이 시점에는 바꾸지 않고,
상세 첫 문장이 그 오해를 먼저 정정하는 것으로 처리했다. **이 판단은 아래
"Anti-Ghosting → KKUK" 절에서 뒤집혔다** — 이름을 유지할 근거가 없다는 것이 확인되어 세
저장소의 라벨을 모두 `KKUK`으로 바꿨다.

RP2040 정의 25종에만 있는 `id_qmk_kkuk_mode`(옵션이 `Report Pulse` 하나뿐)에는 컨트롤 단위
설명을 붙였다. `qmk_firmware_eerraa/keyboards/era/common/features/era_kkuk.c`의
`era_kkuk_set_mode()`가 `ERA_KKUK_MODE_REPORT_PULSE` 외의 값을 무시하므로, "고를 것이 없다"는
사실 자체가 답이다.

## 컨트롤 단위 ⓘ — DEBOUNCE와 TAPPING의 정보구조

submenu 상단 ⓘ 하나로는 DEBOUNCE를 설명할 수 없다는 것이 문제 제기였다. 세 가지 안을
검토했다.

**(A) 상단 ⓘ 본문 확장 — 탈락.** 한 문단에 다섯 개 ms 항목과 세 모드를 모두 넣으면 독자는
자기가 보고 있는 행에 해당하는 문장을 그 안에서 찾아내야 한다. `Explain` 본문이 `<p>`
하나라 표·목록을 쓰려면 컴포넌트를 손봐야 하고, 표를 넣더라도 "지금 화면에 있는 행"을
독자가 매핑하는 부담은 그대로다. TAPPING에서는 더 나쁘다. 토글 세 개 각각이 증상→처방
2~3문장을 요구하므로 한 문단이 여덟 문장이 된다.

**(B) 모드별 조건부 상단 설명 — 탈락.** `selectedCustomMenuData`로 현재 모드를 읽어 해당
모드 설명만 상단에 보여주는 방식이다. "내가 보고 있는 ms 항목의 의미"는 해결하지만
**"세 모드의 차이"는 해결하지 못한다.** 아직 고르지 않은 모드의 설명이 화면에 없으면
비교가 불가능하고, 모드를 고르는 순간이 바로 비교가 필요한 순간이다.

**(C) 컨트롤 단위 ⓘ — 채택.** 답을 질문 옆에 둔다. `Debounce Mode` 드롭다운의 ⓘ가 세 모드를
한자리에서 비교하고, 그 아래 `showIf`로 살아남은 ms 행의 ⓘ가 그 행만 설명한다. TAPPING의
토글 세 개도 같은 방식으로 각자 ⓘ를 갖되, 각 본문이 나머지 둘을 명시적으로 지목해 차이를
말한다("Hold on Other Key Press는 같은 생각의 더 거친 버전입니다 — 그쪽은 다른 키가 눌리는
순간 판정하고, 이쪽은 그 키가 떼질 때까지 기다립니다").

### 어디에 붙이고 어디에 안 붙이는지

산발적으로 붙으면 "왜 이 항목만 설명이 있나"를 묻게 되므로 기준을 고정한다.

> **컨트롤 단위 ⓘ는 label이 "이 값을 어느 방향으로 움직여야 하는가"에 답하지 못할 때만
> 붙인다.**
>
> 붙이는 경우: (a) 선택지가 고유명이라 이름이 동작을 설명하지 않는다
> (`Balanced`/`Fast`/`Advanced`, `Permissive Hold`, `Report Pulse`). (b) label이 사양을
> 서술할 뿐 결과를 말하지 않는다 — `Press & Release - delay before and after (same value)`는
> 펌웨어가 그 숫자로 무엇을 하는지 말하지만, 그 값을 올리면 모든 입력이 그만큼 늦게
> 인식된다는 사실은 말하지 않는다.
>
> 붙이지 않는 경우: 단위가 곧 답인 컨트롤(`Cursor Top Speed` 16 px, `Repeat Time` 80 ms),
> 그리고 **상단 요약이 이미 그 컨트롤을 주어로 삼고 있는 컨트롤**. `Global Tapping Term
> (ms)`은 TAPPING 요약("탭홀드 키가 홀드로 판단하기까지 기다리는 시간")이 그 자체를
> 설명하고 있고, Anti-Ghosting의 `Enable`은 그 메뉴 요약이 곧 그 토글의 설명이다. 한 줄
> 아래에서 반복하면 소음이다.

그래서 TAPPING은 1행에 ⓘ가 없고 2~4행에 있다. 이는 결함이 아니라 기준이 선별적으로
작동한 결과이며, 화면에서도 그렇게 읽힌다 — 첫 행은 바로 위 요약이 설명한 것이고 나머지
셋은 아니다. MOUSE는 라벨과 단위가 답을 다 갖고 있어 하나도 붙지 않는다. **이 판단은 아래 "설명문을 다시 짧게" 절에서 뒤집혔다** — 실제 화면에서 단위는 얼마인지만 말하고 무엇의 얼마인지는 말하지 않는다.

### 구현

`Explain`은 버튼과 본문을 인접하게 렌더링하므로 `ControlRow`(label 왼쪽 / Detail 오른쪽,
`justify-content: space-between`)에 그대로 넣을 수 없다. 본문을 `Detail` 앞에 두면 wrap
시 컨트롤이 3번째 줄로 밀린다. `explain.tsx`에 `useExplainDisclosure()` 훅과
`ExplainBody`를 분리 노출해 호출자가 버튼과 본문을 따로 배치할 수 있게 했다.

**§4.3 접힘 계약은 훅 쪽이 더 강하게 지킨다.** 훅은 `open`을 밖으로 내보내지 않고 이미
해석된 `hidden`만 `bodyProps`로 넘긴다. 호출자가 `{open && <Body/>}`를 **쓸 수가 없다.**

도움말이 있는 행만 `flex-wrap: wrap` 변형(`HelpfulControlRow`)을 쓰고, label과 버튼을
`LabelGroup`으로 묶는다. 도움말이 없는 행은 기존 2열 `ControlRow` 그대로다.

키는 **정확한 command 이름**으로 잡는다(submenu 게이트와 같은 원리, 더 좁다).
`id_qmk_debounce_time_post`는 Fast의 `Press & Release - delay after change (post-only)`와
Advanced의 `Release - delay before and after release (pre+post window)` 두 행이 공유하고
**모드에 따라 뜻이 다르므로**, 그 두 항목만 label까지 함께 맞춘다. H7S의 서술형 label과
RP2040의 축약형 label(`Press & Release Cooldown` / `Release Delay`)을 모두 등록했다.
label이 어느 쪽과도 안 맞으면 아무것도 렌더링하지 않는다 — 디바운스 창의 반대쪽을 설명하는
문구가 뜨는 것보다 없는 편이 낫다.

`aria-label`은 `What this means: {{name}}`로 컨트롤 이름을 담는다. 한 화면에 ⓘ가 여러 개
생기므로 보조기술이 같은 이름의 버튼을 반복해 읽는 상황을 피한다.

### DEBOUNCE·TAPPING 문구의 근거

펌웨어 readme 2-6은 모드 이름과 권장값만 주고 2-7은 항목 이름만 나열한다. 실제 의미는
코드에서 확인했다.

| 모드 | 알고리즘 | 읽는 값 | 동작 |
| --- | --- | --- | --- |
| Balanced (0) | `sym_defer_pk` | `post_ms` | 신호가 그 시간 잠잠해진 뒤 보고. 누름·뗌 모두 그만큼 늦다 |
| Fast (1) | `sym_eager_pk` | `post_ms` | 변화 즉시 보고 후 그 시간 동안 그 키 무시 |
| Advanced (2) | `asym_eager_defer_pk` | 누름 `pre_ms` / 뗌 `post_ms` | 누름은 즉시+잠금, 뗌은 잠잠해진 뒤 보고 |

`debounce_profile_set_single_delay()`가 Balanced에서 `pre_ms`와 `post_ms`를 같은 값으로
쓰고, 세 알고리즘 모두 `debounce_runtime_release_delay()`(= `post_ms`)를 읽는다. Advanced만
`debounce_runtime_press_delay()`(= `pre_ms`)를 누름 쪽에 함께 쓴다. 따라서 "Balanced에서
1 ms를 더하면 인식이 1 ms 늦어진다 / Fast와 Advanced의 누름 쪽은 늦어지지 않는다"는 서술이
코드와 일치한다.

TAPPING 세 토글은 `port/tapping_term.c`가 QMK 표준 per-key 콜백
(`get_permissive_hold` / `get_hold_on_other_key_press` / `get_retro_tapping`)을 그대로
구현하고, `quantum/action_tapping.c`도 stock이다. 따라서 QMK 표준 의미가 그대로 적용된다.
문구는 정의가 아니라 **증상 → 처방**으로 썼다: "빠르게 칠 때 홀드가 걸리지 않는 증상에
씁니다", "Permissive Hold를 켜도 홀드가 글자로 나온다면 이걸 켜세요", "키에 손을 너무 오래
얹었을 때 글자가 사라지는 증상에 씁니다". 각 본문이 나머지 토글과의 차이를 명시하므로 셋을
따로 읽어도 선택할 수 있다.

## H7S 5종에 MOUSE 정의를 추가한다

펌웨어는 `V260823R1`부터 마우스 키 설정을 지원한다. `quantum/via.h`가
`id_qmk_mousekey = 17`을 할당하고(참조 QMK의 13번은 H7S에서 USB POLLING이 점유),
같은 파일이 value id 1~6을 참조 배치와 동일하게 정의하며,
`port/mousekey_config.c`가 get/set을 전부 구현한다. H7S 5종의 `port/via_port.c`가 모두
채널 17을 라우팅한다. 그런데 앱 정의에는 MOUSE submenu가 없어 **펌웨어가 가진 기능에
접근할 방법이 없었다.**

`era-definitions/custom/v3/era65/ERA65-VIA.json`의 MOUSE submenu를 그대로 복사하고
**채널만 13 → 17로 바꿔** 5종의 FEATURE 메뉴 `TAPPING` 뒤에 넣었다. RP2040 계열의
`SOCD / Anti-Ghosting / DEBOUNCE / TAPPING / MOUSE` 순서와 같은 자리다. value id·옵션 목록·
`Cursor Acceleration == 0`일 때 `Cursor Speed`, 아닐 때 `Cursor Start/Top Speed`를 보여주는
`showIf` 구조는 손대지 않았다. 옵션 값과 기본값은 펌웨어 readme 2-9와 일치한다.

**NKRO는 넣지 않는다.** H7S readme 2-10과 펌웨어 `DECISIONS.md`의 2026-08-23 항목에 따르면
이 키보드는 전환 없이 항상 20키 동시 입력이고 켜고 끄는 옵션 자체가 없다. 토글을 만들면
없는 선택지를 있는 것처럼 보이게 하는 거짓말이 된다.

`tests/era-definition.test.ts`가 5종 모두에 대해 FEATURE 순서, mousekey 컨트롤의 채널 17,
value id 1~6, `showIf` 쌍의 존재, `id_qmk_custom_nkro` 부재를 검사한다. era65가 채널 13에
남아 있는지도 함께 확인해 잘못된 계열에 17을 쓰는 회귀를 막는다.

### 펌웨어 공식 VIA JSON에도 넣었다

`eerraa-qmk-h7s-fw-via2/src/ap/modules/qmk/keyboards/era/*/json/*-VIA.JSON` 5개에도
`id_qmk_mousekey`가 0건이었다. 앱 정의만 고치면 커스텀 앱에서만 MOUSE가 보이고 공식
`usevia.app`에서는 보이지 않는다. `docs/PROJECT_DIRECTION.md`가 "Firmware must keep working
with the official VIA app plus the official V3 definition. **A path that only the custom app
can speak is an error.**"라고 못박고 있으므로 그 상태를 남길 수 없다.

누락이 의도가 아니었다는 증거는 펌웨어 저장소 안에 이미 있었다. `docs/features_mousekey.md`의
노출 표가 `| 각 보드 VIA JSON | FEATURE → MOUSE | 6개 컨트롤 노출. |`이라고 적고 있었고,
`docs/readme.txt` 2-9는 사용자에게 "VIA CONFIGURE → FEATURE → MOUSE에서 조정합니다"라고
안내하고 있었다. 두 문서 모두 없는 화면을 가리키고 있었다.

**사용자 승인을 받아 5개 공식 JSON에 같은 블록을 넣었다.** 삽입 스크립트가 파싱 결과를 앱
정의의 MOUSE와 deep-equal로 비교해 검증하므로 두 정의가 어긋날 수 없다. 공식 JSON은 안쪽
배열을 한 줄로 두는 손질된 포맷이라 재직렬화하면 파일 전체가 재포맷된다 — 그 스타일 그대로
렌더링해 텍스트로 삽입했고 파일당 94줄 순수 추가, 삭제 0줄이다.

## 번역 누락을 코드가 잡는다

ERA 메뉴 설명은 영어 원문이 곧 번역 키다. 문구를 다시 쓰면 키가 바뀌므로, 로케일을 함께
갱신하지 않으면 다섯 언어가 조용히 영어로 degrade한다. 키 파리티 검사는 이것을 잡지
못한다 — 여섯 파일이 똑같이 그 키를 갖고 있지 않을 뿐 파리티는 유지되기 때문이다.

`era-feature-help.ts`가 `eraHelpStrings()`로 번역 대상 전체를 노출하고,
`tests/locales.test.ts`가 그 목록의 모든 문자열이 6개 카탈로그에 키로 존재하는지 검사한다.
목록을 테스트가 소스에서 직접 읽으므로 두 곳이 어긋날 수 없다. 판정 표현 금지 검사가
`DIAGNOSTIC_OBSERVATION_KEYS`를 테스트 파일에서 읽는 것과 같은 방식이다.

## UI verification (2차 추가분)

11. `FEATURE → Anti-Ghosting`의 요약 줄에 `asdasdasd` 예시가 보이고, 한국어로 바꾸면
    "꾹보드"가 보인다.
12. `FEATURE → DEBOUNCE`에서 `Debounce Mode` 옆 ⓘ를 열면 세 모드 비교가 나오고, 모드를
    Balanced → Fast → Advanced로 바꿀 때 아래 ms 행이 바뀌며 각 행의 ⓘ 본문도 그 행에
    맞게 바뀐다. 특히 Fast의 ms 행과 Advanced의 Release 행이 **서로 다른 문구**를 보여야
    한다(같은 command id다).
13. `FEATURE → TAPPING`에서 1행에는 ⓘ가 없고 2~4행에만 있다.
14. ⓘ를 연 컨트롤 행에서 컨트롤이 오른쪽 자리를 유지한 채 본문만 아래 줄에 펼쳐지는지,
    독일어처럼 label이 긴 언어에서 컨트롤이 3번째 줄로 밀리지 않는지 본다.
15. `FEATURE → MOUSE`가 BRICK60·BRICK65·INTIGRITY80·MAY65·SCULPTUREI에서 모두 보이고,
    값을 읽고 쓸 수 있으며, 재연결 후에도 유지되는지 본다. `Cursor Acceleration`을 Off로
    바꾸면 `Cursor Speed` 한 줄로, 다른 값으로 바꾸면 `Cursor Start/Top Speed` 두 줄로
    바뀌는지도 함께 본다. **실기 없이는 판정할 수 없는 항목이다.**

## Anti-Ghosting → KKUK: 이름을 동작에 맞춘다

앞 절은 "메뉴 이름이 오해를 부르지만 정의가 그렇게 되어 있으므로 바꾸지 않는다"고 적었다.
사용자가 그 전제를 되물었고, 확인 결과 이름을 유지할 근거가 없었다.

**사실 확인 두 가지.**

1. `port/kkuk.c`에 `matrix` / `scan` / `row` / `col` 문자열이 **0건**이다. 호출하는 것은
   `keyboard_report`, `clear_keys()`, `send_keyboard_report()`, `millis()`,
   `IS_BASIC_KEYCODE`, `kill_switch_is_use`뿐이다. 매트릭스와 키맵이 이미 해석을 끝낸
   **HID 리포트 계층**에서만 동작한다.
2. H7S 5개 보드 어디에도 `MATRIX_HAS_GHOST`가 정의되어 있지 않다. 따라서
   `quantum/keyboard.c`의 `has_ghost_in_row()` 경로 자체가 컴파일되지 않는다. 스위치마다
   다이오드가 있어 매트릭스 고스팅이 물리적으로 발생하지 않는다.

즉 이 메뉴는 고스팅 방지가 아니다. `Mode` 드롭다운의 유일한 옵션 이름이 `Report Pulse`인
것도 펌웨어 스스로 이것을 리포트 계층 동작으로 부르고 있다는 증거다.

**결정: `KKUK`.** 후보는 `KKUK` / `HOLD CYCLE` / `REPEAT PULSE`였다. `KKUK`을 고른 이유는
펌웨어의 식별자가 이미 `kkuk.c`, `KKUK_ENABLE`, `id_qmk_kkuk_*`이어서 **코드·JSON·문서·앱이
한 단어로 수렴**하기 때문이다. 한국 사용자에게는 "꾹"이 곧 꾹보드라 즉시 읽히고, 그렇지
않은 사용자에게는 `SOCD`와 같은 고유명으로 읽힌다. 이 UI는 이미 그 패턴을 쓰고 있다 —
고유명 라벨 바로 아래 한 줄 요약이 설명을 진다. 여기서 그 요약은 `asdasdasd` 예시다.

`HOLD CYCLE`은 서술적이지만 레이어/홀드 순환으로 오독될 여지가 있고 펌웨어 내부 이름과
계속 어긋난다. `REPEAT PULSE`는 옵션 이름과는 맞지만 일반 사용자에게 "펄스"가 기술적이다.

### 라벨은 로케일이 풀어 쓴다

submenu label은 `t()`를 거치므로 로케일에 키가 있으면 번역된다. 이미 `SOCD`가 그렇게
쓰이고 있다(중국어만 `SOCD (同时按键冲突)`). 같은 방식으로 `KKUK` 키를 6개 로케일에 넣고
**한국어에서만 `KKUK (꾹보드)`로 풀어 썼다.** 한국 사용자는 메뉴 행만 보고 알아본다.
나머지 다섯 언어는 `KKUK` 그대로다.

정의 JSON의 라벨 자체는 영어 `KKUK` 하나이므로 공식 usevia.app에서도 같은 이름이 보인다.

### 설명문에서 바뀐 것

상세 첫 문장이 "메뉴 이름이 오해를 부른다"는 정정이었는데, 이름을 고쳤으므로 그 문장이
할 일이 없어졌다. 대신 **KKUK이라는 이름의 유래**를 첫 문장에 두고(라벨이 고유명이 된
만큼 그 설명이 필요해졌다), 이전 이름에 대한 안내를 마지막 문장으로 내렸다. 예전 이름을
기억하는 사용자를 위한 breadcrumb이며 한 릴리스 주기 뒤에 지워도 된다.

### 세 저장소에 동시에 적용했다

라벨만 바꾸고 앱과 매뉴얼이 서로 다른 이름을 쓰면 오해를 줄이려다 더 큰 혼란을 만든다.
같은 이유로 §2-4의 MOUSE 판단과 동일한 기준(`PROJECT_DIRECTION`의 "A path that only the
custom app can speak is an error")을 적용해 세 저장소를 함께 고쳤다.

| 저장소 | 변경 |
| --- | --- |
| `the-via-eerraa` | ERA 커스텀 정의 30개 라벨, 로케일 6종의 `KKUK` 키와 설명문 |
| `eerraa-qmk-h7s-fw-via2` | 공식 VIA JSON 5개 라벨, `docs/readme.txt` 2-5절(한·영), `DECISIONS.md` |
| `qmk_firmware_eerraa` | 공식 VIA JSON 25개 라벨, `user/readme.txt`·`readme_split.txt`, 보드별 `readme.md` 23개, HID 리포트 계약 문서의 상호참조 2곳 |

**채널·value id·EEPROM 배치·펌웨어 코드는 어느 저장소에서도 바뀌지 않았다.** 라벨은 JSON에만
있으므로 재빌드나 펌웨어 버전 상승이 필요 없고, 이미 플래시된 키보드도 새 JSON만 불러오면
새 이름으로 보인다.

`sirind/brick65`(ATmega32U4)만 라벨이 없다. 그 정의에는 FEATURE 메뉴 자체가 없다 —
`PROJECT_DIRECTION`이 기록한 영구 예외다. 생성 정의 31종 중 30종에 `KKUK`이 있는 것이
정상이다.

**남은 것**: `qmk_firmware_eerraa`의 `graphify-out/`에는 이전 이름이 담긴 노드가 남아 있다.
이번 세션은 앱 저장소를 cwd로 두고 작업했고 `graphify update`를 실행하지 않았다.

## 설명문을 다시 짧게: 제목은 이름, 본문은 켜고 끈 결과

사용자 지적: "기본적인 문구들이 괜한 서술이 긴 것 같습니다. 켰을 때 껏을 때 어떻게 동작하는지
간단하게 설명하고 기능에 대한 본질적인 설명을 최소화하는 방향이 좋겠습니다. 특히 제목부분은
'활성화시 부트로더 진입'처럼 서술형이 아닌 간단한 설명이 좋습니다."

앞 절들이 세운 구조(한 줄 요약 + 접힌 상세 + 컨트롤 단위 ⓘ)는 그대로 두고, **그 안에 든 문장의
성격**을 바꿨다.

- **요약은 설정을 부르는 이름이지 설명이 아니다.** `Puts the keyboard into bootloader mode so
  you can flash firmware.` → `Enters the bootloader when switched on.` / `켜면 부트로더로
  진입합니다.` 16개 메뉴 전부를 이 형태로 바꿨다. 일부만 바꾸면 나머지가 더 장황해 보이므로
  전면 교체가 아니면 의미가 없다.
- **상세는 켜고 끈 결과까지만 쓴다.** 기능이 무엇인지 원리를 설명하던 문장을 걷어냈다.
  본문 평균 길이가 절반 아래로 내려갔다(가장 길던 KKUK 108단어 → 54단어).

요약 16개는 모두 8단어 안팎이 됐고, 화면에서 상시 노출되는 줄이 한 줄을 넘지 않는다.

### 항목별로 고친 것

| # | 대상 | 고친 내용 |
| --- | --- | --- |
| 1 | Badge Lighting | 설명이 아예 없던 메뉴다. `Badge-Only RGB`는 뱃지에만 RGB가 들어온다는 것, `Indicator Only`는 뱃지가 효과를 표현하지 않고 인디케이터로만 동작한다는 것을 상세 한 문장씩으로 넣었다. 라벨 `Indicator Priority` → **`Indicator Only`** |
| 2 | SOCD | "경기에서 쓰기 전 규정을 확인하라"를 뺐다. 설정 안내가 할 말이 아니다 |
| 3 | KKUK | 요약에서 "흔히 말하는 꾹보드입니다"를 빼고 예시만 남겼다. 상세는 "흔히 말하는 꾹보드 기능입니다."로 시작한다 |
| 4 | DEBOUNCE 모드 | 아래 별항 |
| 5 | MOUSE | 컨트롤 7개에 각각 한 줄 ⓘ를 붙였다 |
| 6 | NKRO | 요약을 "동시에 입력되는 키 수에 제한이 없습니다"로, 상세를 "오래된 BIOS나 KVM 스위치가 입력을 받지 못한다면 끄세요. 끄면 6KRO로 최대 6키까지 동시 입력됩니다"로 |
| 7 | TAPDANCE | `KEYMAP → CUSTOM` → **`KEYMAP → TAPDANCE`**. `keycode-menus.ts`가 `label: 'TAPDANCE'`인 별도 탭을 만들고 `Custom`은 다른 탭이다. 이전 문구는 존재하지 않는 경로를 가리켰다 |
| 8 | SPLIT SYNC | 토글 3개에 각각 ⓘ를 붙였다. EEPROM SYNC가 나머지 둘의 바탕이라는 관계까지 적었다 |
| 9 | SPLIT LINK | "두 반쪽" → "양쪽 유닛". Apply를 눌렀을 때 값이 같으면 무반응·바뀌면 재부팅, 빨간 LED 3번은 케이블 교체, 기본값 High |
| 10 | BOOT | "켜면 부트로더로 진입합니다" + 이동식 디스크에 .uf2 복사 |
| 11 | EEPROM CLEAN | 10초 안에 세 토글, 전체 초기화 후 재시작, 놓치면 토글이 풀림 |
| 12 | VERSION | "이 키보드의 펌웨어 정보입니다." 상세는 한 문장 |
| 13 | USB POLLING | "USB 폴링 레이트를 설정합니다. 적용하면 재시작됩니다." |

### DEBOUNCE Advanced를 다른 축으로 설명한다

이전 문구는 `Advanced is Fast on the press and Balanced on the release`였다. 다른 두 모드를
알아야 이 모드를 이해할 수 있는 설명이라 직관적이지 않다는 지적이 맞다.

기준을 **"언제 보내는가"** 하나로 통일했다. 세 모드를 서로 참조하지 않고 각자 그 축 위에서
서술한다.

- Balanced — 스위치가 안정된 뒤에 보낸다. 누를 때도 뗄 때도 그래서 모든 입력이 늦게 인식된다.
- Fast — 바뀐 순간 보내고, 그 뒤 설정 시간 동안 그 키를 무시한다. 인식이 늦어지지 않는다.
- Advanced — **누름은 즉시 보내고 뗌만 안정될 때까지 기다린다.** 두 시간을 따로 정한다.

"누름은 즉시, 뗌은 기다림"은 모드 이름을 몰라도 읽힌다. 알고리즘 사실은 그대로다
(`asym_eager_defer_pk`: 누름 eager + `pre_ms` 잠금, 뗌 `post_ms` 지연 보고).

### MOUSE는 컨트롤 단위 ⓘ 기준의 예외가 아니었다

앞 절은 "MOUSE는 라벨과 단위가 답을 다 갖고 있어 하나도 붙지 않는다"고 적었다. **틀렸다.**
단위는 얼마인지는 말하지만 무엇의 얼마인지는 말하지 않는다. `Cursor Acceleration`의 `1.0 s`는
가속에 걸리는 시간이고, `Cursor Steps Per Second`의 `100 /s`는 그 시간을 바꾸지 않는 별개의
값이며, 포인터 속도 행은 가속이 켜졌는지에 따라 뜻이 달라진다. 기준 (b)"label이 사양을 서술할
뿐 결과를 말하지 않는다"에 정확히 해당한다. 7개 컨트롤에 각각 한 줄을 붙였다.

`id_qmk_mousekey_cursor_min_speed`는 `Cursor Speed`(가속 Off)와 `Cursor Start Speed`(가속 On)
두 행이 공유하므로, 디바운스 창과 같은 방식으로 label까지 함께 맞춘다.

여전히 붙이지 않는 것: 상단 요약이 이미 주어로 삼은 컨트롤(Global Tapping Term, KKUK의 Enable),
그리고 label에 단위를 더하면 정말로 답이 되는 컨트롤(Indicator Brightness).

### Anti-Ghosting → KKUK 다음의 이름 하나 더: Indicator Priority → Indicator Only

`id_custom_indicator_override`의 라벨이 `Indicator Priority`였다. "우선순위"는 무엇보다
우선하는지 말하지 않는다. 실제 동작은 **뱃지가 RGB 효과를 표현하지 않고 인디케이터로만
동작**하는 것이므로 `Indicator Only`가 그대로 동작 이름이다. 같은 메뉴의 `Badge-Only RGB`와
짝을 이룬다.

대상은 스플릿 3종(tomak, tomak79h, tomak79s)의 좌우 정의 6개뿐이다. H7S에는 Badge Lighting
메뉴 자체가 없다.

### 레포마다 대상이 다르다

"세 저장소 모두 적용"은 항목별로 의미가 다르다. 설명 문구는 앱에만 있고, 펌웨어 저장소에는
정의 라벨과 사용자 매뉴얼이 있다. 게다가 메뉴가 있는 정의가 계열마다 다르다.

| 메뉴 | 전체 정의 | H7S | RP2040 |
| --- | --- | --- | --- |
| SOCD / KKUK / DEBOUNCE / TAPPING / BOOT / TAPDANCE | 27 | 5 | 22 |
| MOUSE | 26 | 5 | 21 |
| NKRO | 21 | **0** | 21 |
| EEPROM 초기화 | 22 | **0** (H7S는 `CLEAN` 5) | 22 |
| Badge Lighting / SYNC / LINK | 2~3 | **0** | 스플릿 전용 |
| USB POLLING / VERSION | 5 | 5 | **0** |

그래서 NKRO·SYNC·LINK·Badge Lighting은 H7S 저장소에 손댈 곳이 없고, USB POLLING은 RP2040에
없다. 매뉴얼도 각 저장소에 있는 기능만 고쳤다.

### 남은 것

`Backlight`(8개 정의, `id_custom_backlight_*`)에는 여전히 설명이 없다. 이번 지시 범위 밖이라
`tests/era-definition.test.ts`의 허용 목록에 이름을 남겨 두었다 — 목록에 있다는 것은 "없어도
되는 것으로 결정했다"는 뜻이고, 없는 채로 조용히 지나가지는 않는다. `id_custom_backlight_*`는
공식 VIA 스냅샷 2,034개 정의에 0건이므로 게이트로 쓸 수 있다는 점은 확인해 두었다.

## 열여섯 메뉴가 한 목소리로 읽히게

사용자 지적: "확장전(제목)의 메뉴간의 결이 비슷한지, 확장후의 내용의 각 메뉴간에 결이 비슷한지
점검하세요. 혼자서 튀는 메뉴가 있으면 안 됩니다."

16개 요약과 상세를 한 표에 놓고 재니 세 가지가 어긋나 있었다.

1. **요약의 인칭이 섞여 있었다.** `Only the key **you** pressed last counts.`,
   `**Hold** a, s and d and **you** get…`, `…in **your** keymap.` 세 개만 독자를 부르고 나머지
   열셋은 비인칭이었다. 요약은 설정의 이름이므로 전부 비인칭으로 통일했다. 독자를 부르는 것은
   상세의 몫이다.
2. **KKUK 요약만 예시 문장이었다.** 다른 열다섯은 "이 메뉴가 무엇인가"를 말하는데 혼자
   "a, s, d를 눌러 보라"였다. 동사구로 시작하고 예시를 뒤에 붙여
   `Cycles the keys held down, so a, s, d gives "asdasdasd".`로 바꿨다. 예시는 살아남고 형태는
   나머지와 같아졌다.
3. **길이가 5~17단어로 흩어져 있었다.** 요약 5~11단어, 상세 16~49단어로 좁혔다.
   USB POLLING 요약은 두 문장이었는데 세미콜론으로 한 문장이 됐다.

`tests/locales.test.ts`가 이 계약을 잡는다 — 요약은 **12단어 이하**, **2인칭 없음**, **6개 언어
전부에서 한 문장**. 마지막 조건이 실제로 일본어 USB POLLING 요약이 두 문장으로 남아 있던 것을
잡아냈다. 눈으로 훑어서는 놓쳤을 종류의 불일치다.

상세는 16~49단어로 남았다. 짧은 쪽(VERSION 16, SYNC 18, MOUSE 21)은 더 할 말이 없거나
컨트롤 단위 ⓘ가 나머지를 지고 있는 메뉴라서 짧은 것이고, 그 옆에 INDICATOR 22 · BADGE 23 ·
LIGHTING 26이 붙어 있어 끊기지 않는 띠를 이룬다. 단어 수 상한을 상세에는 걸지 않았다 —
길이가 아니라 형태가 결을 만든다.

### 이번 라운드의 나머지 지시

| # | 고친 것 |
| --- | --- |
| 1 | DEBOUNCE 상세 마지막 문장을 "모드별로 영향을 주는 항목만 나타납니다"로. 이전 문구는 모드가 화면을 정한다고만 했지 왜 그런지를 말하지 않았다 |
| 2 | 메뉴 라벨 `KKUK (꾹보드)` → `KKUK`, 상세에서 "흔히 말하는 꾹보드 기능입니다" 삭제. 매뉴얼 3종의 절 제목과 기능 목록에서도 통칭을 뺐다. 인식의 부담은 요약의 `asdasdasd` 예시가 혼자 진다 |
| 3 | NKRO 요약을 "동시 입력 키를 무제한으로 확장합니다"로. 제한이 없다는 사실보다 확장한다는 동작이 앞선다 |
| 4 | TAPDANCE 네 동작에 컨트롤 단위 ⓘ. `On Tap`은 짧게 눌림 판정, `On Hold`는 길게 눌림 판정, `On Double Tap`은 Term 안 두 번, `Tap+Hold`는 탭 뒤 길게. `Term (ms)`는 상단 상세가 이미 주어로 삼고 있어 붙이지 않았다 |
| 5 | EEPROM SYNC ⓘ에 "INPUT SYNC와 RGB SYNC를 완전히 지원하려면 이것이 먼저 켜져 있어야 합니다" |

TAPDANCE는 같은 다섯 컨트롤이 슬롯 8개에 반복되므로 `command` 정확 일치로는 40개 항목이
필요했다. `commandPrefix`(`id_qmk_tapdance_`) + 행 label 조합으로 4개 항목이 슬롯 전부를 덮는다.
