# ADR 0004 — Firmware distribution and maker USB identity

Status: Accepted
Genre: contract
Canonical for: the firmware download surface (entry point, maker → family →
file hierarchy, routes, access without WebHID), the maker VID block and PID
allocation policy, how the app resolves a connected keyboard to a maker
including legacy identities, and the VERSION update check

The app distributes released firmware ZIPs by keyboard maker, and a connected
keyboard leads straight to its own maker's files. Product identity and the
official-VIA boundary stay with `docs/PROJECT_DIRECTION.md`; VERSION
presentation stays with [ADR 0003](0003-era-menu-help-ui.md) §7.

## 1. Maker USB identity

Every ERA keyboard maker owns exactly one USB VID, taken from the ERA maker
block `0x4500`–`0x453F`. The next maker receives the next unused VID in the
block. The previously shared ERA VID `0x4552` becomes a legacy identity only.

Why: a board sold by several makers must tell the app which maker sold it, and
only the VID can carry that without a new wire command. The block was chosen
because no VID in it appears in the official VIA registry, the QMK keyboard
tree, or the public `usb.ids` list, so neither official `usevia.app` nor host
software can mistake an ERA build for another product, and it leaves room for
more makers. A maker's own stock VID was rejected for the same reason: its
existing PIDs would collide with ERA builds in the official registry.

Inside a maker VID, PIDs are a new sequence from `0x0001`, one number per
product. A split product with number `n` reports `0xA000 + n` on the left
half and `0xB000 + n` on the right. A board sold by several makers receives a
separate number under each maker, so the firmware repositories build one image
per maker; the images differ only in USB identity and manufacturer string. A
number is never reused, including after a product is retired. A product whose
maker is undecided receives no identity until the owner decides; a board that
ERA did not build keeps its existing identity and is not distributed.

The concrete maker, VID and PID inventory is not restated in documents
(`docs/MAP.md` §9). Firmware repositories remain authoritative for USB identity
(`docs/PROJECT_DIRECTION.md`), and `config/era-definitions.manifest.json`
mirrors it for the app.

## 2. Compatibility of the identity change

- Official VIA keeps working through the firmware-local official JSON in each
  release ZIP, loaded through Design, which the release already documents.
  What is lost is auto-detection for boards that the official registry lists
  under `0x4552`, until entries for the new identities are submitted upstream.
- The app keeps the legacy identities in the ERA overlay for a transition
  period, so keyboards still running old firmware configure as before. One
  canonical custom JSON serves every maker identity of the same board; additional
  identities are declared in the manifest and each emitted overlay carries the
  identity it is served under.
- A legacy identity is served by the definition that firmware shipped with,
  frozen under `era-definitions/legacy/v3` and bound in the manifest entry's
  `legacy` field. Why: firmware with maker identities is released together with
  changes the canonical definition follows (new Custom Value controls, renamed
  effect values), and older firmware answers an unknown value id with
  `id_unhandled`, which fails the whole menu read. The identity is the only
  signal that tells the builds apart without a new wire command. The frozen tree
  is not a second canonical source: it is never edited, and it is removed
  together with the legacy identities when the transition ends.
- A browser grants WebHID access per VID/PID, so after flashing a build with a
  new identity the user authorizes the keyboard once more. The flashing steps
  say so.
- Pre-split-identity firmware may report an older undifferentiated PID. The
  manifest's `downloadOnlyIdentities` maps these historical identities to a
  board's current downloads without guessing a half or serving a modern
  Custom definition. Existing stock definitions remain usable where present;
  otherwise the missing-definition notice offers the firmware update page.
  Already-authorized aliases participate in the ordinary VIA protocol probe
  and keep their WebHID permission while that notice is open. They remain
  outside selectable configuration devices until a compatible definition
  exists; unrelated unknown keyboards retain the existing recognition path.
  VERSION may be absent, so latest-file guidance makes no claim about the
  device's measured current version. These aliases are validated separately
  and never enter the generated definition or advanced-capability inventory.
