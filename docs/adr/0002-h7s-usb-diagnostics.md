# 0002 — H7S USB 전달 진단 계약

Status: Accepted
Genre: contract
Canonical for: selector `0x07` wire, instrumentation bounds, normalization basis, host
persistence and comparison validity — which axes remain comparable across diagnostic runs

이 ADR은 wire·계측·비교 유효성만 담는다. 화면 배치와 문구 계약은
[ADR 0003](0003-era-menu-help-ui.md)에 있다.

## Context

기존 H7S firmware의 USB instability monitor는 SOF 간격을 heuristic score로 바꾸고
8K → 4K → 2K → FS downgrade, EEPROM BootMode 변경, reset까지 수행했다. 현재 제품 정책은
FS 1K를 기본으로 하되 고속 polling mode는 사용자가 직접 선택하고 firmware가 그 결정을
되돌리지 않는 것이다. SOF 도착은 실제 HID report 전달 완료가 아니므로 이 정책과 계측 의미를
함께 바로잡아야 했다.

Firmware audit에서 USB IRQ는 main loop와 별개이며 기존 monitor가 전제한 SOF score는 실제
report queue wait와 keyboard IN `DataIn` 완료를 측정하지 않는다는 점을 확인했다. App audit
에서는 WebHID transport가 path별 단일 직렬 queue, tagged response matcher, connection
generation invalidation을 이미 제공하고, chart dependency 없이 SVG/CSS로 작은 시각화를
통합할 수 있음을 확인했다.

## 제품 경계

사용자가 VIA의 기존 BootMode control로 mode를 바꾸고 재부팅한 뒤 각각 별도 10/30/60초
test를 실행한다. Firmware 진단 state와 aggregate는 RAM-only다. 장기 history만 host
localStorage에 둔다. selector probe는 canonical ERA metadata의 `usbDiagnostics: true`인
다섯 H7S definition에서만 허용한다. Ordinary/official/upload definition에는 새 packet을
전송하지 않는다.

> **REFUSED:** 자동 다운그레이드, 자동 mode 벤치마크, EEPROM 진단 이력, 합성 안정성 점수,
> selector `0x07`을 polling mode나 State Sync 복구에 결합하기.
> **WHY:** 모드 선택은 항상 사용자의 것이고, SOF 간격 heuristic은 실제 HID 전달이 아닌데
> 결정을 되돌렸으며, 진단이 제어면·EEPROM·복구를 바꾸면 관측이 관측 대상을 오염시킨다.
> **REOPENS:** 없다. 관측이 더 필요하면 읽기 전용 `0x07` 세션을 넓힌다.

## 계측

Always-on 계측은 사건이 실제 발생할 때만 포화형 `uint32` counter를 갱신한다.

- keyboard/EXK retry queue가 report를 받지 못한 실제 drop
- USB reset, HID configuration, suspend, negotiated speed change

On-demand session에서만 다음을 읽는다.

- HID delivery: `usbHidSendReport()`가 report를 받은 시각부터 keyboard IN `DataIn` 완료까지.
  Queue에 들어갈 때 원 요청 시각과 session ID를 보존한다.
- Firmware timing: 연속 `qmkUpdate()` 진입 사이 gap, 최대 gap, 1000 µs 초과 건수
- Queue depth peak
- polling interval에 대한 0.5/0.75/1/1.25/1.5/2/4배 경계의 8-bin histogram
- hard event와 1 ms 초과 loop stall의 최근 8개 bounded timeline

Histogram quantile은 raw percentile이 아니라 해당 bucket의 **상한 경계**로 표시한다. 앱은
연속 coherent snapshot의 누적 histogram 차이로 약 1초 window의 p99 경계를 만들고, firmware가
매 snapshot마다 초기화하는 window maximum과 함께 time-series로 표시한다.

> **REFUSED:** SOF high-resolution 계측과 release session contract의 matrix timing probe.
> **WHY:** 매 125 µs hot path timestamp 비용이 있고, 실제 HID delivery와 다른 신호인데도
> 과거 heuristic 오해를 다시 만들기 쉽다.
> **REOPENS:** 없다. Matrix timing probe는 기존 개발용 instrumentation과 중복이다.

## Wire contract

