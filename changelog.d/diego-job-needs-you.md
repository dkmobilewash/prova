### What this job needs from you

One list at the top of a job, worst first, with a link straight to each thing.
It shows only when something is waiting.

### It is the widening `estimate-stage.ts` asked for

That module answers "where has the estimate got to, and therefore what has to
happen next" for the jobs LIST, and its own header names four things it
deliberately cannot consult there — the bid recap, bid responsiveness, takeoff
currency, and any cost figure — ending:

> Widening the function to take those inputs is a real option and a bigger
> change: it would make a jobs-list cell depend on three more queries per row.

The job PAGE is where those queries are affordable, because it is one job rather
than a page of them. So this is not a second opinion about the estimate; it is
the first one, with the parts a list cell could not pay for.

**It judges nothing itself.** `estimateStage`, `proposalPriceState` and
`takeoffCurrency` each decide their own question and `jobNeeds` orders their
answers and writes the sentence. A second implementation of "is the markup
stale" would be a second answer, and on the day they disagreed the one on this
screen is the one somebody would act on. It takes RESULTS and not rows for the
same reason: a function handed raw line items could re-derive, and eventually
would.

The rows, in the order they appear and for the reason they appear in it:

| row | why it is where it is |
| --- | --- |
| the bid deadline | the only item with a date. Everything else can wait a day; a bid posted late is worth nothing |
| re-measure N quantities | the drawings they came off have been superseded. Ahead of the money, because a markup applied to wrong quantities is still a wrong number |
| apply / re-apply the bid recap | wrong prices on a document a GC reads, wrong in the direction that loses money |
| check the walls found on a sheet | the step detection deliberately stops before — a person decides what they are made of |
| where the estimate has got to | the broadest, so last. `estimateStage`'s OWN words, so the job and the jobs list cannot drift apart |

**What it refuses to say is the half that keeps it worth reading.** A row that
asks for nothing teaches people to stop reading the rows that do, so:
OUT_FOR_SIGNATURE is omitted entirely (its own detail reads "Nothing to do here
until they sign"); a plan with no issue date is not reported as superseded,
because there is nothing to DO about the common case of an undated drawing; a
won job stops nagging about its old bid deadline; and the whole card is absent
rather than showing an empty state.

### One money judgement, not two

Assembling the recap state was forty lines inside
`jobs/[id]/proposal/page.tsx`, and this list needed the same answer. Copying it
would have put a second money judgement in the codebase, visible only as a job
page saying the markup is fine over a proposal printing un-marked-up prices. It
is `recapStateFor` now, called by both, and the two nuances the page documented
moved with it: `budgetedUnitCost` rather than the PM's live re-forecast (#512),
and the job's own recap row rather than `CompanyBidDefaults`.

**AND IT TURNED OUT TO HAVE NO TEST, WHICH IS THE REAL FINDING.** The lift was
meant to be behaviour-preserving and the whole suite agreed — 11,100 tests
green. Then three mutations of the lifted function stayed green too: dropping
`appliedAt` (an applied recap reads as never-applied, so the list would tell
somebody to apply a markup already in the prices — which, acted on, marks the
bid up twice), dropping `appliedTotal` (a stale recap cannot be detected), and
dropping the cost the markup is applied TO.

So the refactor was unverified, and so was the page before it. What the
mutations measured was not the lift; it was the absence of a test that had been
missing all along. `recap-state.test.ts` covers it now, including a case where
`currentEstimatedUnitCost` is set to ten times the budget, so reading the wrong
field is a visible 2,000 against 200.

### The feature rendered nothing and every test passed

Replacing the render condition with `{false && (` left **all 11,111 tests
green**. A whole feature, assembled, tested, and invisible — the expo-router
shape CLAUDE.md records, where three plausible fixes shipped green and rendered
nothing.

`job-needs-render.test.ts` renders the real page and looks for the words, so
that mutation is red. It also pins what the unit tests cannot see: the list sits
ABOVE the printable summary (it is the only part of the page about what to DO;
everything below is a record of what the job IS), and it is `print:hidden`,
because a contract a client signs must not carry the estimator's to-do list.

### The honest bound on "walls waiting"

Accepting a found group writes a `TakeoffMeasurement`, and nothing links that
measurement back to the proposal it came from — so an accepted group and an
un-accepted one are indistinguishable.

This counts a sheet only when it has proposals AND NO MEASUREMENTS AT ALL, the
one case where "nobody has accepted anything here" is certain. It therefore goes
quiet after the FIRST acceptance on a sheet even with five groups left, and that
is the right direction to be wrong in: the list is worthless the moment it nags,
and the signal worth having is "C Stream found walls and you have not looked at
them yet". Making it exact needs a link from measurement to proposal, which is
its own change.

### Why the queries are a loader

They were inline on the page and broke `schedule-visibility.test.ts` — three new
models to stub in a file about who can see the schedule box, and the same tax on
every future test that renders this page. The page already had two neighbours
doing it right: `loadJobDocuSign` and `loadJobPaperworkCounts` are one line each
to mock. `loadJobNeeds` is the third, and that test is one line again.

### Verified

- `718 test files, 11,116 tests`, typecheck and lint clean
- **11 of 11 mutations red** with a no-op control green, plus the two rendering
  mutations above
- a walkthrough step was added rather than the `data-tour` anchor dropped —
  `walkthroughCensus` offered the choice and this list is the new first thing on
  the page

### Noticed, not fixed

**CLAUDE.md's job-page section slots are stale.** It says Diego owns
`apps/web/app/(app)/jobs/[id]/page.tsx` with "fixed section slots: Retainage →
Field Reports → Pay Apps". That file does not exist: the page became tabs on
2026-09-20 (`job-detail.ts`'s own comment records the split), and those three
sections now live on `(tabs)/billing/page.tsx` and `(tabs)/field-reports/page.tsx`.
There is no single page with three ordered slots any more. Left alone here
because an audit ships alone, per the working agreement's own exception.
