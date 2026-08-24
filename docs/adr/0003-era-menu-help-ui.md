# 0003 — ERA 메뉴 설명과 진단 화면 UI

Status: Accepted

ERA 전용 메뉴는 이름만 있고 설명이 없었고, USB 진단은 앱에서 설명이 가장 많은 화면이다.
둘은 같은 disclosure 컴포넌트(`src/components/inputs/explain.tsx`)를 쓰므로 한 계약으로 묶는다.
wire와 계측은 [ADR 0002](0002-h7s-usb-diagnostics.md), 정의 소유권은
`docs/PROJECT_DIRECTION.md`가 담당한다.

## 1. 진단 블록은 자기가 재는 설정 아래에 인라인으로 있다

진단 블록은 `CONFIGURE → SYSTEM → USB POLLING` submenu의 `Apply Selected Mode` 아래에
**항상 펼쳐진 상태로** 렌더링한다.

최상위 `/diagnostics` 페이지를 두었던 최초 결정은 두 가지로 실패했다.

- 사용자는 `USB POLLING`에서 mode를 바꾼 뒤 그 효과를 보려 했는데 기능이 전혀 다른 곳에
  있어 찾지 못했다.
- 최상위 탭은 31개 정의 중 다섯 H7S에서만 의미가 있는데도 모든 키보드에 항상 보였다.
  "일반 VIA 키보드의 시각 언어와 workflow를 보존한다"는 포크 계약과 어긋난다.

Modal은 기능을 한 단계 더 숨기고, session이 열려 있어야 하는 10/30/60초 동안 실수로 닫으면
firmware session만 남는 위험을 키운다. Accordion도 같은 이유로 발견성 이득이 줄어 둘 다
탈락했다.

**정의 JSON은 바꾸지 않는다.** `menu-generator.tsx`가 그 submenu의 item 중
`id_qmk_usb_bootmode` command가 있는지만 보고 `UsbDiagnosticsSection`을 렌더링하며, section
자체가 다시 `shouldProbeUsbDiagnostics()`로 ERA 소스 + `usbDiagnostics: true` opt-in을
확인한다. 이중 게이트이므로 공식 스냅샷이나 Design 업로드로 열린 같은 키보드에는 selector
`0x07`이 나가지 않는다.

부수 효과 두 가지가 남는다.

- polling mode를 바꾸는 화면을 떠나지 않고 측정할 수 있게 되어, page 이동으로 session이
  끊기던 경로가 하나 사라졌다. 대신 submenu나 category를 옮기면 section이 unmount되어
  session이 `aborted`로 저장되므로 실행 중에는 그 사실을 화면에 띄운다.
- 이전 배치에서는 `configureVisible`이 false여서 State Sync의 500 ms recovery poll이 멈춰
  있었다. 인라인 배치에서는 Configure가 보이는 상태로 측정하므로 그 poll이 진단 snapshot
  읽기와 **같은 직렬 WebHID queue에서 함께 돈다.** 제어 트래픽이 초당 약 2건 늘고
  main-loop에서 처리되므로 `loop max`/stall count의 baseline이 올라갈 수 있다.
  측정 창을 위해 recovery 동작을 바꾸지는 않는다 — `docs/PROJECT_DIRECTION.md`가 selector
  `0x07`을 polling mode나 recovery에 결합하지 않는다고 못박았다. 대신 이전 배치에서 저장된
  run과 loop timing을 직접 비교하지 않는다.

`/diagnostics` route는 `/`로 redirect만 남긴다. 열려 있던 탭이나 북마크가 빈 화면이 되지
않게 하는 용도이며 global icon bar에서는 사라진다. (배포 호스트의 콜드 딥링크는 이 redirect에
닿지 못한다 — `docs/MAP.md` §7 참조.)

## 2. 결과 화면: 기본은 요약, 고급은 요청할 때

패널 9개를 한 번에 보여주던 화면은 일반 사용자가 읽을 수 없었다. 정보를 지우는 안은
채택하지 않았다 — 비교표를 복사-붙여넣기 텍스트로 옮기면 기능 자체가 죽고, `Spread`/`Queue`
열이 사라지면 §3이 막는 오독이 그대로 돌아온다.

**기본 요약 뷰 + `Advanced metrics and mode comparison` 토글.** VIA Settings의
`Show Diagnostic Information` 토글과 같은 계열의 기존 패턴이다.

