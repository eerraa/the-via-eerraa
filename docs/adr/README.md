# Architecture decision records

Genre: manual
Canonical for: when to write an ADR in this repository, numbered-ADR Status
Proposed / Accepted / Superseded, Genre contract and Canonical for, and how
a decision is retired

> Shared two-line header, five genres, REFUSED three-liner, and retirement
> catalogue are [eerraa-agent-docs](https://github.com/eerraa/eerraa-agent-docs)
> tag **v1**
> [`AGENT_DOCS_CONVENTION.md`](https://github.com/eerraa/eerraa-agent-docs/blob/v1/AGENT_DOCS_CONVENTION.md).
> This file does not copy that spec. Path · header · index · citation checks,
> and that `Status:` is required only on numbered ADRs, are
> `tests/docs-contract.test.ts`. Constraint-cause and no-dates rules for every
> document are `docs/MAP.md` §9. Product direction is
> `docs/PROJECT_DIRECTION.md`.

Re-measured from `tests/docs-contract.test.ts` (`KNOWN_STATUS`, numbered-ADR
match `/^docs\/adr\/\d/`) and the numbered files in this directory.

| # | Decision |
| --- | --- |
| [0001](0001-state-sync-protocol.md) | State Sync revision validation (selector `0x06`) |
| [0002](0002-h7s-usb-diagnostics.md) | H7S USB delivery diagnostics (selector `0x07`) |
| [0003](0003-era-menu-help-ui.md) | ERA menu help and diagnostics screen UI |

## 1. When to write

Write an ADR for a decision the next change must preserve: protocol
compatibility, persistent data, cross-repository ownership, deploy, license,
or a durable UI/product contract with refused alternatives. The numbered files
in this directory are that set.

Not an ADR: branch state, process ids, ordinary implementation detail, or a
list of candidates with no decision. Transient work is recorded nowhere —
`git log` and the verification commands answer it (`AGENTS.md` §6).

Product-wide durable non-goals that are not one decision live in
`docs/PROJECT_DIRECTION.md`. An accepted ADR that becomes product direction is
**linked** from there; the decision stays in the ADR.

A new numbered file is unreachable until `AGENTS.md` or `docs/MAP.md` names it
(`every document is reachable from the entry chain` in
`tests/docs-contract.test.ts`).

## 2. Numbered ADR header

A numbered file `docs/adr/NNNN-*.md` declares, in this order, as 0001–0003 do:

```text
# NNNN — decision title

Status: Accepted
Genre: contract
Canonical for: the facts this ADR is the single source of
```

- **Status** — exactly one of `Proposed`, `Accepted`, `Superseded`
  (`KNOWN_STATUS` in `tests/docs-contract.test.ts`). Required on numbered
  ADRs. This README is a manual, not a numbered record, so it has no
  `Status:`.
  - `Proposed` — drafted, not yet in force.
  - `Accepted` — in force.
  - `Superseded` — no longer in force; a successor owns Canonical for those
    facts.
- **Genre** — `contract` on every numbered ADR. This README is `manual`.
- **Canonical for** — non-empty. An empty declaration is worse than none. Two
  Accepted ADRs must not claim the same facts.

`Read when:` is forbidden. Routing is `AGENTS.md`.

## 3. Body

Four sentence kinds. They are not a required heading list: 0001 titles the
choice `Decision and rationale`; 0003 uses numbered sections and ends at
`## 10. Verification`. 0001 and 0002 have `## Consequences` and
`## Verification`.

- **Context** — which verified constraint or failure required a decision.
- **Decision** — what was chosen and where it stops.
- **Consequences** — what became easier, harder, or deferred.
- **Verification** — what would confirm or falsify the decision.

Refused alternatives sit next to the decision as the v1 three-liner. This
file does not restate that shape.

## 4. How to retire

Inside one ADR: delete the overturned text. Do not annotate "this judgment was
overturned in the section below." `git log` holds the old text. If the reason
for overturning now grounds the current rule, keep **only that reason**.

[ADR 0003](0003-era-menu-help-ui.md) §1 keeps "a top-level tab failed
discoverability" because that is why inline placement is the contract; the
top-level-tab spec is gone. §3 keeps **Cause:** because dropping it leaves
nothing to stop the next dashboard from adding a score. The general
constraint-cause rule for every document is `docs/MAP.md` §9.

When a numbered ADR as a whole is no longer in force: set `Status:
Superseded`. Do not add an archive tree. Write the successor as a new numbered
file. Do not reuse `NNNN`.