Re-measured from `src/utils/era-usb-diagnostics.ts` and
`tests/era-usb-diagnostics.test.ts`. Existing `GET_KEYBOARD_VALUE`
(`ERA_USB_DIAGNOSTICS_COMMAND_GET` `0x02`) /
`SET_KEYBOARD_VALUE` (`ERA_USB_DIAGNOSTICS_COMMAND_SET` `0x03`) + selector
`ERA_USB_DIAGNOSTICS_SELECTOR` `0x07`. Protocol
`ERA_USB_DIAGNOSTICS_PROTOCOL_VERSION` `0x01`. Layout is the 32-byte VIA
payload with WebHID report id `0` stripped (`ERA_USB_DIAGNOSTICS_PACKET_SIZE`).
Integers are big-endian.

This selector is not `APICommand.CUSTOM_MENU_SET_VALUE` `0x07`. Diagnostics
rides on keyboard-value GET/SET; custom-menu SET is a different command.

The host encodes with `encodeUsbDiagnosticsRequest`, prepends report id `0`,
and matches on length 32, command (`0x02`/`0x03` or `0xFF`), selector, and
echoed tag. Per-path tag is incrementing BE16, skip 0 on wrap. Reserved
request bytes `9..31` are 0.

> **REFUSED:** an unsolicited `0x07` producer, or a second packet length.
> **WHY:** this host only `exchange`s a tagged 32-byte GET/SET
> (`src/utils/era-usb-diagnostics.ts`); `0xFF` is `unhandled`, and any other
> length fails the matcher / `parseHeader`.
> **REOPENS:** a new protocol version, approved separately.

### Request

|    Byte | Field |
| ------: | ----- |
|     `0` | GET `0x02` or SET `0x03` |
|     `1` | `0x07` |
|     `2` | `0x01` |
|     `3` | operation |
|  `4..5` | host tag, BE16 |
|     `6` | argument: START duration seconds, or SNAPSHOT chunk index; else 0 |
|  `7..8` | snapshot sequence, BE16; chunk 0 GET sends 0 |
| `9..31` | `0` |

| Operation | Id | Command |
| --------- | -- | ------- |
| capabilities | `ERA_USB_DIAGNOSTICS_OPERATION_CAPABILITIES` `0x00` | GET |
| snapshot | `ERA_USB_DIAGNOSTICS_OPERATION_SNAPSHOT` `0x01` | GET |
| start | `ERA_USB_DIAGNOSTICS_OPERATION_START` `0x10` | SET |
| stop | `ERA_USB_DIAGNOSTICS_OPERATION_STOP` `0x11` | SET |
| clear | `ERA_USB_DIAGNOSTICS_OPERATION_CLEAR` `0x12` | SET |

START argument is one of `ERA_USB_DIAGNOSTICS_DURATIONS`: 10, 30, 60.

### Response

|     Byte | Field |
| -------: | ----- |
|      `0` | echoed command |
|      `1` | `0x07` |
|      `2` | `0x01` |
|      `3` | echoed operation |
|   `4..5` | echoed tag, BE16 |
|      `6` | status |
|      `7` | state: idle 0, running 1, complete 2, stopped 3 |
|   `8..9` | session ID, BE16; none is 0 |
| `10..11` | frozen snapshot sequence, BE16 |
|     `12` | chunk index |
|     `13` | chunk count |
| `14..31` | 18 B operation payload |

`parseHeader` requires length 32, selector `0x07`, version `0x01`, echoed
operation and tag, state `0..3`, and status `≤ 5`. Status `> 5`, a state
outside `0..3`, or a length other than 32 is not this packet (`malformed`).
Command `0xFF` is `unhandled`, not a status code.

| Status | Id |
| ------ | -- |
| OK | `ERA_USB_DIAGNOSTICS_STATUS_OK` `0x00` |
| unsupported version | `ERA_USB_DIAGNOSTICS_STATUS_UNSUPPORTED_VERSION` `0x01` |
| invalid | `ERA_USB_DIAGNOSTICS_STATUS_INVALID` `0x02` |
| busy | `ERA_USB_DIAGNOSTICS_STATUS_BUSY` `0x03` |
| no session | `ERA_USB_DIAGNOSTICS_STATUS_NO_SESSION` `0x04` |
| stale snapshot | `ERA_USB_DIAGNOSTICS_STATUS_STALE_SNAPSHOT` `0x05` |

OK continues into the payload parser. Stale snapshot is kind `stale`. The
other defined codes are kind `status`.

