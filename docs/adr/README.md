# Architecture decision records

프로토콜 호환성, 영속 데이터, 저장소 간 책임, 배포, 라이선스처럼 **다음 작업이 반드시
보존해야 하는** 결정만 여기 남긴다. 브랜치 상태, 프로세스 ID, 통상적인 구현 세부, 결정이
없는 후보 나열은 ADR이 아니다.

| # | 결정 |
| --- | --- |
| [0001](0001-state-sync-protocol.md) | State Sync revision validation (selector `0x06`) |
| [0002](0002-h7s-usb-diagnostics.md) | H7S USB 전달 진단 계약 (selector `0x07`) |
| [0003](0003-era-menu-help-ui.md) | ERA 메뉴 설명과 진단 화면 UI |

## 형식

```text
# NNNN — 결정 제목
Status: Proposed | Accepted | Superseded

## Context     어떤 검증된 제약이나 실패가 결정을 요구했는가
## Decision    무엇을 고르고 그 경계는 어디인가
## Consequences 무엇이 쉬워지고 어려워지고 미뤄지는가
## Verification 무엇이 이 결정을 검증하거나 반증하는가
```

## 두 가지 규칙

**뒤집힌 결정은 지운다.** "이 판단은 아래 절에서 뒤집혔다"는 주석을 손으로 달지 않는다.
현재 유효한 결정만 남기고, 뒤집힌 내용은 `git log`가 갖는다. 단 **뒤집힌 이유가 지금 규칙의
근거인 경우에는 그 이유만 현재 결정 안에 남긴다** — 예를 들어 "최상위 탭은 발견성에서
실패했다"는 인라인 배치가 왜 계약인지를 설명하므로 남고, 최상위 탭의 명세는 사라진다.

**제약에는 원인을 붙인다.** 규칙만 남고 원인이 사라지면 다음 사람이 규칙을 우회할 명분을
갖는다. 커밋은 변경 단위이고 제약은 계약 단위라서 `git log`가 이것을 대신하지 못한다.
`docs/adr/0003-era-menu-help-ui.md` §3이 그 형태의 예다.

받아들여진 ADR이 제품 방향의 일부가 되면 `docs/PROJECT_DIRECTION.md`에서 링크한다.