요약이 답하는 질문은 하나다 — "이 모드로 이번 창에서 문제가 있었는가". 답에 필요한 다섯
가지만 2열 정의 목록으로 놓는다. 왼쪽은 평문 주제, 오른쪽은 관측 사실이다.

| 다루는 것 | |
| --- | --- |
| report queue drop | 키 입력 유실 |
| USB hard event | 연결 변화(reset/configuration/suspend/speed change) |
| 1 ms 초과 firmware main-loop gap | 펌웨어 멈춤 |
| queue depth peak | 전송 대기 최대 |
| 선택 mode ↔ 협상 speed 정합 | 연결 속도 |

절대 µs, 정규화 분위수, 히스토그램, 추세, 타임라인, 부팅 누계는 advanced로 옮겼다. caption
없이 읽으면 반드시 오독되는 값들이고, caption은 각 패널에 그대로 남아 있다. 요약 뷰는
숫자를 caption 없이 보여주는 대신 아예 보여주지 않는 쪽을 택했다.

토글은 자기가 여는 내용보다 **위**에 둔다. 아래에 있으면 켤 때 위아래 양쪽에 내용이 나타나
어디를 봐야 할지 알 수 없다.

컨트롤은 실제로 동작할 수 있는 순간에만 렌더링한다. 상시 6개를 disabled로 두지 않는다.
복구·정리 동작은 컨트롤 행에서 빠지고 그 **상황을 설명하는 카드 안**으로 들어간다.
버튼이 설명을 이름에 담을 필요가 없어지므로 `Show It` / `Discard It` / `Stop It`로 충분하다.
기본 컨트롤 행은 `Test duration` + `Start Test`만 남는다.

`Read Device Result`가 이해되지 않는다는 피드백의 원인은 길이가 아니라 추상성이었다.
그 이름은 *동작*(장치에서 결과를 읽는다)을 말할 뿐 *상황*(절전·새로고침·재연결로 테스트가
끊겼는데 결과는 키보드에 남아 있다)을 말하지 않았다. 더 줄이면 더 모호해진다.

### 접히지 않고 화면에 남는 것

판단을 뒤집는 사실은 disclosure 뒤에 두지 않는다.

- 속도 불일치 caveat 전문 (조건부로만 나타나므로 나타났을 때는 전부 보인다)
- 표시 중인 run의 정체와 "진단 보고서 복사도 이 결과를 복사한다"
- 부팅 누계의 "테스트가 끝난 순간에 읽은 값이며 보고 있는 동안 올라가지 않는다"
  — **실기에서 두 번 오판이 나온 지점이다.** 한 줄로 줄이되 화면에는 남긴다.
- 비교표의 "실행 비교는 spread·유실·큐로 하라 — 평균과 최대에는 다시 꽂을 때마다 새로
  뽑히는 오프셋이 들어 있다" 한 줄 요지 (근거 전문만 접는다)

`tests/diagnostics-pane.test.tsx`가 이 구분을 검사한다. 접힌 본문을 제거한 마크업에 대해
"화면에 남아야 하는 것"은 있어야 하고 "접혀도 되는 것"은 없어야 한다.

## 3. 관측 서술은 판정이 되면 안 된다

진단은 **측정한 창에서 관측한 것만** 말한다. `No report queue drops were observed`는
허용하고 stable / perfect / certified / 종합 점수는 금지한다.

**이 규칙의 원인:** 실기 검증에서 정확히 이런 종류의 과잉 주장으로 **두 번 오판이 나왔다.**
관측하지 않은 실패 범주까지 덮는 문장이 "괜찮다"로 읽혔기 때문이다. 규칙만 남기고 원인을
지우면, 대시보드를 예쁘게 만들다가 종합 점수를 넣고 싶어진 다음 사람을 멈출 것이 없다.

- 포괄 진술 금지를 UI 문구로도 명시한다: "이 다섯 줄이 이번 테스트가 보는 전부입니다.
  그 밖에 잘못될 수 있는 것들은 이 테스트가 재는 범위 밖입니다."
- report sample이 0이면 "이번 테스트에서 키를 누르지 않았다"를 덧붙인다. 키를 누르지 않은
  창에서는 delivery 관련 문장이 공허하게 참이 되어 깨끗한 결과처럼 읽힌다.
