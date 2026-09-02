# ERA VIA Fork — public static hosting

Genre: manual
Canonical for: public static hosting — why Cloudflare Pages Direct Upload, the
operator-only GitHub and Cloudflare settings, the SPA rewrite contract, and what
a release must satisfy before upload

> How the public static host is run. Product direction is
> `docs/PROJECT_DIRECTION.md`. Where a fact lives is `docs/MAP.md`. Inventory
> counts, `hash.json` platform behaviour, and the route↔rewrite seam are MAP
> §4, §5, and §7 — this file does not restate them.

Re-measured from this repository: `.github/workflows/deploy-to-cloudflare.yml`,
`public/_redirects`, `public/_headers`, `public/404.html`, `public/robots.txt`,
`.gitattributes`, `vite.config.ts`, `index.html`, `src/utils/device-store.ts`,
`src/store/definitionsSlice.ts`, `src/utils/era-advanced-metadata.ts`,
`src/utils/pane-config.ts`, `src/components/panes/errors.tsx`, `src/Routes.tsx`,
`src/utils/macro-api/macro-api.ts`, `src/utils/github.ts`,
`public/github_oauth.html`. There is no `wrangler.toml`, `wrangler.json`, or
Cloudflare Pages Git-build config in this tree. The production alias is
<https://the-via.pages.dev>.

## 1. Host

The only deploy path is `.github/workflows/deploy-to-cloudflare.yml`: GitHub
Actions builds, then Direct Upload of `dist/` via
`cloudflare/wrangler-action@v3` (`pages deploy dist`). Triggers are push to
`main` and `workflow_dispatch`. Concurrency group `cloudflare-pages-${{ github.ref }}`
does not cancel an in-flight run.

This app is a static Vite SPA. `vite.config.ts` has no `base`; runtime fetches
are origin-root absolute (`/definitions/...` in `src/utils/device-store.ts` and
`src/utils/era-advanced-metadata.ts`). The site must be served from the origin
root. WebHID requires a secure context; `*.pages.dev` is HTTPS.

> **REFUSED:** GitHub Pages project-page hosting under `/{repo}/`, or any other
> non-root `base`.
> **WHY:** origin-root absolute fetches would 404 under a subpath, and adding
> `base` plus path rewriting is a release-sized change to every definition
> lookup.
> **REOPENS:** a measured need to leave origin-root hosting, with the fetch
> URLs and Vite `base` changed together and re-verified.

> **REFUSED:** connecting Cloudflare Pages Git integration to this repository.
> **WHY:** Git integration plus this workflow would build the same commit twice
> and race for the production alias. Direct Upload is the single path
> (workflow header comment).
> **REOPENS:** never, while this workflow remains the uploader.

The workflow encodes a 20,000-file ceiling (Cloudflare Pages per-deploy limit)
and blocks upload on overflow. Direct Upload does not run Cloudflare's build
pipeline; file-count is the limit this repository checks. Do not copy other
plan quotas into this file — they are not in the workflow.

The root `README.md` is upstream VIA and still describes Azure Static Web Apps.
That is not this fork's host. Do not edit it.

## 2. Operator-only settings

The agent does not create tokens, set repository secrets, or change DNS. Until
all three values exist, the deploy job is skipped
(`if: ${{ vars.CLOUDFLARE_PROJECT_NAME != '' }}`), so an unconfigured fork does
not accumulate failing runs on every `main` push.

| Name | Where | Role |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions **secret** | Token with Cloudflare Pages: Edit (workflow header comment) |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions **secret** | Cloudflare account id |
| `CLOUDFLARE_PROJECT_NAME` | GitHub Actions **variable** | Pages project name and `*.pages.dev` label. Empty → job skipped |

The production alias in use is `the-via` → <https://the-via.pages.dev>. That
label is the project name; a rename is a new Pages project. Tokens stay out of
the tree and out of logs. Values are entered in the GitHub UI.

**The Pages project's production branch must be `main`.** Pages updates the
`*.pages.dev` production alias only when the deployment branch equals the
project's production branch. The workflow passes
`--branch=${{ github.ref_name }}`, so a `main` push is production and a
`workflow_dispatch` on another branch is preview. Project creation uses
`--production-branch=main`. If an existing project was created with another
production branch, uploads succeed and the production alias does not move.

