### Ask answers now hand you the record, not just the news (Diego)
`claude/prova-ai-task-completion-96pjes`

Diego asked the box what needed his attention. It named three things on one
GC — a follow-up nine days overdue, a prequalification, an MSA — and then
left him to go and find each of them by hand. The answer was right and the
next step was still manual.

WHAT WAS ALREADY THERE, which is why this is small. Every alert carries an
`href` whose own comment reads "Where to go and do something about it", and
`needs_attention` was already returning it per row as `where`. It went to the
model, which narrated it away. The destination existed and never reached the
screen.

`ToolResult` gains `links?: ItemLink[]` — per-record destinations, distinct
from `citations`. A citation answers "where did this figure come from" and is
a PAGE; an item link answers "take me to the one you just told me about" and
is a ROW. They render separately and the links go first, because "deal with
this" is the next thing a person wants and "where did this come from" is what
they want when they doubt it.

THE MODEL NEVER SUPPLIES AN HREF. `links` is not in `data`, so it is not in
what the model is shown, and nothing parses hrefs back out of its prose. A
link the model wrote would be a link it could invent — a confident button to
a record that does not exist. Same rule as the numbers: the model narrates,
it does not compute.

A BUTTON IS A STRONGER PROMISE THAN A CITATION, and that turned out to
matter. A citation says "this came from there"; a button says "go here and
deal with it". So the handler filters its links through `canReach` rather
than trusting that the alert list already did — and writing the census to
check that assumption found a real bug that predates this change:
**RETAINAGE_RELEASE is gated MANAGE_BILLING and points at `/closeout`, which
is MANAGE_JOBS.** ACCOUNTING holds the first and not the second, so an
accounts person is already shown "Retainage on X is collectable" on /alerts
and already gets refused when they click the row. This change does not make
it worse — the filter means no button is offered — and does not fix it,
because there is no one page everyone holding MANAGE_BILLING can open:
`/cash-flow` is VIEW_COMPANY_FINANCIALS, which PROJECT_MANAGER deliberately
lacks. Recorded in `itemLinksCensus.test.ts`'s KNOWN_UNREACHABLE with a prune
test, for a decision: retarget the alert, widen ACCOUNTING, or split it by
audience.

THE CENSUS READS TWO FILES, AND THE SECOND ONE IS THE LESSON. Its first
version read `alerts.ts` alone and reported RENEWAL as having no href —
because RENEWAL copies `renewal.href`, built in `renewals.ts`. A census that
cannot see the file cannot find the bug in it, and no size assertion catches
that: nothing is ever missing from a directory you do not walk. Adding a
third source of alert hrefs fails the size assertion by name until it is
added to the list.

Stored transcript entries carry their links too, through the same validator
citations get — relative in-app hrefs only, no protocol-relative, label
capped. That rule is load-bearing here rather than defensive: a stored
transcript is browser input, and this one renders as a control.

Capped at six per answer. Without a cap, "what needs my attention" on a busy
company renders the whole alert page as a stack of buttons under a
three-line answer, which is the alert page again, rendered worse. The handler
orders them most urgent first, so truncating keeps the ones that matter.

Three mutations on the census, three caught, files restored byte-identical by
sha256sum: a new unreachable routing is named with its file and line; the
known-bad routing silently fixed fails the prune test; and breaking the
parser fails the SIZE assertion with thirteen kinds rather than passing
vacuously with none.

typecheck 0, lint 0 errors, 302 files / 4,936 unit tests, production build
exit 0. No schema change, no migration.

NOT DONE HERE, and worth saying: `needs_attention` is the only tool emitting
links so far. It is the one with a real destination per row already built.
Every other tool needs its own answer to "which record, and can this person
open it" before it gets buttons.