- **번역에서도 강제한다.** 유창한 번역이 "관측되지 않았습니다"를 "안정적입니다"나
  "문제 없습니다"로 승격시키면 계약이 깨진다. `tests/locales.test.ts`가 관측 서술 키에
  대해 6개 언어별 판정 표현 정규식을 검사하고, 모든 `{{placeholder}}`가 번역에서 살아남는지도
  함께 본다.
- **범위는 진단의 관측 서술까지다.** 설정 안내문에는 적용하지 않는다 — "연결이 실제로
  불안정할 때만 속도를 낮추세요"는 케이블에 대한 조언이고 여기서 "불안정"은 옳은 단어다.
  검사기가 처음에 이런 문장을 여섯 건 잡아냈으므로 검사 범위를 `DIAGNOSTIC_OBSERVATION_KEYS`
  목록으로 좁혔고, 검사기는 그 목록을 테스트 파일에서 직접 읽으므로 두 곳이 어긋날 수 없다.

## 4. 낱말과 타입 스케일

`report`는 HID 용어, `enumerate`는 USB 스펙 용어, `queue depth`는 펌웨어 용어다. 폴링 속도를
바꾸러 온 사람에게는 아무 의미가 없다. **측정 대상은 그대로 두고 부르는 말만 바꾼다** —
"유실된 키 리포트"가 아니라 "키 입력 유실", "USB 링크 중단"이 아니라 "USB 연결 변화".

번역하지 않고 그대로 두는 식별자: `FS 1K` `HS 8K` `Full Speed` `High Speed` `p50/p95/p99`
`EEPROM` `RAM`. 복사된 보고서·비교표·펌웨어 문서가 부르는 이름과 같아야 한다. `enumerate`는
고급 비교표의 접힌 해설에만 남는다 — 거기서는 정확한 단어이고, 펼친 사람은 정밀함을 원한다.

2열 배치가 이미 주어를 제공하므로 값은 문장이 아니라 조각이면 된다
("이 테스트에서는 관측되지 않았습니다" → "관측되지 않음"). 관측 범위 제약은 값이 아니라
**행 이름과 그 위 제목**이 진다 — `이 30초 테스트가 관측한 것` 아래의
`키 입력 유실 / 관측되지 않음`은 이미 이 테스트가 본 것에 한정된 서술이다.

밀도 높은 데이터 패널은 상속이 아니라 명시된 스케일이 필요하다. 지정하지 않으면 VIA 메뉴 행
크기를 상속받아 카드에서 가장 덜 중요한 줄이 가장 큰 글자가 된다.

```
18  섹션 제목
16  요약 부제
15  섹션 본문 · 패널 제목 · 요약 답변 행
14  지표 라벨/값 · 탭 · 안내 문구
13  보조 문구 · disclosure 본문 · 비교표 · 히스토그램
```

버튼과 select는 VIA의 20 px 메뉴 행 기준(40 px 높이)이 아니라 이 블록 기준(36 px)을 쓴다.

이름은 계측 대상이 아니라 **자기가 앉아 있는 설정**을 따른다. `USB Delivery Diagnostics`가
아니라 `USB Polling Diagnostics`다. 블록이 `USB POLLING` submenu 안에 있고 답하는 질문도
"이 폴링 모드가 어떤가"이기 때문이다.

## 5. 로케일

지원 6개 로케일(`de en es ja ko zh`)에 전부 키를 넣는다. 키는 앱의 기존 관례대로 영어
원문이므로 번역이 없으면 읽을 수 있는 영어로 degrade한다 — 그래서 **조용히** 깨진다.

- **번역은 문구 확정 이후에 한다.** 순서를 반대로 하면 모호한 문장을 6개 언어로 번역한 뒤
  다시 6번 고쳐야 한다.
- **`Copy Diagnostic Report` 본문은 영어로 남긴다.** 이 텍스트는 유지보수자에게 붙여넣는
  버그 리포트다. 사용자의 언어로 번역되면 받는 쪽이 읽지 못한다.
- **`t()`는 세션 콜백에서 ref로 참조한다.** 의존성 배열에 넣으면 언어를 바꿀 때
  `finishActive`의 identity가 바뀌고, 그것에 의존하는 정리 effect가 **실행 중인 측정을
  중단시킨다.**
