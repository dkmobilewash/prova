### Three stale doc claims, one of which cost a laptop rebuild an afternoon — AUDIT, docs only (Cyrus)
`cyrus/audit-local-dev-stack`

Cyrus's laptop died and was rebuilt from nothing on 2026-09-10, which made
it the first real exercise of the docs as setup instructions since they
were written. They mostly held. Three claims did not, and this corrects
them with what the rebuild established.

**CLAUDE.md said there are two Clerk instances; his machine runs a third
the table never mentioned.** The rebuild went hunting for
`striking-jaybird` keys that Cyrus's Clerk account cannot see — his local
stack is its own Clerk app entirely, `smart-rattler-7073` in his own
organisation, paired with his own Neon project. Proved by result: signing
in locally with those keys against `ep-icy-hat` showed the test jobs
created before the old laptop died. The table gains the row and a
paragraph naming which dashboard holds which dev keys, because "the dev
keys" now means two different things obtainable by two different people.

**FEATURE-AUDIT.md's intro still warned that Sheets 17, 19, 20 and 22
were stale** a week after all four were rewritten with their own dated
update notes. Struck, with the strike-through explaining itself — the
warning was the stale text, not the sheets.

**FEATURE-AUDIT.md's recount paragraph still argued its way to 119 items
forty lines under a summary line saying 125.** Both were true on their
own day; nothing marked which day was whose. The recount is now framed as
the historical worked example it is, and the current totals were
re-derived rather than trusted: all 26 per-sheet headers sum to
99 + 19 + 6 + 1 = 125, agreeing with the prose line and the table.
