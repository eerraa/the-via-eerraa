# ERA VIA Fork 배포 운영 문서

> 이 문서는 공개 정적 호스팅 운영 계약을 기록한다. 장기 아키텍처 결정은
> `docs/PROJECT_DIRECTION.md`, 세션 상태는 외부 handover가 담당한다.

## 1. 호스팅 결정

**Cloudflare Pages Direct Upload**를 사용한다. `.github/workflows/deploy-to-cloudflare.yml`이
유일한 배포 경로다.

근거:

- 앱은 backend가 없는 정적 Vite SPA다. 서버 런타임이 필요 없다.
- 런타임 코드가 `/definitions/...`, `/fonts/...` 같은 **절대 경로**를 사용한다
  (`src/utils/device-store.ts`, `src/utils/era-advanced-metadata.ts`). 따라서 사이트는
  **origin 루트**에서 제공되어야 한다. GitHub Pages project page(`/{repo}/` 하위 경로)는
  이 절대 경로를 깨뜨리므로, 선택하려면 base 경로 처리 소스 변경이 필요하다. 그 변경은
  릴리스 목적에 비해 회귀 위험이 크다.
- WebHID는 secure context를 요구한다. `*.pages.dev`는 HTTPS를 기본 제공한다.
- 빌드 산출물은 3,577개 파일 / 44 MB로 Cloudflare Pages 제한(배포당 20,000개 파일,
  파일당 25 MiB) 안에 충분히 들어간다.
- 비용: Cloudflare Pages 무료 플랜으로 충분하다. 무료 플랜 제한은 배포당 20,000개
  파일, 파일당 25 MiB, 월 500회 빌드, 동시 빌드 1개, 프로젝트당 custom domain 100개다.
  이 저장소는 GitHub Actions에서 빌드하고 산출물만 올리는 Direct Upload 방식이므로
  Cloudflare 쪽 빌드 파이프라인을 돌리지 않는다.

### 중복 배포 금지

Cloudflare Pages의 **Git integration을 이 저장소에 연결하지 않는다.** 연결하면 같은
커밋을 GitHub Actions와 Cloudflare가 각각 빌드해 production alias를 두고 경쟁한다.
Direct Upload 단일 경로를 유지한다.

## 2. 사용자만 수행할 수 있는 외부 설정

에이전트는 아래를 대신 수행하지 않는다. 모두 완료되기 전까지 deploy job은
`if: vars.CLOUDFLARE_PROJECT_NAME != ''` 조건에서 **skip**되므로 push마다 실패가 쌓이지 않는다.

확정된 프로젝트명은 **`the-via`**이며 공개 호스트는 `https://the-via.pages.dev`가 된다.
`*.pages.dev` 서브도메인은 Cloudflare 전체에서 고유하므로 프로젝트명은 나중에 바꿀 수
없다. 바꾸려면 프로젝트를 새로 만들어야 한다.

| 항목 | 위치 | 값 |
| --- | --- | --- |
| Pages 프로젝트 생성 | Cloudflare 대시보드 → Workers & Pages → Create → Pages → Direct Upload | 프로젝트명 `the-via`, **production branch `main`** |
| `CLOUDFLARE_API_TOKEN` | GitHub repo → Settings → Secrets and variables → Actions → **Secrets** | Cloudflare API 토큰. 권한은 `Account / Cloudflare Pages / Edit` 하나면 충분하다 |
| `CLOUDFLARE_ACCOUNT_ID` | 같은 화면의 **Secrets** | Cloudflare 계정 ID |
| `CLOUDFLARE_PROJECT_NAME` | 같은 화면의 **Variables** | `the-via`. 이 값이 비어 있는 동안 deploy job은 skip된다 |

토큰은 저장소 파일이나 로그에 남기지 않는다. 값 입력은 GitHub 웹 UI에서 직접 한다.