- 키 파리티 검사는 문구 변경을 잡지 못한다 — 여섯 파일이 똑같이 그 키를 갖고 있지 않을 뿐
  파리티는 유지되기 때문이다. 그래서 `era-feature-help.ts`가 `eraHelpStrings()`로 번역 대상
  전체를 노출하고 `tests/locales.test.ts`가 그 목록의 모든 문자열이 6개 카탈로그에 키로
  존재하는지 검사한다. 목록을 테스트가 소스에서 직접 읽으므로 두 곳이 어긋날 수 없다.

## 6. ERA 메뉴 설명 16개

`src/utils/era-feature-help.ts`가 표를 갖고
`src/components/panes/configure-panes/custom/feature-help.tsx`가 submenu 항목 위에
한 줄 요약 + 접힌 상세로 렌더링한다.

**키는 메뉴 label이 아니라 command id로 잡는다.** label은 자유 문구라 일반 VIA 정의도
`TAPPING`이라는 메뉴를 가질 수 있지만 `id_qmk_tapping_*`은 ERA 펌웨어에만 있다. 구현이 다른
남의 키보드가 ERA 기능 설명을 가져가는 일이 없다. 진단 블록이 쓰는 게이트와 같은 원리다.

내용 출처는 펌웨어 저장소의 사용자 안내지만 그대로 옮기지 않고 다시 썼다. 안내문은
"VIA CONFIGURE → FEATURE → DEBOUNCE에서 조정합니다"처럼 경로를 알려주는데, 이 텍스트를 읽는
사람은 **이미 그 화면에 있다.** 남는 것은 그 설정이 무엇을 하는지와 값을 어느 방향으로
움직여야 하는지뿐이다.

문장의 성격을 계약으로 고정한다.

- **요약은 설정을 부르는 이름이지 설명이 아니다.** `Puts the keyboard into bootloader mode
  so you can flash firmware.`가 아니라 `Enters the bootloader when switched on.`이다.
  일부만 바꾸면 나머지가 더 장황해 보이므로 16개 전부가 같은 형태여야 한다.
- **상세는 켜고 끈 결과까지만 쓴다.** 원리 설명은 걷어낸다.
- 요약은 **12단어 이하, 2인칭 없음, 6개 언어 전부에서 한 문장.** 독자를 부르는 것은 상세의
  몫이다. `tests/locales.test.ts`가 이 셋을 검사하며, 실제로 일본어 USB POLLING 요약이 두
  문장으로 남아 있던 것을 잡아냈다. 눈으로 훑어서는 놓칠 종류의 불일치다.
- 상세에는 단어 수 상한을 걸지 않는다. 길이가 아니라 형태가 결을 만든다.

**한 기능이 계열마다 다른 command 이름을 쓸 수 있다.** SOCD는 RP2040이 `id_qmk_socd_*`,
H7S가 `id_qmk_kill_switch_*`다. 한쪽만 등록해 25종에서 설명이 통째로 빠져 있었고 아무것도
실패하지 않았다 — "모든 ERA submenu가 실제로 help로 해석되는가"를 묻는 테스트가 없었기
때문이다. `tests/era-definition.test.ts`가 지금 그것을 묻고, 설명이 없어도 되는 submenu는
`SUBMENUS_WITHOUT_HELP`에 이름을 남겨야 통과한다(현재 `Backlight` 하나).

## 7. 컨트롤 단위 ⓘ

submenu 상단 ⓘ 하나로는 DEBOUNCE를 설명할 수 없다. 세 안 중 **답을 질문 옆에 두는** 안을
택했다: `Debounce Mode` 드롭다운의 ⓘ가 세 모드를 한자리에서 비교하고, 그 아래 `showIf`로
살아남은 ms 행의 ⓘ가 그 행만 설명한다.

- **(A) 상단 ⓘ 본문 확장 — 탈락.** 한 문단에 다섯 ms 항목과 세 모드를 모두 넣으면 독자가
  자기가 보고 있는 행에 해당하는 문장을 그 안에서 찾아내야 한다. TAPPING에서는 더 나쁘다 —
  토글 세 개가 각각 증상→처방 2~3문장을 요구하므로 한 문단이 여덟 문장이 된다.