- A layout saved before the change carries the old identity. The app loads a
  saved layout onto any identity of the same board, legacy or another maker's,
  or onto its other half on a split board, so a legacy definition keeps the
  current one's matrix, keycodes and layout options when the stored geometry
  is unchanged. MAY65 V261002R1 intentionally expands from 5×15 to 5×16 to add
  Insert: its frozen legacy definition keeps 5×15 for the old firmware, while
  its current definition uses 5×16. This release resets EEPROM on every H7S
  board; MAY65's old keymap backup requires manual reconfiguration, and the
  existing key-count check refuses a direct cross-geometry import. The same
  release took most EERRAA boards from four layers to six: a layer the file
  lacks keeps what the keyboard has, and a layer the keyboard
    lacks is taken only when it is empty. These are legacy layout-file rules; the approved complete
    settings format is owned by [PROJECT_DIRECTION](../PROJECT_DIRECTION.md#complete-settings-backup-and-restore).
    The legacy file stays official VIA's format:
  keys load per switch position whatever layout option is showing, so a key
  the current option hides is still written, and layout options are not saved.
  The one addition is `tapDance`, the Tap Dance settings official VIA has no
  place for; official VIA ignores it, and a file without it leaves the
  keyboard's Tap Dance as it is. On a keyboard that State Sync leaves
  `unverified` ([ADR 0001](0001-state-sync-protocol.md)), files are saved and
  loaded without `tapDance`, as in official VIA: its Tap Dance is never read,
  and refusing the rest would block the backup its firmware update needs.
- Both halves of a split keyboard take the same maker build, as they already
  must take the same `.uf2`.

## 3. Resolving a connected keyboard

A maker VID resolves directly to its maker, and the PID to the product. A
legacy identity resolves to the product; when exactly one maker distributes
that product the app uses that maker, and when several do (the shared N-series)
the app opens the ordinary firmware maker selection page. It adds no special
question, board-specific chooser, or remembered maker selection. Explicit
maker links remain ordinary catalogue navigation and do not establish the
connected device's maker. When every candidate has a release newer than
VERSION, the update indicator may show that result, with a version only when
they agree; its action still opens ordinary firmware selection.

## 4. Download surface

The header's right cluster keeps the ERA wordmark and adds the firmware entry as
one split control, `ERA │ Firmware`: the wordmark stays the platform identity
and the second segment opens the firmware page. When the connected keyboard has
a newer release, the action segment stays filled and its tooltip names the
board and version. The control lives in `src/components/menus/external-links.tsx`.
On narrow windows, the header groups wrap within the viewport so every route
and language choice stays reachable.

The page speaks the grammar of the rest of the app
(`src/components/panes/firmware.tsx`). With WebHID, the keyboard area's upper
right reuses Configure's device badge. Without a selected keyboard it offers
device authorization. Choosing an authorized keyboard or authorizing a new one
opens that keyboard's download page, using its USB identity and the same maker
resolution as connected-board entry. A cancelled chooser or a device outside
the catalogue leaves the address unchanged. No maker badge is shown above
the drawing. Maker choices, board lists and board details keep the same keyboard
area above the content, with the same position, shared height and theme
background (`src/components/panes/firmware-keyboard.tsx`). The choice and list
pages show a short firmware-selection message there instead of a keyboard;
only a board page loads a bundled keyboard definition and draws it. Keeping
the area across these steps prevents the navigation and rows from moving when
a board is opened. Catalogue entry shows every maker as a plain text link in a
horizontal row centred within the same content column as the setting rows,
without selecting the first maker on the user's behalf. The row wraps naturally
as space narrows; each wrapped line stays centred and each choice keeps its
height. A long name can wrap within its own choice instead of overflowing.
Maker and board pages keep centred maker navigation in the body. On a board
page, the current maker's link returns to that maker's board list; choosing
another maker keeps the board when that maker distributes it. On the list, a
click on the current maker stays there. Maker choices have no visible heading
or separate return links; the navigation keeps its accessible name. The real
maker links keep every maker reachable. Long
names wrap within the viewport, and the content scrolls when space is limited.
The board list is one column of setting rows: each board with its version
and download, or "not published". A connected keyboard keeps its name emphasis
at its original position in the list; it is never duplicated or promoted to a
separate first row. Its resolved maker's navigation link carries the same dot
used for pending changes elsewhere in the app, here indicating connection.
This keeps the list stable while making the maker reachable from another maker's
list. A shared legacy identity marks no maker, including after catalogue navigation,
because its USB identity cannot identify which maker sold it. Its board name
keeps the connection emphasis in each candidate maker's existing list. The
list's Download link opens that board's page without downloading a file. The drawing, file
information and flashing steps are visible
before the user starts the ZIP download with the board page's Download link.
List links keep their real board addresses, so modified clicks can open the
details through the browser. Only the board page's file link has a native
download action. Chip and firmware family names are not shown: most users
do not know what an MCU is, and a board's name is what they look for; the
family only decides which flashing steps its page gives. A board's page puts
that board where
Configure shows the connected keyboard, centred in the same full keyboard area
and drawn from its bundled definition with no legends
(`src/components/panes/firmware-keyboard.tsx`), and lists below it
the latest file, its SHA-256 and the flashing steps. When the keyboard is
connected, its comparison with the latest release is the first row, named
only with the board's name. Maker names are plain text choices: no maker logos,
colors or themed pages,
because the fork is not a manufacturer rebrand (`docs/PROJECT_DIRECTION.md`
**Identity UI**). Makers are listed alphabetically by display name with the
COMMON catch-all last, through `sortMakersForDisplay` in
`src/utils/era-firmware-catalog.ts`; an order driven by board count would
reshuffle whenever a board is added and break scanning.

Distribution starts with a link posted where users gather, so an address alone
must reach the right board. The header opens a recognised connected board's
page when its maker is resolved; an unresolved shared identity opens ordinary
maker selection. `/firmware` prioritises a board only with a resolved maker;
otherwise it shows the same ordinary maker choices. Connected-board entry
replaces the root address with the board's link, so disconnecting to flash leaves its download page open.
`/firmware?makers=1` explicitly opens those choices even while a board
is connected, so catalogue navigation never traps the user on their own board.
`/firmware/<maker>` opens that maker's board list, `/firmware/<maker>/<board>`
opens a board's page, and the short `/firmware/<board>` is resolved in
`src/utils/firmware-route.ts`. Explicit maker and board links take precedence
over background device recognition; an explicit device choice in the badge
opens its downloads or ordinary maker selection even from another board or
`?makers=1`.
Disconnecting still keeps the download page open. Ids match without regard to
case. The short link
opens the board when one maker distributes it; shared board short links show
the ordinary maker selection page. Unknown addresses fall back to catalogue
navigation; a valid maker stays selected when
only its board segment is unknown.

A chat link preview reads only the HTML head and runs no script. Canonical
`/firmware/<maker>` and `/firmware/<maker>/<board>` links therefore rewrite to
`/firmware-app-<maker>`, a copy of the built shell whose title and `og:title`
contain the catalog's maker display name followed by `— Firmware`. The build
generates these shells and their host rules from `config/firmware-catalog.json`
(`scripts/firmware-share-page.ts`, emitted by `vite.config.ts`), before the
generic wildcard in `public/_redirects`. Root, short board and unknown-maker links
retain `/firmware-app` with the generic `Firmware` title. The app's runtime tab
title remains generic; crawler metadata does not depend on device recognition
or script execution. All shells boot the same app assets and omit the VIA logo
preview image. The build fails when the shell no longer has the tags it
rewrites. No per-board HTML inventory is needed. ZIP files are served from
`/firmware-files/`, outside `/firmware/`, so a route rewrite can never answer a
file request with the app shell, for the same reason definitions keep real
404s.

The page must render without WebHID support and without a connected keyboard:
download-only browsers and phones are the audience a vendor link reaches.
`src/Routes.tsx` therefore renders the firmware route outside the HID-support
gate.

A board's page shows the version, release date, size and download, the SHA-256
and the flashing steps for that family. Distribution ZIPs contain `.uf2`,
readme, and the `usevia.app` folder. Do not include `RELEASE.json` or internal
packaging evidence; keep that evidence outside the distributed archive.
ZIP filenames use the model and firmware version without a content-hash suffix.
Repackaging preserves those URLs and updates the catalog size and SHA-256.
Firmware ZIP responses use `Cache-Control: no-store` in `public/_headers` to
avoid retaining a replaced archive. Previously cached responses still require
host cache purging and a live download hash check after deployment.
The stock JSON and usevia.txt in each current package follow the firmware
repository's canonical stock support policy. Do not add Custom observation
labels during packaging: stock LINK omits runtime/saved/result TEXT and stock
H7S polling omits endpoint TEXT. A compatible wire revision alone does not
establish usable stock UI. Definition/guide-only package corrections preserve
the UF2 bytes and update the catalog size and SHA-256 together.
The steps conservatively warn that an update may reset settings and ask for
a backup first. They do not promise either retention or a reset on every
version change. MAY65 also warns that backups from before the Insert expansion
require manual keymap reconfiguration, as described in §2.

Versions use the VERSION grammar (`YYMMDDRn`) everywhere in the app through
`formatEraFirmwareVersion` in `src/utils/era-firmware-version.ts`; file names
keep their `V` prefix.

## 5. Catalog and hosting

The release catalog and ZIPs are static files built and deployed with the app
on the same origin. Why: it needs no new external service or approval, a
release and the app that describes it deploy atomically, development works
offline, and there is no cross-origin download. The catalog is
`config/firmware-catalog.json`, bundled into the app. The build validates the
catalog: every file exists with the recorded size and SHA-256, every entry maps
to a manifest identity of that maker, every maker VID lies in the block, and no
identity repeats. The rules shared with the app live in
`src/utils/era-firmware-catalog.ts`; `scripts/validate-firmware-catalog.ts`
adds the file checks and runs from `scripts/build-keyboards.ts`. The distribution
set may be replaced as a whole with newly packaged firmware releases; removed
archives are not guaranteed to remain downloadable for rollback. Release ZIPs
are packaged after implementation is complete in their owning firmware
repositories, then added together with their matching catalog entries.

A maker can list a board before its file is published. That entry's `file` is
`null`: the page shows the board as not published yet and offers no download,
and the VERSION check makes no version claim for it. A published `file` records
the version, the `/firmware-files/<version>/<maker>/` URL, the size and the
SHA-256, so a catalog entry never points at a file the build has not checked.

Moving binaries to object storage requires the Cloudflare approval in
`docs/PROJECT_DIRECTION.md` **Standing approvals** and is warranted only when
repository growth becomes a real cost.

## 6. VERSION update check

Under `CONFIGURE → SYSTEM → VERSION`, one read-only row below Current Version
reports the result of comparing the VERSION value with the bundled catalog:
up to date, a newer version with a button that opens the board's download
page, the ordinary firmware selection link for a shared legacy identity,
or no distributed file. The header indicator uses the same comparison. The row sends nothing to the
keyboard and adds no SET or SAVE affordance, preserving ADR 0003 §7. An
unreadable or malformed version makes no claim. VERSION used by the header and
download page must come from a successful full CONFIG read on the current
connection, selection and definition. Reconnection or definition replacement
cannot reuse the previous read's authority, even when its bytes are identical.
Partial reads and optimistic SET updates do not establish that authority.
Background reconciliation within the same context retains the last accepted
VERSION so the update indicator does not flicker.

A bootloader shortcut on the firmware page may reuse the existing Jump To BOOT
custom value behind a confirmation; it must not introduce a new command.

## 7. Verification

`tests/docs-contract.test.ts` covers this document.
`tests/firmware-distribution.test.tsx` covers catalog validation, identity
resolution, version comparison, maker order, the route rewrites, the VERSION
row and the page in published and not-yet-published states. New strings are in
all locale catalogs checked by `tests/locales.test.ts`.