Capabilities, START, STOP, and CLEAR require sequence 0, chunk index 0, and
chunk count 0.

### Capabilities payload

Packet byte 14 is payload byte 0. Host requires every bit of
`ERA_USB_DIAGNOSTICS_REQUIRED_CAPABILITIES` `0x1f`. Extra flag bits are
allowed. Duration mask bits outside `ERA_USB_DIAGNOSTICS_DURATION_MASK`
`0x07` fail parse. Mask bits 0, 1, 2 map to 10, 30, 60 seconds.

| Payload byte | Field |
| -----------: | ----- |
|          `0` | flags: report timing `0x01`, histogram `0x02`, firmware timing `0x04`, timeline `0x08`, boot counters `0x10` |
|          `1` | duration mask |
|          `2` | histogram buckets; host requires `ERA_USB_DIAGNOSTICS_HISTOGRAM_BUCKETS` 8 |
|          `3` | timeline capacity; host requires `ERA_USB_DIAGNOSTICS_TIMELINE_CAPACITY` 8 |
|       `4..5` | recommended snapshot interval ms, BE16; host requires nonzero (capability fixture and H7S encoder send 1000) |
|          `6` | endian; host requires 1 (big) |
|          `7` | time unit; host requires 1 (microseconds) |
|          `8` | firmware version length; host requires 1–9 |
|     `9..17` | ASCII `0x20..0x7e` of that length, then 0 |

### START / STOP / CLEAR payload

START OK: packet `14` duration (10 / 30 / 60), `15` polling mode `0..3`,
`16..19` expected interval µs BE32 nonzero, `20..31` 0.

STOP and CLEAR: packet `14..31` 0.

### Snapshot chunks

`getUsbDiagnosticsSnapshot` GETs chunk 0 with argument 0 and sequence 0.
Host requires response chunk index 0, sequence ≠ 0, and chunk count in
`ERA_USB_DIAGNOSTICS_BASE_CHUNKS` 8 .. `ERA_USB_DIAGNOSTICS_MAX_CHUNKS` 12.
It then GETs each later chunk with argument = index and sequence = that
frozen sequence, one in flight. Identity (state / session / sequence /
index / count) that changes mid-read is `malformed`. Stale snapshot aborts
that read as kind `stale`.

Parse also requires snapshot state ≠ idle (0), session ID ≠ 0, event count
`≤ 8`, and `chunkCount === 8 + ceil(eventCount / 2)`. Event type is `1..6`.
Odd last event: packet bytes `23..31` of that chunk are 0. Chunks 2, 3, 5, 6:
packet `30..31` are 0. Chunk 7: packet `26..31` are 0.

| Chunk | 18 B payload (packet `14..31`) |
| ----: | ------------------------------ |
|   `0` | mode U8, speed U8, duration U8, event count U8, elapsed ms U32, expected interval µs U32, report samples U32, histogram buckets U8, timeline capacity U8 |
|   `1` | latency min / average / max / window max U32×4, queue peak U16 |
| `2..3` | histogram U32×4 each |
|   `4` | loop samples / max / window max / stall count U32×4, stall threshold U16 |
|   `5` | boot drops / resets / configurations / suspends U32×4 |
|   `6` | boot speed changes, session drops / resets / configurations U32×4 |
|   `7` | session suspends / speed changes / timeline overwrites U32×3, then 0 |
| `8..11` | two events each: type U8 + relative ms U32 + value U32 |

Chunk 0 mode is `0..3` (FS 1K / HS 2K / HS 4K / HS 8K). Speed is `0..2`
(Unknown / Full Speed / High Speed). Duration is 10 / 30 / 60. Chunk 0
histogram buckets / timeline capacity must be 8 / 8.

## Normalization basis and negotiated speed

Firmware는 session 시작 시점의 선택 mode에서 `expected interval`을 계산하고 모든 histogram
bucket과 window multiplier를 그 값으로 정규화한다. **이 값은 실제 enumerate된 link speed가
아니다.** FS 1K는 항상 Full Speed로, HS 2/4/8K는 항상 High Speed로 enumerate되므로, 선택 mode와
협상된 speed가 다르면(예: HS 8K 선택 상태로 FS만 지원하는 hub/port에 연결) 정규화 기준이 실제
polling 간격의 8배까지 어긋난다. 이 경우 raw microsecond 값과 counter는 여전히 유효하지만
multiplier·quantile bound·trend는 선택 mode를 설명하지 않는다.

