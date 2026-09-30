### An addendum reads itself — what it changed, for the estimator to judge (Diego)
`diego/addenda-read`

A GC issues an addendum mid-bid. It revises the partition types, moves a corridor,
adds a form to the bid packet, moves the bid date. The estimator reads twelve
pages and logs one row: a reference, two dates they type, a boolean, a note. The
app knows the row exists and nothing about what the letter said.

So the fear the feature exists for was unaddressed — that something changed and
nobody noticed. On a bid that is not a near miss: a non-responsive bid is rejected
unread, and a bid priced against superseded scope is won at a loss.

This attaches the GC's PDF to the addendum, reads it, and lists what it says it
changed — per item, with the reason it was read that way and the page to check it
on. Lowest confidence first. A person marks each scope as theirs or not, and where
two addenda on one bid name the same scope, it says so.

**IT WRITES NOTHING ANY OTHER MODULE READS**, and that is the design rather than a
limitation. Not `affectsPricedScope`, not `acknowledgedOn`, not `issuedOn`, not
the bid's due date. No verdict on any bid or any job changes because somebody read
an addendum — `bid-responsiveness.ts` and `takeoff-currency.ts` cannot tell it
happened.

**The first design did the opposite, and the review that killed it is worth more
than the feature.** It proposed `affectsPricedScope` beside the estimator's own
tick, the `DocumentIntake` pattern, and I asked Diego to choose it — which he did,
on my framing. The review asked the question I had not: what does the write DO?

| accepting | what actually happens |
| --- | --- |
| `false` | overwrites a person's own tick. The reprice warning and the job's supersession banner both vanish — a model clearing a warning on a job somebody is building, with nothing recording that it happened |
| `true` | **nothing.** `takeoff-currency.ts:141` supersedes only when `issuedOn` is set, and a model-proposed date is deliberately inert text — so it lands in `undatedAddenda` and changes no verdict |

One direction destructive, the other a no-op. There was no version of that field
that worked. And `lib/ask/commands/estimating.ts` had already settled it when it
refused `saveBidAddendum` to the assistant — *"an estimator's judgement about
drawings the assistant has not seen"* — which reading the addendum does not
change, because the drawings and the estimate are still not in the request.

The transferable part is narrower than "don't let a model write". **Every decision
that design quoted was quoted correctly. None of them said what the write would do
once made.** `takeoff-currency.ts:141` is two lines below a comment I had cited.

**Decisions are keyed on the addendum and the scope, never on the reading**, and
this is the other thing the review caught before it shipped. `PlanSheetProposal`
survives a re-run because `pageNumber` is a stable natural key — page 12 is page 12
in every run. An addendum's items have none: `ordinal` is the model's ordering
within one run, and the reference and summary are free text a second pass words
differently. Keying decisions to a reading would discard every one of them on every
re-read, presenting the whole list afresh as though nobody had looked — the exact
thing `plan-ingest.prisma` and `intake.prisma` both refuse.

`@@unique([bidAddendumId, normalisedReference])` fixes it by construction, and is
better on the merits: what an estimator decides is that **a scope** is or is not
theirs, which stays true when the wording changes. `addenda-readings.dbtest.ts`
proves it against a real Postgres — read, decide, re-read with a different
spelling, and the decision is still there and still attached to the new item.

**A fourth metering unit**, which the plan argued against and was wrong about.
`quoteRead.ts` says a second ledger for a second kind of document is how a bill
stops adding up, and that rule does not cover this: it checks the per-document
CEILING and never the MONTH. An addendum is eight pages against a hundred-page
ceiling, so one fits — but twenty bids with three addenda each is ~480 pages
against a 300-page month shared with Ask and with the compliance paperwork the job
they *win* will need. That is `DECISIONS.md`'s plan-sheet argument arriving again,
differing only in how the volume shows up: a plan set spends it in one click,
addenda spend it eight pages at a time on every bid. **600 a month is a figure, not
a measurement.**

**The whole PDF goes to the model, not extracted text.** GC addenda are routinely
scanned, and a scan has no text layer. `plan-ingest` reads text instead, but that
is a cost rule about three hundred pages per set rather than a capability — at one
document per click there is nothing to save and a scan would simply fail.

**Smaller things, each a scar somebody else already paid for.** A 30-second
double-read guard, because readings are append-only so nothing in the schema stops
a double-click buying two — `plan-ingest` has a unique index for exactly that, and
there is no natural key here to put one on. The re-read button says how many times
the addendum has been read and that reading again charges again, *before* it is
pressed. `deleteBidAddendum` now deletes the stored PDF, which it did not need to
do until this PR gave it one to strand. And `fileUrl` is the one column on
`BidAddendum` the CSV export withholds: uploads are `access: "public"`, so that URL
is a permanent unauthenticated key to a customer's bid document, and a CSV is a
file that gets forwarded.

**Three stale claims fixed in passing, because this PR is the one that makes them
false.** `ai-settings.prisma` and — worse — the *user-facing* description on
`/settings/assistant` both still said plan-set reading was "not built yet", three
weeks after #551 built it. And `docs/ai/DECISIONS.md`'s open questions still said
the 250MB ceiling was unbuilt, that `promptVersion` had no writer, and that nothing
was known about Haiku's accuracy — when the eval had run 9/9 with nothing
overclaimed and the result was never written into the file whose entire charter is
to record it.
