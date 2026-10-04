# 0003 — ERA menu help and diagnostics screen UI

Status: Accepted
Genre: contract
Canonical for: ERA help and observation UI placement, user-visible support
boundaries, observation wording, localization/accessibility, per-control help
rules, naming policy, and VERSION read-only presentation

This ADR owns durable user-facing decisions, not the current React structure.
Current components, CSS values, translation keys, command-id tables, supported-board
inventory, and exact copy are source-owned and are routed by `docs/MAP.md`.
Polling observation and retired diagnostics boundaries are [ADR 0002](0002-h7s-usb-diagnostics.md);
the fork's product and official-VIA boundary is `docs/PROJECT_DIRECTION.md`.

## 1. Observations belong with their controls

Current Polling stays in SYSTEM / USB POLLING. It reports the endpoint interval
setting at the last successful automatic read. Its scope note belongs in
collapsed help; there is no Refresh button.
The retired diagnostics session UI is not mounted, including for older firmware.
The support and lifetime boundary is [ADR 0002](0002-h7s-usb-diagnostics.md).

SYSTEM / LINK pairs the editable selection with Current Link Speed, the actual
runtime level at the last successful automatic read. Editing or requesting Apply
does not predict that observation. This follows the same selection/current-value
pattern as USB POLLING. The last request result belongs beside Apply, not in a
permanent Last Apply row: no-request-since-boot is normal and stays silent.
Pending, refusal and later failure remain visible; success is shown after this
screen confirms Apply and clears on the next edit or Cancel. Runtime/stored
disagreement remains visible even without an Apply request. The result concerns
the selected unit, not all saved settings on the other half.
GET of the Apply toggle returning zero is consumption, never success evidence.

## 2. Link result and confirmation

Apply reads SYSTEM channel 9/value 66 together with Runtime and Saved Level.
A supported result must report Applied for the requested level or Already set,
and both levels must match through the fallback confirmation window. Busy,
Failed and Cancelled leave a retryable draft even when runtime matches it.
Returning a selection to matching runtime and stored levels clears the draft
and disables Apply. Result-query support alone never makes a value dirty.
Same-speed Apply remains available only for a real retry obligation or a
runtime/stored mismatch (including an unknown level). A live failure receipt
also permits an explicit retry, including failure reported after confirmation.
For a definition with a result address, once the action is attempted its retry
obligation survives edits, matching GETs and pane
reentry until confirmation succeeds or the user cancels the draft. Device
removal discards it; switching away does not acknowledge completion.
Definitions without a result address retain Runtime/Saved-only confirmation.

The result changes without CONFIG revision. The active LINK screen rereads it
and both levels, including after initial success, and pauses while hidden or an
Apply owns the watch. Activation reacquires the observation. There is no separate
LINK Refresh button. Background reads retain the last same-session receipt while
in flight, then replace it on success or invalidate it on failure. Malformed
responses retry on the next active-screen interval; transport failures retain
the existing connection policy. The local-result scope note is in collapsed help.
Connection, selection or definition changes retire outstanding reads.

Value 66 is optional on older firmware: unhandled keeps the current speed visible
and uses the existing Runtime/Saved confirmation, without claiming a local receipt.
Timeout, malformed and disconnect are failures, not legacy support evidence.
ERA observations live outside CONFIG caches so replacement cannot resurrect
old receipts. Current speed is also a scoped explicit-read observation; it is not
restored from generic CONFIG data after failure. The six current Custom definitions
retain the result address for confirmation while naming the runtime label for users.
Stock V3 definitions omit the three LINK status labels because stock VIA cannot
keep them current after Apply; usevia.txt directs status inspection to usekb.cc.

## 3. Observation copy is not a verdict

Observations state their scope, without stability scores, latency guarantees,
or claims about another unit's complete saved state. Translations preserve
those limits. Firmware response text remains exact; surrounding guidance and
host error states are localized.

## 4. Failed persistence remains actionable

A successful SET followed by a failed SAVE leaves the authoritative runtime
value visible. A separate retry obligation keeps a valid draft actionable even
if GET equals it. Only a successful SAVE clears that obligation; CONFIG equality
cannot. Editing retains it, invalid drafts cannot Apply, and Cancel discards the
local retry/draft without rolling back runtime. Pane reentry and device selection
retain per-device intent; physical removal discards it with the drafts. A
connection reload alone is not evidence of persistence and retains retry intent.

Pending-change dots mark unapplied or unsaved drafts, including failed SAVE
retries; they do not promise that Apply is currently available. A submenu tab
keeps its summary dot when a field is hidden but its draft remains. Immediate
controls do not receive dots. MOUSE's advanced switch changes presentation only
and has no summary dot; its fields and submenu tab carry the pending state.

## 5. Language and accessibility boundaries

Every shipped locale must carry the same user-visible meaning for help, warnings,
and diagnostic observations. English fallback makes missing catalog work easy to
miss, so missing or semantically weaker translations are defects rather than an
acceptable supported state. Supported translations must remain readable without
clipping or overlap as copy expands; exact layout and breakpoints are source-owned.

Changing the UI language must not retire an observation or its active query.

Help disclosures must be keyboard-operable, expose expanded/collapsed state and
their controlled content relationship, and have contextual accessible names when
several information controls share a screen. Expanded explanatory text remains
ordinary selectable/readable content. DOM presence while collapsed is not, by
itself, an accessibility guarantee and is not a reason to omit those controls.

