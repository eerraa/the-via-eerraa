# Architecture decision records

Genre: manual
Canonical for: when this repository needs an ADR, the local numbered-ADR
lifecycle, and how obsolete decisions leave the active document set

`AGENTS.md` owns the repository's shared documentation-convention declaration
and routing. `tests/docs-contract.test.ts` checks the local document fields,
links, paths, and reachability. This manual owns only ADR-specific choices; it
does not copy the shared convention.

Current numbered decisions:

| ADR | Current decision |
| --- | --- |
| [0001](0001-state-sync-protocol.md) | State Sync authority, compatibility, and exact-ms requirements |
| [0002](0002-h7s-usb-diagnostics.md) | H7S USB diagnostics wire interpretation and product boundary |
| [0003](0003-era-menu-help-ui.md) | ERA menu help and diagnostics UI placement |

## 1. When an ADR is warranted

Write or extend an ADR when a future change must preserve a decision that
cannot be recovered reliably from one source file: protocol compatibility,
persistent-data rules, cross-repository ownership, deploy or license boundaries,
or a durable product/UI choice with a non-obvious reason.

Do not use an ADR for branch state, current HEAD, process ids, test-run results,
ordinary implementation detail, candidate lists, or a completed work log.
Implementation facts stay in source and tests; transient work stays in Git and
the current execution.

Prefer extending the current owner when a decision already belongs to an
existing ADR. Create a new numbered ADR only when the new decision has a
distinct ownership boundary that would otherwise be ambiguous.

## 2. Local numbered-ADR fields

A numbered `docs/adr/NNNN-*.md` is a contract document and carries these
local fields near its title:

```text
Status: Accepted
Genre: contract
Canonical for: the durable facts this ADR owns
```

`tests/docs-contract.test.ts` enforces the accepted local values. `Status`
is one of `Proposed`, `Accepted`, or `Superseded`; non-numbered documents
do not need an ADR status. `Canonical for` must identify a real ownership
boundary rather than restating a filename or a temporary task.

Routing belongs in `AGENTS.md` and `docs/MAP.md`; do not add a document-side
`Read when:` list.

These fields are a local indexing choice, not a required body template. Section
names, counts, and prose structure follow the decision being recorded.

## 3. What the body preserves

Keep the current requirement, the reason it exists, the boundary of the
decision, and the verification or compatibility consequence needed by future
changes.

A rejected alternative belongs in the ADR only while the rejection still
constrains current work. Preserve the reason and any meaningful condition that
would justify revisiting it; do not preserve the review conversation, dates,
old implementation inventories, or a fixed prose shape merely to show that the
decision was once discussed.

Wire or storage values remain explicit when the ADR is the requirement owner.
Source-owned constants, component names, generated inventories, and test counts
should instead be referenced by stable path plus symbol or heading.

## 4. Changing or retiring a decision

When the current decision changes, edit the owning ADR so it states the new
requirement and current rationale. Git holds the superseded wording; do not add
an in-file chronology.

Use `Status: Superseded` only while an explicit successor or compatibility
transition still needs the old record to remain reachable. If an ADR no longer
constrains current work and no active successor depends on it, remove it from
the active document set rather than creating an archive.

Never create an archive directory for retired ADRs and never reuse an ADR
number. A new independent decision receives the next number.

Before retiring an ADR, move any still-valid product requirement, safety or
compatibility boundary, or unique rationale to its proper current owner. Do not
delete a requirement merely because the implementation has moved.

## 5. Verification

A new or changed ADR must remain reachable through the existing entry chain and
must pass `tests/docs-contract.test.ts`. Run the focused product or protocol
tests as well when the ADR changes a product contract; documentation-only
wording cleanup does not by itself require a full product build or hardware
test.