- **(B) 모드별 조건부 상단 설명 — 탈락.** "내가 보고 있는 ms 항목의 의미"는 풀지만
  **"세 모드의 차이"는 풀지 못한다.** 아직 고르지 않은 모드의 설명이 화면에 없으면 비교가
  불가능하고, 모드를 고르는 순간이 바로 비교가 필요한 순간이다.

### 부착 기준

산발적으로 붙으면 "왜 이 항목만 설명이 있나"를 묻게 되므로 기준을 고정한다.

> **컨트롤 단위 ⓘ는 label이 "이 값을 어느 방향으로 움직여야 하는가"에 답하지 못할 때만
> 붙인다.**
>
> 붙인다: (a) 선택지가 고유명이라 이름이 동작을 설명하지 않는다
> (`Balanced`/`Fast`/`Advanced`, `Permissive Hold`, `Report Pulse`).
> (b) label이 사양을 서술할 뿐 결과를 말하지 않는다 —
> `Press & Release - delay before and after (same value)`는 펌웨어가 그 숫자로 무엇을 하는지
> 말하지만, 그 값을 올리면 모든 입력이 그만큼 늦게 인식된다는 사실은 말하지 않는다.
>
> 붙이지 않는다: 단위가 곧 답인 컨트롤(`Indicator Brightness`), 그리고 **상단 요약이 이미 그
> 컨트롤을 주어로 삼고 있는 컨트롤**(`Global Tapping Term (ms)`, KKUK의 `Enable`).
> 한 줄 아래에서 반복하면 소음이다.

그래서 TAPPING은 1행에 ⓘ가 없고 2~4행에 있다. 결함이 아니라 기준이 선별적으로 작동한
결과다. 반대로 MOUSE는 "단위가 답을 갖고 있다"로 판단해 하나도 붙이지 않았었는데 **틀렸다** —
단위는 얼마인지는 말하지만 무엇의 얼마인지는 말하지 않는다. `Cursor Acceleration`의 `1.0 s`는
가속에 걸리는 시간이고 `Cursor Steps Per Second`의 `100 /s`는 그 시간을 바꾸지 않는 별개
값이며, 포인터 속도 행은 가속이 켜졌는지에 따라 뜻이 달라진다. 기준 (b)에 정확히 해당한다.

### 키 잡는 법

키는 **정확한 command 이름**으로 잡는다(submenu 게이트와 같은 원리, 더 좁다).
같은 command id가 서로 다른 뜻으로 두 번 나타나면 **label까지 함께 맞춘다.**

- `id_qmk_debounce_time_post`는 Fast의 `Press & Release - delay after change (post-only)`와
  Advanced의 `Release - delay before and after release (pre+post window)`가 공유하고
  **모드에 따라 뜻이 다르다.** H7S의 서술형 label과 RP2040의 축약형 label
  (`Press & Release Cooldown` / `Release Delay`)을 모두 등록한다.
- `id_qmk_mousekey_cursor_min_speed`도 `Cursor Speed`(가속 Off)와 `Cursor Start Speed`
  (가속 On) 두 행이 공유한다.
- label이 어느 쪽과도 안 맞으면 **아무것도 렌더링하지 않는다.** 디바운스 창의 반대쪽을
  설명하는 문구가 뜨는 것보다 없는 편이 낫다.
- TAPDANCE는 같은 다섯 컨트롤이 슬롯 8개에 반복되므로 정확 일치로는 40개 항목이 필요하다.
  `commandPrefix`(`id_qmk_tapdance_`) + 행 label 조합으로 4개 항목이 슬롯 전부를 덮는다.

### 구현 계약

`Explain`은 버튼과 본문을 인접하게 렌더링하므로 `ControlRow`(label 왼쪽 / Detail 오른쪽)에
그대로 넣을 수 없다. 본문을 `Detail` 앞에 두면 wrap 시 컨트롤이 3번째 줄로 밀린다.
`explain.tsx`가 `useExplainDisclosure()` 훅과 `ExplainBody`를 분리 노출해 호출자가 버튼과
본문을 따로 배치한다.

**접힌 본문은 DOM에 남고 `hidden`으로만 감춘다.** 브라우저 찾기와 보조기술이 여전히 도달할
수 있고, §3 문구를 검사하는 테스트가 그대로 유효하기 때문이다. 훅은 `open`을 밖으로 내보내지
않고 이미 해석된 `hidden`만 `bodyProps`로 넘기므로 호출자가 `{open && <Body/>}`를
**쓸 수가 없다.** 접힘 계약을 문서가 아니라 타입이 지킨다.