> **REFUSED:** unlabeled identical information buttons, English-only user help,
> or translating maintainer report payloads per UI locale.
> **WHY:** users need distinguishable controls and equivalent safety/observation
> meaning, while a maintainer-facing report needs one predictable language.
> **REOPENS:** if the report audience or supported localization model changes.

## 6. ERA menu help explains consequences, not implementation

ERA-only help is attached through ERA feature identity/capability, not a free-form
menu label that an ordinary VIA definition might also use. Current command
matching and help text live in source; this ADR owns their user-facing shape.

- A submenu summary names what the setting affects. It is one sentence, uses no
  second person, and is at most 12 English words. The same one-sentence shape
  applies in every shipped locale.
- Detail is optional. It stops at user-visible behavior, trade-offs, and the
  direction in which a value should be moved; firmware mechanism is omitted.
- Per-control ⓘ appears when the label/unit cannot answer the consequence or when
  named choices require comparison. It does not repeat a consequence already
  supplied by the submenu summary or a self-explanatory unit.
- Help for one firmware family may resolve from different command identities in
  another family, but the user-visible feature meaning stays aligned.
- Help is minimal. Detail is a few short paragraphs; named choices are a list of
  the option name and one sentence, in the dropdown's order, and that list must
  match the options the definitions actually offer. The shipped default is only a
  mark on that list. Anything the reader does not need in order to set the value
  is left out: a switch's default, a sentence that describes the screen, generic
  advice. Help that is one sentence has no disclosure. Inside a control's own list
  the option it currently holds may read brighter, because every alternative stays
  in view.
- Help text sits at the size of the text around it, not as fine print, and each
  shipped locale uses one word per thing across its help.

> **REFUSED:** turning submenu-top help into a long implementation guide, making
> top help change with the currently selected option, or attaching ⓘ to every
> row.
> **WHY:** those designs either force the user to hunt for the relevant sentence,
> hide the alternatives at the moment of comparison, or create repetitive noise.
> **REOPENS:** if the control model stops fitting summary/detail disclosure.

## 7. Names and controls must match real supported behavior

MOUSE's advanced presentation retains the basic controls' relative order:
cursor acceleration, speed, then interval; wheel interval, then acceleration.
Additional advanced values stay next to their related controls. Toggling the
presentation must not force users to relearn the page or change their drafts.

Labels describe observable behavior and scope. An ERA definition's submenu, row
and option names are shown as the definition spells them, in the custom app and in
its help, so a catalog word shared with another board never translates one name
among its neighbours. A row whose own field draws its unit after the number drops
the same closing "(ms)" or "(s)" from its name; the definition keeps it for official
VIA, which draws no unit. Rows the app draws itself and the top-level menu names stay
translated. A
firmware behavior with only one legal mode is explained rather than presented as a
one-choice selector. A client
must not invent a control the connected firmware does not implement; current
feature membership and labels are source-owned.

On an ERA definition's page, a switch the firmware always reads back off, because
turning it on is an action, is a one-word button. A value the firmware only holds
until such a switch puts it into effect, like the split link speed, is a draft that
Apply writes together with that switch, shown as the value the keyboard reports in
effect where it reports one: a held value or a switch left on would claim a change
the keyboard has not made. Until the keyboard reports a value both in effect and
kept, choosing it is a change Apply can send, even at the value shown, so a speed
the pair fell back to can still be kept.

Custom-app presentation may add help and observations that official VIA does not
provide, but it must not imply that the firmware depends on this fork. Features
covered by the official-VIA compatibility contract remain usable through official
`usevia.app` plus the official definition; app-only aids are additive and
capability-gated.

`VERSION` is one read-only value from the selected keyboard. It has no edit, SET,
or SAVE affordance. Malformed or unavailable firmware data is shown as unknown
rather than guessed from a definition or static app string. The wire/display
grammar and current command identities are source-owned and routed by
`docs/MAP.md`.

## 8. Low-saturation RGB effect guidance

For an ERA definition, a known RGBLight or RGB Matrix effect whose main color
pattern fades near white carries a persistent notice at low saturation under its
effect selector. The notice says the pattern is hard to see, not that the effect
has stopped. The advisory threshold lives in `src/utils/rgb-white-effects.ts`;
it is not a firmware limit or a measured visibility boundary.

The notice follows the current menu state, including immediate local edits and
subsequent firmware reconciliation, and also applies on opening the page. It needs
no extra HID query and disappears when the condition no longer applies. It does not
change the color automatically. Brightness/position animations that remain visible
in white and effects that generate their own saturation do not need this notice;
a missing or unknown value is not evidence of low saturation.

Some definitions hide Color for effects that ignore hue but still use saturation.
For these effects, the same definition's Color control remains accessible through
its existing Custom Value path, even after saturation changes, so the picker does
not disappear during a drag. This is an app presentation aid and requires
no firmware or definition extension. Ordinary and uploaded definitions retain their
existing presentation. Effect classification lives in `src/utils/rgb-white-effects.ts`;
option names are matched within the known command family because numeric RGB Matrix
mode assignments can vary by firmware build.

## 9. Verification routing

`AGENTS.md` routes this UI contract to the focused locale, custom-menu, diagnostics,
and definition tests. `docs/MAP.md` separates requirement owners from the current
source strings, capability inventory, and implementation anchors.

This ADR intentionally does not enumerate components, CSS values, translation
keys, supported boards, command ids, or the current screen tree. Those are checked
from their source owners; this file keeps the durable UX decisions and reasons.
