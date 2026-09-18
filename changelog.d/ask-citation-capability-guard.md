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
which went from fifteen to forty-one in ten days.

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
merged: #306 and #307 each landed another tool and the figure is 41. A
derivation nobody re-runs is a claim with an expiry date, which is what
CLAUDE.md says about the counter roll-call it moved into a test for exactly
this reason. So this one moves too — `plumbing.test.ts`, which already holds
FEATURE-AUDIT to its own arithmetic, now holds this figure to `TOOLS`. The
count side is IMPORTED, not parsed, so only the doc side is a regex and it
gets its own "did this match anything" assertion first. Adding a read tool
now fails the build naming the row: a one-word edit inside the PR that adds
the tool, which is working agreement rule 1.

Both mutations were run against the assertion logic standalone rather than
through vitest, because npm's registry was 503ing for every package and this
worktree could not install: the figure off by one fails the compare, the row
reworded to "forty-one" makes the regex find nothing and trips the
did-this-match-anything test. Said plainly because "mutation-tested" in this
repo means watching a named test go red, and that is not what happened here;
CI is what actually ran this file.
The row also predated dictation (#302 — the BROWSER's own
`SpeechRecognition`, so it bills nothing and is correctly unmetered),
bounded conversation memory (#297 — twenty turns, two thousand characters
each), page context and the discoverability surface; all four are now named.

WHAT THE AUDIT CHECKED AND FOUND SOUND, recorded so nobody re-runs it: still
four model call sites and four metered features, all on `claude-opus-5`; the
handler dispatch is still an exhaustive `Record<ToolName, …>` so a missing
handler is a compile error; every one of the tools has an eval
case AND a test asserting it; `capability` is type-required so no tool can
omit it; and the bill-versus-bound split on `/settings/assistant` survives.

Typecheck 0, lint 0 errors, 228 files / 3771 unit tests, 39 files / 449
database tests against a real Postgres 16, production build exit 0.
