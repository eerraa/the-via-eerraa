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
  lacks is taken only when it is empty. The file stays official VIA's format:
  keys load per switch position whatever layout option is showing, so a key
  the current option hides is still written.
- The file also carries the settings the app reads through VIA for the
  keyboard, in fields official VIA ignores: `tapDance`, `layoutOptions` (the
  `id_layout_options` integer packed by the definition's layout labels, as
  Vial's `.vil` keeps it), `customMenuValues` (V3 Custom Menu values by
  command name; a keycode by name, as on the layers) and `perKeyRGB` (the
  per-key [hue, saturation] pairs by LED index). Why: an EEPROM clean or an
  update that resets settings otherwise loses the layout option and the
  lighting a backup was made to keep. A setting without a VIA read, such as a
  keycode-only swap, is not saved, so no firmware command is added for it. A
  file without a field leaves those settings as they are. A load writes only
  values that differ or that the keyboard has not kept yet, only to a command
  the keyboard reported, and only what the control could send: one of a
  toggle's options, a value within a range's bounds, one of a dropdown's
  choices, a keycode that loads as written, and per-key colours only when the
  file has one for every LED the definition maps. Anything else keeps the
  keyboard's value. It never sends an action switch (bootloader, EEPROM clean,
  an Apply) or a value held until such an Apply (split link speed, USB boot
  polling, whose Apply restarts the keyboard): a restore must not reboot or
  re-enumerate the keyboard.
- `macroOptions` carries each macro's playback options (the FLAGS byte and
  the hold time in ms, by macro index), saved only where CAPABILITIES
  confirmed support. A load writes them after the macro contents and, like the
  Custom Menu values, only where they differ from the keyboard's, because VIA's
  macro RESET, which starts a macro write without macro replace, keeps the
  options; while their SAVE is owed it writes every value that fits again.
  A value fits when its flags are all supported and are not REPEAT without a
  stop condition, and when its hold time is 1..65535 ms on firmware that
  supports Stop on hold; anything else keeps the keyboard's value. Their SET
  and SAVE take the Custom Menu values' handling below. As for those values, a
  load compares them only after CONFIG is current again, and a keyboard whose
  options could not be read refuses the load rather than drop them; firmware
  that reports no support loads without them.
- Safety exception: a split keyboard's EEPROM SYNC switch is neither saved nor
  loaded, although it is a stored setting. Turning it on starts the halves'
  storage sync, which replaces the losing half's settings with the other's for
  good (the larger divergence count wins, a tie goes to the left half), so a
  load could overwrite either half. Turning it on stays the user's explicit
  action. INPUT SYNC and RGB SYNC do not replace a half's stored settings and
  load like any other setting.
- A SET the keyboard answers as unhandled leaves that setting as it is, so
  ordinary VIA firmware still loads the rest. A SAVE it refuses is handled as
  for an edit: that channel's values run but are not kept, stay owed a SAVE,
  and go out again with the next load even where the keyboard shows them; the
  load reports that it failed, and other channels still save. On a keyboard
  that State Sync leaves `unverified`
  ([ADR 0001](0001-state-sync-protocol.md)), files are saved and loaded
  without `tapDance`, `customMenuValues`, `perKeyRGB` and `macroOptions`, as
  in official VIA:
  those values are never read, and refusing the rest would block the backup
  its firmware update needs.
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
connected, the file row is its row, so the board is named once: the name keeps
the list's connection emphasis, and the VERSION the keyboard reports leads into
the file's version ("Current 261005R1 → 261015R1"), or reads "Current" alone
when they match. Download stays the primary action unless the keyboard already
has the latest release. Maker names are plain text choices: no maker logos,
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

A board's page shows the version, its EEPROM transition status, size and
download, the SHA-256 and the flashing steps for that family. No release date is
shown: the version already encodes it. The file row shows an explicit EEPROM
status (`EEPROM kept`, `EEPROM reset`, or `Settings retention unknown` — `EEPROM 유지`,
`EEPROM 초기화`, `설정 유지 여부 알 수 없음`) without opening the release line, driven by
the connected keyboard's authoritative VERSION and the selected target version
through `classifyFirmwareTransition` in `src/utils/era-firmware-catalog.ts`,
including when the selected version equals the installed version:
- On QMK RP2040 boards, `QMK_STORAGE_PLACEMENT_BOUNDARY` moves the NVM store out
  of the final 128 KiB. Any valid
  authoritative QMK VERSION below that boundary selecting a known target at or
  above it shows `EEPROM reset` even when the older build is not in the catalog
  or shares the same `storageKey`, because the first boot on the new region
  initializes storage.
- When both the installed and selected QMK versions are at or above that
  boundary, equal known `storageKey` values show `EEPROM kept` and unequal keys
  show `EEPROM reset`.
- When both QMK versions are below that boundary, a `storageKey` mismatch shows
  `EEPROM reset`, while equal keys show `Settings retention unknown` with a short
  Bootmagic note because original pre-boundary QMK firmware may format EEPROM
  before flashing. Recovery repacks preserve VERSION, so the app cannot tell
  an installed original from its non-destructive replacement. Keep the first
  update warning and recommend VIA BOOT or double-press Reset; do not infer
  installed behavior from the currently hosted ZIP.
- A QMK downgrade from at or above that boundary to a build below it shows
  `Settings retention unknown` with a concise previous-storage note rather than
  claiming an unconditional reset, because the older build reads the previous
  storage region and current new-region settings do not transfer.
