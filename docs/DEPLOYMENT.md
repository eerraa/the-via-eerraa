# ERA VIA Fork — public static hosting

Genre: manual
Canonical for: Cloudflare Pages release procedure, deploy authority, SPA rewrite
requirements, and response-header requirements

The executable deploy path is `.github/workflows/deploy-to-cloudflare.yml`.
Current route definitions live in `src/utils/pane-config.ts`,
`src/components/panes/errors.tsx` and `src/utils/firmware-route.ts`; host
rewrites and headers live in `public/_redirects`, `public/404.html`, and
`public/_headers`. This manual keeps the operational constraints and reasons
that are not useful to duplicate from those files.

## 1. Deployment path and authority

Cloudflare Pages Direct Upload from
`.github/workflows/deploy-to-cloudflare.yml` is the only deployment path.
Pushes to `main` are production candidates. Manual runs on another branch are
preview deployments because the workflow passes the current branch to Pages.

Do not also connect Cloudflare Pages Git integration to this repository. It
would create a second deploy path for the same commit and can race the
production alias.

The workflow is inert until `CLOUDFLARE_PROJECT_NAME` is set. Repository
configuration is operator-owned:

| Setting | Kind | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_PROJECT_NAME` | GitHub Actions variable | Pages project and `*.pages.dev` label |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | token with Cloudflare Pages edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | Cloudflare account id |

The Pages production branch must be `main`. The workflow creates a missing
project with that production branch before upload; the workflow itself owns the
exact command.

The public alias currently used by this fork is
<https://the-via.pages.dev>. Creating or renaming the Pages project, changing
the production branch, rotating credentials, changing GitHub secrets or
variables, adding a custom domain, or changing DNS requires explicit operator
approval. Repository edits do not grant those permissions.

For this static Pages site, the custom domain's CNAME points to that Pages
alias with **DNS Only** routing. Pages still provides HTTPS and its own CDN;
the domain does not need a second zone proxy and cache layer. Zone proxy
rules, WAF and HTTP analytics do not apply on this route. Re-enabling the
proxy requires a review of those settings and a live check of both current
downloads and removed-file 404s. Cloudflare's
[Pages debugging guide](https://developers.cloudflare.com/pages/configuration/debugging-pages/)
recommends DNS Only when a custom domain serves incorrectly while
`pages.dev` serves correctly.

## 2. Release and rollback procedure

A release candidate is built from the repository root with:

```powershell
bun install --frozen-lockfile
bun run build
```

Before upload, the workflow's `Verify build output` step must pass. That step
owns the exact required files, generated-definition count checks, and Pages
file-count ceiling; do not duplicate those inventories here.

For a production release, merge or push the intended commit to `main` and
let the workflow perform the Direct Upload. A release that changes firmware
wire behavior or identity also needs the paired compatibility review routed by
`docs/MAP.md` §8; an app build does not prove cross-repository compatibility.

Cloudflare Pages deployment history is the host rollback mechanism. A source
rollback is a normal `git revert` on `main` followed by the ordinary deploy
path; do not force-push `main`.

Clearing `CLOUDFLARE_PROJECT_NAME` stops later workflow deploys but does not
unpublish the current site. Deleting deployments or the Pages project is an
operator-side Cloudflare action and requires explicit approval.

## 3. SPA hosting contract

This Vite SPA must be served from the origin root. Runtime definition fetches
are origin-root relative, and WebHID requires a secure context.

`public/404.html` must remain present. Do not replace the explicit route
rewrites with a wildcard fallback such as `/* /index.html 200`. Missing
`/definitions/**.json` must stay a real 404; returning `index.html` with a
200 status makes definition probes look successful and then fail as JSON.

Only real application routes belong in `public/_redirects`. When a route is
added or removed, compare that file with `src/utils/pane-config.ts`,
`src/components/panes/errors.tsx` and `src/utils/firmware-route.ts`. The
`/diagnostics` path is intentionally an in-app redirect in `src/Routes.tsx`,
not a host deep-link rewrite.

Rewrite destinations are `/`, not `/index.html`. Cloudflare Pages
canonicalizes `/index.html` to `/`; using it as the rewrite target can turn
a route-preserving rewrite into a redirect that loses the requested path.
The firmware routes rewrite to `/firmware-app` or `/firmware-app-<maker>` for
the same reason, without `.html`: these are the build's copies of the shell with the firmware
link-preview head (docs/adr/0004-firmware-distribution.md §4).

A host check after deployment should establish all of the following without
claiming device validation:

- declared SPA deep links return the app without changing the requested URL;
- a firmware link such as `/firmware/sirind/brick60-h7s` returns the shell
  titled `SR Industry — Firmware`, still without changing the URL; every
  canonical maker list link must also expose its catalog display name in
  `og:title` to crawlers that run no JavaScript;
- an unknown path returns 404;
- known definition JSON returns JSON;
- a missing definition returns 404 rather than HTML.

These checks do not replace WebHID, device, State Sync, exact-ms, or Tap Dance
validation.

## 4. Header contract

`public/_headers` is the source of the exact header values. Preserve these
semantics:

- static Vite assets may be cached long-term because their filenames are
  content-hashed;
- definition JSON and the app entry document must revalidate because their
  stable URLs can change contents across releases;
- `X-Content-Type-Options`, frame denial, and the referrer policy remain part
  of the public-host baseline.

Do not add a Content Security Policy until it is browser-verified with macro
parsing: the macro implementation currently uses `eval`, so an apparently
strict policy can break a supported path.

Do not add a restrictive `Permissions-Policy` without a Chromium WebHID pass.
A wrong `hid` allowlist can block the product's core device connection path.

These two headers remain an explicit hardening gap rather than a license to
weaken the existing headers. Revisit them only with focused browser validation
of the affected behavior.

## 5. Related open host cleanup

The static-host GitHub OAuth remnants and other dead deployment-era surfaces are
cleanup debt owned by `docs/DEAD_CODE.md`. They are not alternate deployment
or authentication paths.

The upstream root `README.md` still describes its own hosting history. It is
not the deploy contract for this fork; this file and the workflow above own the
fork's public-host procedure.