Firmware wire contract는 바꾸지 않는다. Snapshot이 이미 polling mode와 negotiated speed를 함께
보내므로 **앱이 두 값의 정합성을 판정한다.** 불일치하면 결과 상단에 전용 caveat panel을 띄우고,
connection panel과 `Copy Diagnostic Report` 본문에 경고 문장을 넣으며, mode comparison table의
해당 row를 `speed mismatch`로 표시해 다른 row와 정규화 열을 비교하지 못하게 한다. 숫자를
숨기거나 자동으로 mode를 바꾸지는 않는다.

## 비교 축은 위상 독립 지표다

이 절은 실기에서 두 번 뒤집힌 결과다. 지금의 기준만 남기고 근거를 함께 둔다.

리포트 방출이 firmware 디바운스의 **1 ms tick 경계**에 묶여 있고, 그 tick과 host USB frame의
위상차가 **boot마다 무작위로 정해진다.** 그래서

- 같은 boot 안의 두 run은 `min`이 동일하고, 다른 boot이면 달라진다. `min`이 곧 그 위상이다.
- 재열거만으로 같은 firmware·같은 mode의 min/avg가 크게 이동한다
  (관측 예: FS 166/231 → 512/558 µs, HS 4K 8/232 → 140/184 µs).
- 지연의 절대 폭이 폴링 간격과 무관하므로, 정규화값만 보면 FS가 최고·HS 4K가 최악으로
  보이는 역전이 생긴다(FS/HS 2K/HS 4K 평균이 231/224/232 µs로 사실상 같은데 정규화는
  0.23×/0.45×/0.93×).

따라서 mode comparison table의 기본 축은 **위상에 영향받지 않는 지표**다.

| 열 | 정의 | 왜 |
| --- | --- | --- |
| `Spread` | (Max − Min) / interval | 몇 개의 추가 polling interval을 더 기다렸는가 |
| `Queue` | queue depth peak | 전송 대기가 실제로 쌓였는가 |
| `Drops` | report queue drop | 실제 유실 |
| `Loop max` | main-loop 최대 gap | 펌웨어가 멈췄는가 |

`Avg`/`Max`는 유지하되 **"연결마다 재추첨되는 고정 offset이 포함되어 run 간 비교 불가"**임을
표에 명시한다. Normalized column(p99 bound, > 2×)은 지우지 않는다 — "그 mode가 자기 interval
예산 안에 있었는가"라는 **별개 질문**에는 여전히 맞는 답이다.

### 같은 비교 그룹에 넣으면 안 되는 것

- firmware가 IN endpoint busy state를 endpoint별로 분리하기 전후. 분리하면 keyboard와 EXK가
  동시에 in-flight가 되어 delivery latency와 queue depth의 기준선이 내려간다.
- 진단 블록이 최상위 페이지였을 때와 `USB POLLING` 안에 인라인인 지금의 loop timing.
  후자는 State Sync 500 ms poll이 같은 직렬 queue에서 함께 돈다([ADR 0003](0003-era-menu-help-ui.md) §1).

## Host persistence and comparison

Local storage key는 `era.usbDiagnostics.history.v1`, envelope schema version은 1이다. 각 run은
VPID, product name, firmware version, diagnostics protocol, mode/speed, duration, start/end
timestamp, complete/stopped/aborted outcome, 최대 65개 snapshot을 가진다. 최대 24개 run만
보존하며 corrupt/unknown-schema record는 무시한다.

Comparison은 aborted run을 제외하고 **VPID + firmware version + protocol version이 모두 같은**
결과만 묶는다. Device path나 raw HID 식별자는 저장하지 않는다.

표시 중인 결과가 현재 연결의 것이 아니면 mode·duration·outcome·timestamp를 명시한 caveat
panel을 띄운다. session이 중단되면 `currentRun`과 live snapshot이 초기화되고 이전 run으로
말없이 fallback해, "Unmatched firmware session" 배너와 이전 run의 "State: Complete"가 동시에
표시된 적이 있다. `Copy Diagnostic Report`도 그 이전 run을 복사했다.

## Failure and lifecycle behavior