`Ensure Pages project exists` runs
`wrangler pages project create … --production-branch=main` and tolerates
failure (the project already exists). A bad token or account id surfaces in
`Deploy`, not in that create step. Dashboard Direct Upload creation is not
required and can leave the wrong production branch — that is why create lives
in the workflow.

Custom domains, DNS, and paid plans are out of this file and need explicit
approval (`AGENTS.md` §5).

## 3. What a release owes

```powershell
bun install --frozen-lockfile
bun run build
```

Dependencies are pinned by `bun.lock`. Official definitions come from the
pinned `via-keyboards` snapshot in `package.json` (plus
`patches/via-keyboards-windows-paths.patch`); the build does not fetch
`the-via/keyboards` at deploy time. Reproducibility bounds — `generatedAt`
excluded from the content hash, `hash.json` varying by file-walk order across
platforms, `data-hash` on `index.html` matching `hash.json` inside one deploy —
are `docs/MAP.md` §7. Pipeline layout and the overlay/official counts a
release must preserve are MAP §4.

The deploy workflow pins Node 22 (`actions/setup-node@v4`) and Bun
(`oven-sh/setup-bun@v2`). Node is required because `bun run build:kbs` is
`node --import tsx scripts/build-keyboards.ts`.

`Verify build output` is the gate that must pass before upload. It requires:

- `dist/index.html`, `dist/404.html`, `dist/_redirects`, `dist/_headers`,
  `dist/definitions/supported_kbs.json`, `dist/definitions/era_advanced.json`
- `dist/definitions/era/v3` file count == `era-definitions/custom/v3` source
  count
- `dist/definitions/v3` file count == installed `via-keyboards` `v3` snapshot
  count + `era-definitions/external/v3` managed source count
- total files under `dist/` < 20,000

Mismatch does not upload. Then `Deploy` runs
`pages deploy dist --project-name=${{ vars.CLOUDFLARE_PROJECT_NAME }} --branch=${{ github.ref_name }}`.
There is no in-repo Wrangler config file; `_redirects`, `_headers`, and
`404.html` are copied from `public/` into `dist/` by the Vite build.

A release that also changes firmware wire or identity still needs a local
compatibility audit. CI does not catch cross-repository drift (`docs/MAP.md`
§8).

## 4. SPA rewrite contract

`public/_redirects`, `public/_headers`, and `public/404.html` implement the
host contract. `.gitattributes` forces LF on `_redirects` and `_headers`
because Pages (and Netlify) parse those files line by line, and
`core.autocrlf` would otherwise turn them into CRLF in a Windows worktree.

**Do not use a wildcard SPA fallback (`/* /index.html 200`).** Cloudflare
Pages, when a top-level `404.html` is absent, answers unmatched paths with
`index.html` (implicit SPA mode). That breaks definition loading:

- `fetchDefinitionJson()` in `src/utils/device-store.ts` treats `response.ok`
  as "definition present" and then `response.json()`.
- `reloadDefinitions()` in `src/store/definitionsSlice.ts` GETs
  `/definitions/v2/{vpid}.json` or `/definitions/v3/{vpid}.json` for
  authorized devices that do not already have that official definition in the
  store — including ordinary VIA keyboards with no bundled file.
- Under a blanket 200 HTML fallback those GETs parse as JSON, throw, and
  `reloadDefinitions` logs a fetch error for Design-upload-only boards.

`public/404.html` turns implicit SPA mode off. Only real app routes are
rewritten. Route canonicals are `src/utils/pane-config.ts` and
`src/components/panes/errors.tsx`; `_redirects` is hand-matched (`docs/MAP.md`
§7). Adding a route means updating `_redirects`.

`public/_redirects` rewrites each non-root pane path to `/` with `200`. `/`
needs no rewrite. `/diagnostics` is an in-app `Redirect` to `/` in
`src/Routes.tsx` and is **absent** from `_redirects`. In-app navigation works;
a cold deep link on the host 404s (MAP §7; inline placement is
[ADR 0003](adr/0003-era-menu-help-ui.md)).