- H7S boards have no un-keyed placement boundary and compare known `storageKey`
  values directly.
- While the connected keyboard's full CONFIG read for the current connection,
  selection and definition is still pending (`getSelectedCustomMenuAvailability`
  is `'checking'`), the file row shows neutral `Checking installed firmware…`
  (`설치된 펌웨어 확인 중…`) without a failure warning.
- When the page's keyboard is not connected, an unverified-current result shows
  only the compact `Connect keyboard to check` (`키보드 연결 후 확인`) guidance.
  Once the read settles, a connected keyboard with an unavailable or unverified
  VERSION shows `Settings retention unknown` with a visible explanation that
  its current version and settings retention cannot be determined; when a valid
  VERSION was read but its storage compatibility is absent from the catalog, the
  explanation states that compatibility data for the installed version is
  unavailable rather than claiming the version read failed. Neither wording
  implies a memory fault or changes the classifier's result.
- Unverified-current explanations reuse the common `i` help disclosure
  (`useExplainDisclosure` and `HelpBody`), with the same icon face and
  inherited typeface as other help. Activation expands one initially folded
  right-aligned explanation directly below the download controls, inside the
  file row; a second activation folds it again. The file row has extra vertical
  room above the version and grows downward when help opens, moving SHA-256 and
  the following content down without moving the download controls.
  There is no floating popup, native title or duplicate explanation.
- Firmware-page secondary text uses `#999999` in the dark theme; the light
  theme keeps its existing label color. The help circle remains 20 px while
  its transparent hit target is 44 × 44 px, positioned without covering the
  version selector or changing the row layout.
- The exclamation warning icon is reserved for the `EEPROM reset` state,
  which indicates settings loss, not for unknown compatibility or help.
- The backup note directs users to the localized `Save + Load` menu.
  The redundant post-update device-authorization note is omitted.
- Bootmagic and downgrade operational warnings stay visible in the flashing
  notes rather than being hidden in the folded help.
- `Reset.uf2` is documented in the flashing notes as unconditionally resetting
  the keymap and settings, without adding a separate file-selection control.
When the board has more than one published version, the version unfolds its
release line under the drawing: every published version, its note where one is
written, and where a storage-format or QMK placement change resets settings,
using the same `classifyFirmwareTransition` helper so equal-key pre-boundary QMK
releases stay unbroken on the historical format line while the QMK placement
boundary and key changes break it (`src/components/panes/firmware-version-line.tsx`).
Choosing a version puts its file and EEPROM status in the row. Distribution ZIPs
contain `.uf2`,
readme, and the `usevia.app` folder. Do not include `RELEASE.json` or internal
packaging evidence; keep that evidence outside the distributed archive.
The package guides are `readme.txt` and `usevia.app/usevia.txt`, each with Korean
followed by English. Do not add separate guide files for other languages; those
translations belong to the VIA app's help and menus.
ZIP filenames use the model and firmware version without a content-hash suffix.
Repackaging preserves those URLs and updates the catalog size and SHA-256.
EERRAA recovery repacks keep the selected release's normal features, storage
placement and format keys. They backport non-destructive Bootmagic and add a
full-featured `Reset.uf2` built from that same release, with current Korean and
English guides. Reset is an explicit once-per-install settings reset; it does
not silently upgrade to the newest release. Preserve source commits, separate
normal/recovery build manifests and hashes outside the archive. Include the
latest firmware-local official VIA definitions for that keyboard and maker,
alongside the latest guides, and validate them against the current schema.
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
adds the file checks and runs from `scripts/build-keyboards.ts`.

Published versions accumulate. The catalog's `versions` lists every version
still offered; each entry holds its families' storage-format keys, an optional
one-line note in every app language (left out where what changed cannot be
told), and its files by maker and board, kept in that version's folder under
`public/firmware-files/`. A maker's board takes the newest version
that ships it (`resolveFirmwareCatalog`), and the board page's version unfolds
its release line of every published version, so an earlier build stays
downloadable for rollback. Release ZIPs are packaged after implementation is
complete in their owning firmware repositories; a release then adds one version
entry and its folder and leaves the earlier ones as they are. A defective
version is withdrawn by deleting its entry and its folder together, with no
record kept, and the newest remaining version becomes current with no other
edit. The build checks the files of every version, not only the newest.

Release descriptions must apply to the board being shown. A board-specific
description replaces the family's common description in full, including in the
version's accessible name. Choose that scope before choosing a language; a missing
translation must not fall back to another scope. Every description must have a
non-empty value in each supported app language. Common descriptions remain only
for changes that apply to every board in that family. When changes are unknown,
leave the description absent rather than infer them from the version.

A maker can list a board before any version ships a file for it: the page
shows the board as not published yet and offers no download, and the VERSION
check makes no version claim for it. A published file records its
`/firmware-files/<version>/<maker>/` URL, size and SHA-256 in its version's
entry, so the catalog never points at a file the build has not checked.

Moving binaries to object storage requires the Cloudflare approval in
`docs/PROJECT_DIRECTION.md` **Standing approvals** and is warranted only when
repository growth becomes a real cost.

## 6. VERSION update check

Under `CONFIGURE → SYSTEM → VERSION`, one read-only row below Current Version
reports the result of comparing the VERSION value with the bundled catalog:
up to date, a newer version and a button that
opens the board's download page, the ordinary firmware selection link for a
shared legacy identity, or no distributed file. The header indicator uses the
same comparison. EEPROM status and transition explanations appear only on the
download page, not in SYSTEM → VERSION. The row sends nothing to the
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