도움말이 있는 행만 `flex-wrap: wrap` 변형(`HelpfulControlRow`)을 쓰고 label과 버튼을
`LabelGroup`으로 묶는다. 없는 행은 기존 2열 `ControlRow` 그대로다. `aria-label`은
`What this means: {{name}}`로 컨트롤 이름을 담아, 한 화면의 여러 ⓘ를 보조기술이 같은
이름으로 반복해 읽지 않게 한다.

## 8. 이름은 동작을 따른다

### `Anti-Ghosting` → `KKUK`

기존 이름은 기능을 잘못 서술하고 있었다. 사실 확인 두 가지:

1. `eerraa-qmk-h7s-fw-via2/src/ap/modules/qmk/port/kkuk.c`에 `matrix`/`scan`/`row`/`col`
   문자열이 **0건**이다. 호출하는 것은 `keyboard_report`, `clear_keys()`,
   `send_keyboard_report()`, `millis()`, `IS_BASIC_KEYCODE`, `kill_switch_is_use`뿐이다.
   매트릭스와 키맵이 이미 해석을 끝낸 **HID 리포트 계층**에서만 동작한다.
2. H7S 5개 보드 어디에도 `MATRIX_HAS_GHOST`가 정의되어 있지 않다. 스위치마다 다이오드가
   있어 매트릭스 고스팅이 물리적으로 발생하지 않는다.

즉 고스팅 방지가 아니다. 실제 동작은 두 키 이상을 누른 채 `delay_time`이 지나면
`repeat_time`마다 묶음 전체를 뗀 리포트를 보내고 곧바로 원래 리포트를 복원하는 것이다 —
`asd`를 누르고 있으면 OS 자동 반복의 `asddddd`가 아니라 `asdasdasd`가 들어간다.

`KKUK`을 고른 이유는 펌웨어 식별자가 이미 `kkuk.c`, `KKUK_ENABLE`, `id_qmk_kkuk_*`이어서
**코드·JSON·문서·앱이 한 단어로 수렴**하기 때문이다. `HOLD CYCLE`은 서술적이지만 레이어/홀드
순환으로 오독될 여지가 있고 펌웨어 내부 이름과 계속 어긋난다. `REPEAT PULSE`는 옵션 이름과는
맞지만 일반 사용자에게 "펄스"가 기술적이다.

라벨 자체는 영어 `KKUK` 하나이므로 공식 `usevia.app`에서도 같은 이름이 보인다. 인식의 부담은
요약의 `asdasdasd` 예시가 혼자 진다 — 예시는 언어와 무관하게 읽히고 추상적 서술보다 짧다.
한국 통칭("꾹보드")은 앱에서 전부 걷어냈다. 영어 문자열이 6개 언어의 번역 키이므로 한국어
통칭을 키에 넣으면 독일어·스페인어 독자에게 의미 없는 고유명사가 그대로 실린다.

### `Indicator Priority` → `Indicator Only`

"우선순위"는 무엇보다 우선하는지 말하지 않는다. 실제 동작은 뱃지가 RGB 효과를 표현하지 않고
**인디케이터로만 동작**하는 것이므로 `Indicator Only`가 그대로 동작 이름이고, 같은 메뉴의
`Badge-Only RGB`와 짝을 이룬다. 대상은 스플릿 3종(`tomak`, `tomak79h`, `tomak79s`)의 좌우
정의 6개뿐이다. H7S에는 Badge Lighting 메뉴 자체가 없다.

### 이름은 세 저장소에 동시에 바꾼다

라벨만 바꾸고 앱과 매뉴얼이 서로 다른 이름을 쓰면 오해를 줄이려다 더 큰 혼란을 만든다.
`docs/PROJECT_DIRECTION.md`의 "커스텀 앱만 말할 수 있는 경로는 오류다"와 같은 기준이다.

라벨은 JSON에만 있으므로 **채널·value id·EEPROM 배치·펌웨어 코드는 어느 저장소에서도
바뀌지 않는다.** 재빌드나 펌웨어 버전 상승이 필요 없고, 이미 플래시된 키보드도 새 JSON만
불러오면 새 이름으로 보인다.