**production branch가 `main`이어야 한다.** Cloudflare Pages는 배포에 붙은 branch 이름이
프로젝트의 production branch와 같을 때만 production 배포로 처리하고, 그때만
`the-via.pages.dev` alias가 갱신된다. 워크플로는 `--branch=${{ github.ref_name }}`를
넘기므로 `main` push는 production, 다른 branch의 수동 실행은 preview가 된다. 프로젝트
생성 시 production branch가 `main`이 아니면 Settings → Builds & deployments에서 고친다.
잘못 설정하면 배포는 성공하지만 `the-via.pages.dev`는 404로 남는다.

Custom domain, DNS 변경, 유료 플랜은 이 문서 범위 밖이며 별도 승인 대상이다.

### 이름에 대한 참고

`the-via`는 upstream VIA의 GitHub organization 이름과 같다. 이 저장소는
`the-via/app`의 비공식 fork이므로, 공개 호스트명만 보고 공식 프로젝트로 오해할 여지가
있다. 사용자가 이 이름을 선택했고 앱 자체는 upstream VIA의 표기를 유지하므로 그대로
진행하되, 오해를 줄이려면 README나 앱 안내 문구에 비공식 fork임을 명시하는 편이 좋다.

## 3. 재현 가능한 빌드

```powershell
bun install --frozen-lockfile
bun run build
```

- 의존성은 `bun.lock`으로 고정된다. 공식 정의는 git SHA로 핀된
  `via-keyboards@github:the-via/keyboards#79ae8d2`(+ `patches/via-keyboards-windows-paths.patch`)
  스냅샷이며, 빌드 시점에 원격을 조회하지 않는다.
- 동일 입력으로 두 번 clean build한 결과는 3,573개 파일 중 3,572개가 **바이트 동일**하다.
  유일한 차이는 `definitions/supported_kbs.json`의 `generatedAt` 타임스탬프다. 이 필드는
  `scripts/build-keyboards.ts`가 콘텐츠 해시(`definitions/hash.json`)를 계산할 때 의도적으로
  제외하므로, 앱의 캐시 무효화 동작에는 영향이 없다. 실제로 `hash.json`과 `index.html`의
  `data-hash`는 재빌드 후에도 동일했다.
- CI는 `actions/setup-node@v4`(Node 22)와 `oven-sh/setup-bun@v2`로 런타임을 고정한다.
  `bun run build:kbs`가 `node --import tsx`를 사용하므로 Node 고정이 필요하다.

## 4. 정적 라우팅 계약

`public/_redirects`, `public/_headers`, `public/404.html`이 이 계약을 구현한다.

**wildcard SPA fallback(`/* /index.html 200`)을 사용하지 않는다.** Cloudflare Pages는
최상위 `404.html`이 **없으면** 매칭되지 않는 모든 경로를 `index.html`로 응답하는 SPA 모드로
동작한다. 이 앱에서는 그 동작이 버그를 만든다.

- `src/utils/device-store.ts`의 `fetchDefinitionJson()`은 `response.ok`로 정의 부재를 판정한다.
- `src/store/definitionsSlice.ts`의 `reloadDefinitions()`는 연결된 **모든** 장치에 대해
  `/definitions/{v2|v3}/{vpid}.json`을 조회한다. 번들 정의가 없는 일반 키보드도 포함된다.
- blanket fallback 상태에서는 그 조회가 HTML을 200으로 돌려주고 `response.json()`이 예외를
  던져, Design 업로드로만 지원되는 키보드가 불필요한 오류로 기록된다.

따라서 `404.html`을 두어 암묵적 SPA 모드를 끄고, 앱의 실제 라우트만 명시적으로 rewrite한다.
라우트 목록의 canonical source는 `src/utils/pane-config.tsx`와
`src/components/panes/errors.tsx`다. 라우트를 추가하면 `public/_redirects`도 갱신해야 한다.

`_headers`는 `X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`와 캐시 정책만 설정한다.

- `Content-Security-Policy`는 설정하지 않는다. `src/utils/macro-api/*`가 매크로 파싱에
  `eval`을 사용해 `unsafe-eval`이 필요하고, styled-components와 three.js의 blob worker까지
  포함한 정책은 실제 브라우저 검증 없이 적용하면 기능을 조용히 깨뜨린다. 적용하려면 별도
  검증 후 진행한다.