> **REFUSED:** `/* /index.html 200`, or omitting `public/404.html`.
> **WHY:** missing `/definitions/**.json` would return 200 HTML, and
> `fetchDefinitionJson` would throw instead of returning null.
> **REOPENS:** the loader distinguishes HTML from JSON without relying on
> status codes, and that change is tested.

**Rewrite destination is `/`, not `/index.html`.** Pages canonicalises
`/index.html` to `/`, which downgrades a `200` rewrite to a `308` redirect to
`/`. Deep links then lose their path and land on Configure. The failure does
not reproduce on the local Vite dev server or a generic static file server.

> **REFUSED:** rewrite targets of `/index.html`.
> **WHY:** Pages turns that `200` rewrite into `308 Location: /`.
> **REOPENS:** never, while this host is Cloudflare Pages.

Judgment after a deploy (host or local `dist/`): listed app routes return 200
`text/html` with the request URL unchanged; unknown paths return 404;
`/definitions/supported_kbs.json` and `/definitions/era_advanced.json` return
200 JSON; a missing vpid JSON returns 404, not 200 HTML. If local `dist/`
passes and the host differs, the host config is wrong. Device, WebHID, Tap
Dance, exact-ms, and State Sync behaviour are not replaced by these checks.

## 5. Headers

`public/_headers` sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, and cache policy only:

| Path | Cache-Control |
| --- | --- |
| `/assets/*` | `public, max-age=31536000, immutable` (Vite content hashes) |
| `/fonts/*`, `/images/*` | `public, max-age=604800` |
| `/definitions/*`, `/`, `/index.html` | `public, max-age=0, must-revalidate` |

Definition JSON is addressed by vendor/product id, not a content hash. A long
cache after deploy serves a stale board definition. `/assets/*` is the only
tree whose file names carry the Vite hash.

`Content-Security-Policy` is unset. `src/utils/macro-api/macro-api.ts` (and
`macro-api.v11.ts`, `macro-api.common.ts`) builds regexes with `eval`, so a
policy needs `unsafe-eval`. A CSP that also covers styled-components and
three.js has not been browser-verified on this host.

`Permissions-Policy` is unset. The app's core path is WebHID; a wrong `hid`
allowlist would block it.

> **REFUSED:** adding CSP or Permissions-Policy without a browser pass that
> still connects a keyboard and parses macros.
> **WHY:** `eval` in the macro parser and WebHID are both load-bearing; a
> header-only change can fail silently.
> **REOPENS:** a verified policy on Chromium that leaves macro parse and
> `navigator.hid` working.

## 6. Rollback and halt

Cloudflare Pages keeps deployment history. Restoring a prior deployment to
production does not rebuild and does not change the git tree.

Source rollback is `git revert` on `main` and a push — the workflow emits a
new deployment. Do not force-push `main`.

Clearing the GitHub variable `CLOUDFLARE_PROJECT_NAME` skips later deploys.
It does not unpublish. Taking the site down means deleting deployments or the
Pages project in Cloudflare.

Each upload gets a per-commit preview URL. Confirm there before the
production alias moves.

## 7. Remaining host facts

- **WebHID is Chromium-only** (Chrome/Edge), same as upstream VIA. Firefox
  and Safari can load the static app and cannot connect a keyboard. A green
  static check is not a device check.
- **`index.html` loads Google Fonts** (`fonts.googleapis.com`,
  `fonts.gstatic.com`). Visitor IPs are sent to Google. Fully self-hosted
  fonts are a separate change; `public/fonts/` is a different, already-bundled
  family.
- **`src/utils/github.ts` is not imported.** Its non-localhost redirect URI is
  `usevia.app`. `public/github_oauth.html` still ships and POSTs to
  `/api/GithubOAuth`, which this static host does not serve. No deploy-time
  OAuth.
- **The project name `the-via` matches upstream VIA's GitHub organization.**
  This repository is an unofficial fork of `the-via/app`. The `*.pages.dev`
  label is not reversible without a new project (§2).
- **`public/robots.txt` allows all crawlers** (`User-agent: *` / empty
  `Disallow`). Closing that is a pre-deploy edit, not a host toggle.
