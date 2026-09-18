### The guard tools.ts said it had (Diego)
`claude/prova-ai-task-completion-96pjes`

From a second audit of every AI feature, run because the first one was six
days and four AI changes old. Most of what it checked had held; two things
had not.

THE DOCUMENTED GUARD THAT DID NOT EXIST. `ToolDefinition.capability`'s doc
comment read "tools.test.ts pins each one against ROUTE_CAPABILITY."
tools.test.ts had nineteen tests and mentioned neither `capability` nor
`ROUTE_CAPABILITY`. `commands.test.ts` does pin the sixteen COMMANDS that
way, which is where the sentence looks to have come from; it was never
true of the read tools. A documented guard that does not exist is worse
than an absent one, because it is the reason nobody writes it.

WHAT THE MISSING GUARD LETS THROUGH, and it is the defect `capability` was
added for. Until 2026-09-08 the Ask executor knew only the company, so a
FIELD-function member the dashboard withholds margin from could ask the box
beside those tiles and be answered. `capability` closed that by filtering
the offered list per person. But it is ONE field and a handler cites
SEVERAL pages, so it names the guard on whichever page its author had in
mind and nothing checked the rest — a gap that grew with the tool list,
which nearly tripled in ten days.

FOUR PAIRS DISAGREE TODAY. Three are `/cash-flow` as a secondary citation
from a tool gated on a different billing capability: the data is gated by
the declared capability, so the cost is a citation the person cannot open
rather than an answer they should not have had. The fourth is worth a
decision rather than a note: `team_roster` declares `capability: null` — so
it is offered to EVERY signed-in member — and reports certifications-on-file
and what is missing on them, summarised from a page guarded by MANAGE_FIELD.
Its author reasoned explicitly about the primary citation (`/team`, open, "a
roster of who works here is not a tier"); the secondary one never came up.
Counts and gaps, not certificate records, which is why it is recorded here
rather than treated as a live breach. Gate the tool or drop the citation —
that is an access decision, not a cleanup, so this change does neither.

THE GUARD DERIVES ITS MAPPING rather than restating it: tool to cited pages
comes out of the citations `handlers.ts` actually emits, so it cannot drift
from them. Deriving has two failure modes and only one looks like failure
(CLAUDE.md), so the size checks run first — a parse that matched nothing
would otherwise pass every assertion after it, and breaking the HANDLERS
pattern now throws by name instead. The four known pairs are listed by hand
with a reason each, the same shape as commands.test.ts's OPEN_HANDOFF_PAGES,
and a third test deletes-or-fails any entry that has stopped being a
disagreement, because an exception list nobody prunes becomes permanent.

Three mutations, three caught, file restored byte-identical by sha256sum:
removing the `team_roster` entry names it and the page's guard; breaking
the HANDLERS regex throws "could not find the HANDLERS record"; adding an
entry that agrees fails the prune test naming it.

FEATURE-AUDIT Sheet 23 said "fifteen read tools" — true until 12 Sep, then
stale three times in six days. Corrected to thirty-nine, re-derived rather
than counted, with a note beside it saying not to re-add a number without
that derivation.

THAT CORRECTION WAS FALSE WITHIN FOUR HOURS, on this branch, before it
merged: #306, #307 and #308 each landed another tool. So the number moved
into a test that pinned it to `TOOLS` — and that is committed on this
branch, and then withdrawn, which is the part worth reading.

A DIGIT IN THAT ROW MAKES EVERY TOOL-ADDING PR EDIT THE SAME LINE. Two open
PRs that each add a tool then conflict there, and the second resolves it —
the `CHANGELOG.md` scar in CLAUDE.md, which cost four resolutions of one
conflict in a day across three PRs, and whose expensive part was not the
conflict but the CI that never queued behind it. Pinning the figure trades a
stale number for a serialised edit on a file two people share. Not a trade
worth making, and it was only visible because main added two more tools
while the first fix sat unpushed.

So the count goes where CLAUDE.md put the counter roll-call after the same
lesson: into the code, with nothing in the prose to maintain. `TOOLS` is the
count. The row states none, a tool-adding PR does not touch it at all, and
`plumbing.test.ts` fails the build if a count is written back — digits and
the spelled-out forms alike, since every stale version of this row used a
word. Asserting an absence is the vacuous shape this repo keeps getting
caught by, so the row is located first and that lookup is its own assertion:
renaming the row fails loudly instead of passing because nothing was found
to object to.

Four mutations, four caught, control passes: a digit re-added, a word
re-added, a bare count with no "read", and the row renamed away. Run against
the assertion logic standalone rather than through vitest — npm's registry
was 503ing for every package and this worktree could not install, having
pruned `@types/react` before the outage stopped it refetching. Said plainly
because "mutation-tested" here means watching a named test go red, and that
is not what happened; CI is what ran this file.

WHAT THE AUDIT CHECKED AND FOUND SOUND, recorded so nobody re-runs it: still
four model call sites and four metered features, all on `claude-opus-5`; the
handler dispatch is still an exhaustive `Record<ToolName, …>` so a missing
handler is a compile error; every one of the tools has an eval
case AND a test asserting it; `capability` is type-required so no tool can
omit it; and the bill-versus-bound split on `/settings/assistant` survives.

VERIFICATION, and the second half of it is a caveat rather than a figure.
The branch as first written ran clean locally: typecheck 0, lint 0 errors,
232 files / 3825 unit tests, 39 files / 449 database tests against a real
Postgres 16, production build exit 0 — and the citation guard was re-run
after merging main, 22 tests, with the tool roll-call confirmed at 41 union
names and 41 parsed handlers so the two tools that arrived meanwhile were
inside its scope rather than skipped by it.

Everything after that merge was verified by CI, not here: npm's registry
began returning 503 for every package and an interrupted install had
already pruned `@types/react`, so this worktree could not typecheck, test or
build. That is named rather than papered over, because a local suite nobody
could run is exactly the "reports done on the strength of plausible code"
shape CLAUDE.md warns about.
