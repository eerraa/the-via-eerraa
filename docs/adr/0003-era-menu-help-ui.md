# 0003 — ERA menu help and diagnostics screen UI

Status: Accepted
Genre: contract
Canonical for: ERA help and diagnostics UI placement, user-visible support
boundaries, observation wording, localization/accessibility, per-control help
rules, naming policy, and VERSION read-only presentation

This ADR owns durable user-facing decisions, not the current React structure.
Current components, CSS values, translation keys, command-id tables, supported-board
inventory, and exact copy are source-owned and are routed by `docs/MAP.md`.
Diagnostics wire and instrumentation are [ADR 0002](0002-h7s-usb-diagnostics.md);
the fork's product and official-VIA boundary is `docs/PROJECT_DIRECTION.md`.

## 1. Diagnostics belongs with the setting it measures

The diagnostics surface stays inline under `CONFIGURE → SYSTEM → USB POLLING`,
where the user chooses the mode whose behavior is being observed. It is not a
global diagnostics destination.

Only an app-owned ERA definition that explicitly opts into USB diagnostics may
expose this surface. The same hardware opened through an official or user-uploaded
definition must not start the custom diagnostics protocol merely because its
identity matches. Ordinary VIA keyboards and official-VIA workflows remain
unchanged.

> **REFUSED:** a top-level diagnostics page, modal, accordion, or definition-only
> injection of the diagnostics block.
> **WHY:** separating the measurement from polling-mode control made the feature
> hard to discover; global placement exposed an ERA/H7S-only aid to unrelated
> keyboards; and a modal or folded live session adds avoidable state loss. A
> definition-only gate would also let official/uploaded definitions invoke a
> custom-app extension they did not opt into.
> **REOPENS:** only if the supported-client boundary or the measurement workflow
> changes.

## 2. Summary first; advanced evidence remains available

The default result answers what the measured window observed in plain language.
Raw counters, timing distributions, historical comparison, and other expert
evidence stay available on request rather than competing with that answer.

A caveat that can reverse the interpretation of a result stays visible when it
applies; it is not hidden merely to make the card shorter. Recovery or
leftover-session actions appear with the condition they act on rather than as an
unexplained global control.

> **REFUSED:** an always-expanded metrics dashboard, deleting advanced evidence,
> or collapsing interpretation-changing caveats.
> **WHY:** the first overwhelms the actual answer, while the latter two make a
> technically precise measurement easier to misread.
> **REOPENS:** if the diagnostics question or evidence set changes materially.

## 3. Observation copy is not a verdict

Diagnostics may state only what was observed in the measured window. Wording such
as “no report queue drops were observed” is valid; “stable”, “perfect”,
“certified”, “no problems”, or a composite health score is not.

The UI must make measurement scope explicit. A run with no keypress samples must
say so rather than allowing delivery statements to read as a clean result.
Condition-specific caveats such as a negotiated-speed mismatch must remain
attached to the observation they qualify.

Translations are part of this boundary: a fluent translation must not strengthen
“not observed” into a broader reliability claim.

**Cause:** hardware validation produced an incorrect conclusion more than once
when limited evidence was phrased like a general health judgment. Keeping only the
measurement claim prevents the diagnostics UI from certifying failure classes it
does not measure.

## 4. Words and visual hierarchy serve the user question

User-facing names describe the thing the user is trying to understand, not the
transport or firmware implementation. Protocol jargon belongs in advanced
evidence only when precision requires it. The diagnostics block is therefore
about USB polling behavior, not about an internal instrumentation object.

Primary observations must read as the primary information. Secondary state, raw
metrics, axes, and explanatory detail must not visually outrank the answer.
Exact typography and layout values are implementation-owned rather than part of
this ADR.

## 5. Language and accessibility boundaries

Every shipped locale must carry the same user-visible meaning for help, warnings,
and diagnostic observations. English fallback makes missing catalog work easy to
miss, so missing or semantically weaker translations are defects rather than an
acceptable supported state. Supported translations must remain readable without
clipping or overlap as copy expands; exact layout and breakpoints are source-owned.

The copied diagnostic report body stays English because its audience is the
maintainer receiving a bug report; the button and surrounding UI may localize.
Changing the UI language must not abort an active measurement.

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

Custom-app presentation may add help and diagnostics that official VIA does not
provide, but it must not imply that the firmware depends on this fork. Features
covered by the official-VIA compatibility contract remain usable through official
`usevia.app` plus the official definition; app-only aids are additive and
capability-gated.

`VERSION` is one read-only value from the selected keyboard. It has no edit, SET,
or SAVE affordance. Malformed or unavailable firmware data is shown as unknown
rather than guessed from a definition or static app string. The wire/display
grammar and current command identities are source-owned and routed by
`docs/MAP.md`.

### Failed persistence remains actionable

A successful SET followed by a failed SAVE leaves the authoritative runtime
value visible. A separate retry obligation keeps a valid draft actionable even
if GET equals it. Only a successful SAVE clears that obligation; CONFIG equality
cannot. Editing retains it, invalid drafts cannot Apply, and Cancel discards the
local retry/draft without rolling back runtime. Pane reentry and device selection
retain per-device intent; physical removal discards it with the drafts. A
connection reload alone is not evidence of persistence and retains retry intent.

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