메뉴가 있는 정의는 계열마다 다르므로 "세 저장소 모두 적용"의 실제 대상도 항목마다 다르다.
계열별 분포는 `tests/era-definition.test.ts`의 `FEATURE_COVERAGE`가 정본이다.

## 9. 없는 기능에 토글을 만들지 않는다

H7S 5종에 MOUSE 메뉴를 채널 17로 추가했다. 펌웨어는 마우스 키 설정을 이미 지원하는데 앱
정의에 메뉴가 없어 **펌웨어가 가진 기능에 접근할 방법이 없었다.** 누락이 의도가 아니었다는
증거는 펌웨어 저장소 안에 있었다 — 노출 표와 사용자 안내가 둘 다 없는 화면을 가리키고 있었다.
공식 VIA JSON 5개에도 같은 블록을 넣었다(사용자 승인). 앱 정의만 고치면 커스텀 앱에서만
MOUSE가 보이고 공식 `usevia.app`에서는 보이지 않으며, 그것은 §"커스텀 앱만 말할 수 있는
경로는 오류다"에 걸린다.

**NKRO는 H7S에 넣지 않는다.** 그 키보드는 전환 없이 항상 20키 동시 입력이고 켜고 끄는 옵션
자체가 없다. 토글을 만들면 없는 선택지를 있는 것처럼 보이게 하는 거짓말이 된다.
`tests/era-definition.test.ts`가 H7S 5종에 `id_qmk_custom_nkro`가 없는지 검사한다.

## 10. Verification

자동 검사는 `tests/diagnostics-pane.test.tsx`(요약/전체 뷰 문구와 §3 안전장치),
`tests/custom-menu-pane.test.tsx`(배치·opt-in gate·메뉴 설명·컨트롤 단위 ⓘ),
`tests/locales.test.ts`(번역 존재, 판정 표현, 요약의 결),
`tests/era-definition.test.ts`(설명 커버리지, MOUSE 채널, NKRO 부재)가 담당한다.

코드만으로 판정할 수 없어 실기가 필요한 것:

1. `USB POLLING`의 `Apply Selected Mode` 아래에 진단 블록이 바로 보이고, 상단 아이콘 바에
   Diagnostics 아이콘이 없다.
2. H7S가 아닌 키보드와 official/upload로 열린 H7S에서는 블록이 없고 selector `0x07` packet이
   나가지 않는다.
3. 30초 test 중 polling mode dropdown을 건드리지 않으면 완주하고, 다른 submenu로 이동하면
   `aborted`로 저장되어 `Show It`으로 복구된다.
4. 같은 mode·같은 boot에서 이전 배치와 새 배치의 `loop max`, `stall count`, `queue peak`를
   비교해 State Sync poll 동시 실행의 영향 크기를 기록한다(§1).
5. Advanced를 켰을 때 비교표의 `Spread`/`Queue` 열과 `speed mismatch` 표시가 보인다.
6. 언어를 ko/ja/zh/de/es로 바꿔 요약 뷰와 상황 카드가 잘리거나 겹치지 않는지 본다.
   독일어가 가장 길어 2열 정의 목록의 왼쪽 열 폭에서 먼저 문제가 드러난다.
7. 스크롤 없이 요약 카드 전체가 보이고, ⓘ를 열었을 때 카드가 밀리기만 하고 잘리지 않는다.
8. 고급 탭 네 개가 각각 한 화면에 들어오고 전환 시 차트가 깜빡이지 않는다.
9. §4의 타입 스케일이 실제로 위계로 읽힌다. `State: …` 줄이 답변 행보다 작아야 하고 요약
   부제가 패널 제목보다 크면 안 된다.
10. FEATURE·TAPDANCE·SYSTEM·Lighting의 각 submenu 위에 한 줄 요약이 뜨고, 일반 VIA
    키보드에서는 그 줄이 없다.
11. `DEBOUNCE`에서 모드를 바꿀 때 ms 행과 각 행의 ⓘ 본문이 함께 바뀐다. 특히 Fast의 ms 행과
    Advanced의 Release 행이 **서로 다른 문구**여야 한다(같은 command id다).
12. `MOUSE`가 H7S 5종에서 보이고 값을 읽고 쓸 수 있으며 재연결 후에도 유지된다.
    `Cursor Acceleration`을 Off로 바꾸면 `Cursor Speed` 한 줄, 다른 값이면
    `Cursor Start/Top Speed` 두 줄이 된다.