- `Permissions-Policy`도 설정하지 않는다. `hid`의 기본 allowlist가 이미 `self`이므로
  same-origin 앱에는 이득이 없고, 값이 잘못되면 앱의 핵심 기능인 WebHID가 차단된다.
- `/definitions/*`는 vpid로 주소가 정해지고 콘텐츠 해시가 파일명에 없으므로
  `max-age=0, must-revalidate`를 유지한다. 장기 캐시는 배포 후 stale 정의를 만든다.
- `/assets/*`만 Vite content hash 기반이므로 `immutable` 장기 캐시를 적용한다.

## 5. 배포 전 검증

`deploy-to-cloudflare.yml`의 `Verify build output` 단계가 배포 직전에 다음을 강제한다.

- `index.html`, `404.html`, `_redirects`, `_headers`, `supported_kbs.json`, `era_advanced.json` 존재
- `dist/definitions/era/v3` 파일 수 == `era-definitions/custom/v3` canonical source 수
- `dist/definitions/v3` 파일 수 == 설치된 `via-keyboards` 스냅샷 수 (공식 정의 보존)
- 총 파일 수 < 20,000 (Cloudflare Pages 제한)

이 조건이 깨지면 업로드가 일어나지 않는다.

## 6. 롤백

Cloudflare Pages는 배포 이력을 보관하며 이전 배포를 production으로 되돌릴 수 있다.

1. **즉시 롤백(권장):** Cloudflare 대시보드 → 프로젝트 → Deployments → 직전 정상 배포 →
   *Rollback to this deployment*. 재빌드가 없어 가장 빠르고, 소스 저장소를 건드리지 않는다.
2. **소스 롤백:** `main`에서 문제 커밋을 `git revert`하고 push하면 워크플로가 새 배포를 만든다.
   히스토리를 다시 쓰지 않는다(force push 금지).
3. **배포 중단:** GitHub repo variable `CLOUDFLARE_PROJECT_NAME`을 비우면 이후 push가
   배포를 만들지 않는다. 이미 공개된 배포는 그대로 남으므로, 공개 자체를 내리려면
   Cloudflare에서 배포를 삭제하거나 프로젝트를 삭제해야 한다.

각 배포는 커밋 단위로 고유 preview URL을 가지므로, production alias를 바꾸기 전에 해당
URL에서 먼저 확인할 수 있다.

## 7. 남은 위험

- **실기기 검증은 배포로 대체되지 않는다.** WebHID 연결, EEPROM 지속성, split peer 수렴,
  Tap Dance/exact-ms 실동작은 실제 키보드와 사용자의 브라우저 권한이 있어야 확인된다.
- **브라우저 지원.** WebHID는 Chromium 계열(Chrome/Edge)에서만 동작한다. Firefox/Safari
  사용자는 앱이 열리지만 키보드를 연결할 수 없다. 이는 upstream VIA와 동일한 제약이다.
- **외부 요청.** `index.html`이 Google Fonts(`fonts.googleapis.com`, `fonts.gstatic.com`)를
  로드한다. 방문자 IP가 Google에 노출된다. 완전 자체 호스팅을 원하면 별도 작업이 필요하다.
- **`src/utils/github.ts`는 현재 앱에서 호출되지 않는 upstream 잔재**이며 redirect URI가
  `usevia.app`을 가리킨다. UI에 연결되어 있지 않아 배포 영향은 없다.
- **정의 drift.** 원격 firmware verifier를 제거했으므로, firmware wire/identity와 앱 custom
  JSON이 따로 바뀌면 일반 CI가 cross-repository drift를 자동 검출하지 않는다. 양쪽이 함께
  바뀌는 릴리스에서는 로컬 compatibility audit가 필요하다.
- **공개 범위.** `public/robots.txt`는 전체 크롤링을 허용한다. 검색 노출을 원하지 않으면
  배포 전에 변경해야 한다.