- Unhandled `0xFF` 또는 unsupported-version status는 graceful unsupported UI가 된다.
- Ordinary device는 metadata gate에서 끝나므로 selector probe 자체가 없다.
- 모든 request는 기존 path별 WebHID queue에서 직렬화하고 generation을 보존한다.
- Timeout/malformed snapshot은 최대 세 번 연속 실패까지 재시도한다. Disconnect 또는 세 번
  실패는 session을 aborted로 끝내며 captured partial snapshot이 있으면 저장한다.
- Page/device/connection generation이 바뀌면 polling owner를 취소하고, 아직 같은 generation이면
  STOP을 queue해 high-resolution probe를 끈다. Polling loop는 이때 수집한 partial snapshot을
  aborted로 저장한 뒤 owner를 비우므로, page가 mount된 채 connection generation만 바뀌어도
  Start가 잠기지 않는다.
- Reconnect 후 firmware에 출처를 알 수 없는 running session이 남아 있으면 자동으로 history에
  붙이지 않는다. 사용자가 그 session을 stop한 뒤 새 test를 시작한다.
- STOP은 final coherent snapshot을 한 번 읽는다. CLEAR는 running 중 사용하지 않고 device RAM의
  session result만 지우며 local history와 boot counter는 지우지 않는다.

### 끝난 session은 키보드에서 되읽는다

절전으로 중단된 session이 page 기록을 전혀 남기지 못한 일이 있었다. Firmware는 그 결과를
CLEAR나 다음 START 전까지 RAM에 유지하는데 app이 읽을 방법을 제공하지 않았다.
`sessionState`가 `complete(2)`/`stopped(3)`이고 page가 그 session을 따라가지 못했으면 읽어서
표시한다.

- **local history에 저장하지 않는다.** page가 시작 시각을 모르기 때문이다. History entry는
  알려진 start time과 identity를 유지해야 한다는 원칙을 지킨다. 표시와 Copy만 한다.
- 표시할 때 "이 page가 돌린 테스트가 아니라 키보드에서 읽은 결과"라고 출처를 명시한다.
- `Copy Diagnostic Report`는 **화면에 보이는 run**을 따라간다.

## State Sync opt-in과의 결합

H7S 5종은 매니페스트에서 `stateSync: true`이기도 하다. 그래서 앱은 진단과 무관하게 selector
`0x06`을 먼저 probe하고, 그 probe가 `unverified`로 끝나면
`getCustomMenuAvailabilityForDevice()`가 **Custom pane 전체를 안내 문구로 대체한다.**
`USB POLLING` submenu가 렌더링되지 않으므로 그 안의 진단 블록도 함께 사라진다.

두 selector의 opt-in gate는 서로 독립이지만 **화면 도달 경로는 독립이 아니다.** H7S에서
진단이 보이지 않으면 먼저 `0x06` capability를 의심한다.

## Consequences

Diagnostics OFF에는 SOF timestamp나 scan-level probe가 없고, hard event의 rare counter
increment와 session-active branch만 남는다. ON에서는 main loop 한 번, keyboard report
request/completion 경계의 timer read와 약 1 Hz multi-packet aggregate read가 추가된다.
Raw 8 kHz sample stream, heap, firmware history buffer, EEPROM write가 없다.

App에는 독립 chart dependency를 추가하지 않았다. SVG/CSS view가 VIA theme variable을 사용하고
responsive grid와 horizontal table overflow로 기존 dark/light theme와 좁은 viewport를 따른다.

## Verification

- Firmware host test: protocol tag/version/reserved bytes, duration, busy/stop/clear, delivery
  queue wait, histogram, loop stall, hard event, frozen multi-chunk consistency, stale sequence,
  saturation, timer wrap, auto-complete
- Firmware May65 MinGW build와 legacy monitor/downgrade/reset/EEPROM symbol absence
- App fake transport: exact request, capability, sequential chunk read, stale/malformed,
  unsupported/timeout/disconnect, SET control — `tests/era-usb-diagnostics.test.ts`
- App history: schema/corruption/bounds/version grouping/aborted exclusion/report text —
  `tests/usb-diagnostics-history.test.ts`
- App result render와 문구 안전장치 — `tests/diagnostics-pane.test.tsx`
- 배치와 opt-in gate — `tests/custom-menu-pane.test.tsx`

실기기에서는 FS 1K 및 HS 2/4/8K 각각에 대해 diagnostics off/on keyboard interval, queue drop,
VIA response latency를 여러 host controller/hub/cable에서 비교해야 한다. 자동 build와 host
fixture는 이 물리 검증을 대신하지 않는다.
