# ERA keyboard definitions

이 디렉터리는 ERA VIA fork가 배포하는 VIA V3 keyboard definition의 source of truth다.

## 기존 keyboard 수정

해당 keyboard의 JSON을 `era-definitions/v3` 아래에서 직접 수정한 후 다음 명령을 실행한다.

```powershell
bun run build:kbs
bun run build
```

`public/definitions`와 `dist`는 생성 결과이므로 직접 수정하거나 commit하지 않는다.

## 새 keyboard 추가

1. `era-definitions/v3/<keyboard>/`에 VIA V3 JSON을 추가한다.
2. `config/era-definitions.lock.json`의 `definitions`에 local JSON 경로, VID/PID, firmware source와 identity check를 추가한다.
3. split Left/Right처럼 한 쌍인 definition은 동일한 `pair` 값을 사용한다.
4. `bun run verify:firmware-contracts`로 firmware VID/PID 계약을 확인한다.
5. `bun run build`와 실제 keyboard 자동 인식 테스트를 수행한다.

## Source policy

- 이 디렉터리의 JSON이 configurator definition의 canonical source다.
- firmware C/config 파일은 실제 USB identity와 protocol 구현의 canonical source다.
- firmware repository에 남아 있는 JSON 사본을 별도로 수동 편집하지 않는다.
- `config/era-definitions.lock.json`의 firmware commit은 계약 검증에만 사용하며 일반 definition build의 입력이 아니다.
