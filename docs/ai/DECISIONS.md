# AI decisions — what was decided, why, and what is still open

The AI work on C Stream is a sequence of steps, and most of what matters about
it is not in any diff: which model a feature runs on, what a company may switch
off, what a refusal says, what we measured before believing a number. This file
is that record.

**Its rule, borrowed from CLAUDE.md because that file paid for it repeatedly: a
claim here carries a date and the evidence, or it does not go in.** A sentence
saying what the code does is perishable; a sentence saying what was MEASURED,
and when, stays true. Where something is unverified this file says so in those
words rather than leaving a reader to guess which half is which.

**Not a place for prose about features.** FEATURE-AUDIT.md says what exists,
`changelog.d/` says what each PR changed and why, and CLAUDE.md holds the rules
that bind every lane. This holds only decisions that are specific to AI and
would otherwise live in somebody's head.

---

## Step 0 — the switch, the model choice, the meter (2026-09-26)

### AI is behind a per-company switch, and absent means ON

`CompanyAiSettings`, one row per company, read by `aiGate` before every model
call. A master toggle plus a per-feature list plus a model override.

**Why at all:** nothing could turn AI off for one company. The gates were a
server-wide `ANTHROPIC_API_KEY`, per-person capabilities, courtesy rate limits
and a paid allowance — so the only way to stop the assistant for one customer
was to stop it for everybody, and a contractor who wants their drawings kept
away from a model had no answer.

**Absent is ON, and this is the default worth arguing about.** Every existing
company has no row the day the migration applies. Off looks like the careful
choice and would switch the product off under all of them at once with nothing
on screen saying why. Off is a decision somebody makes, not a state they
inherit.

**A subtractive list, not an additive one.** `disabledFeatures` names what is
off, so a feature shipped later works without every company opting in first.
The cost: a company cannot pre-refuse a feature that is not in the enum yet.
That is the right way round — but note that `PLAN_INGESTION` IS in the enum
before it is built, deliberately, so the switch is not retrofitted onto call
sites afterwards, and it is therefore pre-refusable today.

### The gate fails CLOSED

An unreadable settings row refuses, in a sentence, and never throws.

**Deliberately the opposite of the rate limit next door.** `askAllowance`
fails OPEN (#257) because a counter that will not read should not stop a person
working. This switch answers somebody who said their documents must not reach a
model; a switch that opens when it cannot read itself has not kept that promise,
it has kept it most of the time. Same family as the PAID cap, which also fails
closed.

**It costs nothing real.** Every caller is inside a request that has already
read the database several times, so a read failing here is a request that was
going to fail anyway.

### Every refusal is returned, never thrown

Production redacts a thrown Server Action message to a digest. A deliberately
disabled feature surfacing as "something went wrong" is the most confusing
possible outcome — worse than no switch, because the person turned it off
themselves and now cannot tell that from a fault.

### One consequence we are accepting, not hiding

With `COMPLIANCE_EXTRACT` off, **a compliance document cannot be filed at
all.** `uploadComplianceDocument` is the only path that creates one, and the
required `type` and `partyName` come out of the extraction, so there is nothing
to write. The refusal says so in as many words rather than reading as a fault.

A manual-entry path is the real fix. It is not built, and until it is, this
switch is more expensive to use than the others.

### Model choice moved out of the code

`claude-opus-5` was written inline in six places with no env var and no config.
`packages/integrations/src/models.ts` now resolves per feature:

1. the company's `modelOverride`
2. `ANTHROPIC_MODEL_<FEATURE>`
3. `ANTHROPIC_MODEL_DEFAULT`
4. the feature's default

**An unknown id is IGNORED, not passed through.** A typo'd or date-suffixed id
would 404 on every call for that feature and reach a person as "the assistant
is unavailable" — the same screen as a missing key, with nothing naming the
cause. `saveCompanyAiSettings` also refuses one on write; the two checks are
belt and braces.

**Model ids are never date-suffixed.** `claude-haiku-4-5`, not
`claude-haiku-4-5-20251001`. Checked against Anthropic's own docs rather than
written from memory.

### Plan ingestion defaults to Haiku 4.5; everything else to Opus 5

Diego's direction: high-volume page work may run on a smaller model, "with the
eval deciding whether it's good enough". Haiku 4.5 is $1/$5 per MTok against
Opus 5's $5/$25 — a fifth of the price on the one workload that runs three
hundred times per upload.

**This is a starting position, not a finding.** No eval has run. The eval
decides, and if it says Haiku is not good enough the fix is one line in
`models.ts`.

### The meter learned two things it could not record

- **`AskUsage.model` now holds the model that actually ran.** All six callers
  wrote `ASK_DEFAULT_MODEL`, which was right only while every feature shared
  one model. Nothing prices that column today; the cost work coming next will,
  and a Haiku call recorded as Opus is a fivefold overstatement waiting for the
  first person to multiply it out.
- **`AskUsage.jobId`**, at Diego's request, so "which jobs is this AI bill
  going on" is answerable. A plain column and NOT a foreign key: this is an
  append-only spend ledger, and a job deleted by the scratch cleanup must not
  take its billing history with it.

`AskUsage.promptVersion` exists and **nothing sets it yet.** It is here so that
when a prompt changes, the rows written before and after are tellable apart —
which is the whole basis of claiming a prompt change improved anything.
Retrofitting it would cost a migration and a month of unattributable rows.

### Plan sheets are metered separately from document pages

`AskAllowancePeriod.planSheetsUsed` and `failedPlanSheets`, and
`CompanyAiSettings.planSheetsPerMonth` (1,500 for the $399 plan — five
300-sheet sets a month).

**Why a third unit:** one 300-sheet drawing set is 300 pages, which is the
ENTIRE existing monthly page allowance. Without a separate unit, uploading one
plan set would leave a contractor no document allowance for the compliance
paperwork the same job needs.

**1,500 is a figure, not a measurement.** Whether it is sustainable depends on
measured cost per sheet, which step 2 produces.

### The allowance figure is not editable by the company

`planSheetsPerMonth` is deliberately absent from the settings form and from
both branches of the action's `upsert`. It is what the plan includes, not a
preference — a form that posted it would let an owner raise their own paid
allowance by editing one input.

### The switch is permanently not an Ask command

`aiSettings.*` is excluded in `lib/ask/commands/exclusions.ts`. Reachable from
a prompt, it would let the assistant be asked to re-enable itself. A model must
never hold the control over whether a model is used.

---

## Step 1 — the job runner (2026-09-27)

### Vercel is on Hobby, so a cron runs ONCE A DAY, and that decided the design

Measured, not assumed: pushing `*/5 * * * *` **failed the deployment outright** —
no deployment was even created — and Vercel's own error link resolves to
`vercel.com/docs/cron-jobs/usage-and-pricing`, which states that Hobby accounts
are limited to cron jobs running once per day and that more frequent expressions
"will fail during deployment". 100 jobs per project, minimum interval once per
day, ±59 minutes of precision.

**This is the most load-bearing fact about ingestion on this product**, because
the obvious architecture — a cron that works through a queue — would advance a
300-sheet plan set by one 45-second slice per day. It is not slow; it does not
work.

So the run is driven by the **open page**, calling `advancePlanIngest` in a loop,
and the cron is a once-daily sweep for runs whose tab was closed and which
nobody reopens. What makes both safe at once is the claim column: the browser, a
second browser and the cron can all advance the same job simultaneously, each
claim atomic.

**If throughput ever has to happen without somebody watching**, the fix is a Pro
plan plus one line in `vercel.json` — not a redesign. That is worth knowing
before anybody proposes moving ingestion to a background worker.

### The claim column needs a lease, or it makes things worse

A task claimed by an invocation that then dies is claimed *forever*, and the job
hangs one page short with no error and nothing to retry. **A claim column with no
expiry converts a resumable job into a permanently stuck one**, which is worse
than not being resumable, because a stuck job looks like a slow one.
`claimExpiresAt` is the reclaim, and `CLAIM_LEASE_MS` must exceed the run budget
or a lease expires under a worker still legitimately working — asserted in a
test, because those two constants live apart and somebody will tune one.

### `attempts` increments on CLAIM, not on failure

An attempt that dies before it can write anything is exactly what a page that
kills its worker produces. Counting failures would retry that page forever.

### Backoff needed its own column

Deriving it from `updatedAt` was the first design and is wrong: that column moves
for reasons that are not attempts. Without `nextAttemptAt`, three attempts can be
spent in three seconds inside one loop, or as fast as a person clicks Retry.

### The server CAN read a plan set — corrected 2026-09-29, and the shape of the error is the lesson

This section said: *"`PAGE_INVENTORY` records that a page was reached. `TakeoffPlan`
has no `pageCount` column because the server has no PDF library — the viewer knows
the count because `pdfjs-dist` runs in the browser. **So no server-side stage can
open a plan file at all until something rasterises it**, which remains the one
genuinely undecided piece of the ingestion design."*

**It was false, and it deferred three stages for a fortnight.** It conflates READING
a PDF with RASTERISING one. Measured rather than argued:

- `lib/ask/pageCount.ts` has parsed PDFs server-side, in production, for billing
  since it was written — a regex over the page tree with a `zlib.inflateSync` pass
  for 1.5 object streams. No pdfjs, no canvas.
- `pdfjs-dist` in **Node** gives `numPages`, the page box, the page's `/Rotate`, and
  `getTextContent()` with a position on every item. Only `page.render()` fails, and
  that is the one thing needing a canvas.

So `PAGE_INVENTORY` reads the file now and makes no model call; `TITLE_BLOCK` calls
the model over the stored text and never opens the PDF. Rasterisation is not merely
undecided — for a title block it is the WRONG instrument: an ARCH D sheet fitted to
the high-resolution tier's 2576px long edge is 65 DPI, which puts 1/8" lettering at
about eight pixels.

**Why it is worth this many words.** The sentence cited `TakeoffPlan`'s own schema
comment, which said the same thing — so it read as settled rather than as a guess,
and nobody re-checked it. A false claim with a citation is the most expensive kind
this file can hold. Four places repeated it and all four are corrected;
`lib/plan-ingest/planPdf.ts` now carries the measurements instead of the assertion.

The claim ALSO survived a correction pass that said it had been fixed: the PR that
corrected `actions/planIngest.ts` and the takeoff page reported six comments
corrected when four had been, and this was one of the two still standing. Grep for
the sentence, not for the intention.

## Step 2 — what it costs (2026-10-02)

This section was MISSING for five days while two others referred to it. Step 0
said *"Nothing prices that column today; the cost work coming next will"* and
step 1's allowance note said *"1,500 is a figure, not a measurement. Whether it
is sustainable depends on measured cost per sheet, which step 2 produces."*
There was no step 2, and an audit on 2026-10-01 found that nothing in the repo
computed a dollar cost for any model call. A reference to work that does not
exist reads exactly like a reference to work that does.

### A billed unit was counted and thrown away

`AskUsageTotals.webSearches` has carried the per-search count since lead search
shipped, with a comment on the field saying *"each one bills on top of tokens,
which is why it is counted apart from them"* — and `recordAskUsage` never put it
in the insert. So the two features that use web search, `lead-search` and
`bid-research`, were exactly the two whose cost could not be worked out.

`AskUsage.webSearches` exists now (migration
`20261002200000_add_ask_usage_web_searches`, additive, default 0). Rows written
before it read 0 whether any search ran or not, which is correct for the other
seven features and a FLOOR for those two: the API reported the real number at
the time and nothing wrote it down, so it is not recoverable. `cost.ts` knows
that date and any total spanning it says it is a floor rather than a figure.

### Rates are dated, and a cost is never stored

CLAUDE.md's rule is that derived state is never stored, because a stored figure
can disagree with what it was derived from. A cost is tokens times a rate, so it
is computed at read time — against the rate in force ON THE ROW'S OWN DAY, not
today's. Each model carries a LIST of rates with a `from` date; a price change
prepends an entry and every historical figure stays true. One mutable rate would
silently restate last quarter's bill.

### An unknown cost is a result, never a zero

Only two of the five rates were recorded anywhere in this repo — Opus 5 at
$5/$25 per MTok and Haiku 4.5 at $1/$5, in the step 0 section above. Cache
reads, cache writes and the per-search charge were not, and `pricing.ts` does
not invent them: the entire output of that module is a dollar figure somebody
multiplies out to decide whether an allowance is sustainable, and a confident
wrong price is the one kind of error nobody re-checks.

So an unset rate is `null`, not 0. A zero multiplies out to "this call was free",
which is indistinguishable from a cheap call and stops anybody asking. `costOf`
returns a discriminated result and every caller has to render the unknown case —
the type makes that unavoidable rather than polite.

It only needs the rates a row actually USED, which matters more than it sounds:
requiring all five would make every row in the app read unknown until the last
one was filled, and the per-unit figures this step exists for would stay
unavailable for no reason.

### The gate, and why a red build was the right shape

`pricingCensus.test.ts` FAILS while any rate a live feature needs is unset. That
is deliberate: it means the PR carrying step 2 cannot merge until the real
numbers are pasted in from the Anthropic console. `main` never goes red — the
gate sits on the change rather than on the branch everybody shares.

Once the rates are in it stops being a gate and becomes an ordinary census: a
model routed somewhere unpriced, a rate with no provenance, or a history that is
not newest-first will fail it from then on. Every rate must carry a `source`
saying where the figure came from and the day it was read, so a number cannot
arrive anonymously and cannot be checked against an invoice later without one.

### The rates, and a reconciliation that does NOT fully close

All five came off `platform.claude.com/docs/en/about-claude/pricing` on
2026-10-02, and two of them are a check rather than an addition: the page gives
Opus 5 at $5/$25 and Haiku 4.5 at $1/$5, exactly what this file recorded in
step 0. Two for two on the figures that could be checked is the reason the other
three are trusted.

    Opus 5     input $5     output $25   cache read $0.50  cache write $6.25
    Haiku 4.5  input $1     output $5    cache read $0.10  cache write $1.25
    web search $10 per 1,000

**Cache write is the 5-MINUTE rate, and that is a code fact rather than a
preference.** The page lists two — $6.25 and $10 for Opus, a 60% difference —
and `ask.ts` requests `{ type: "ephemeral" }` with no TTL, which is the 5m
default. `ask.ts` is also the ONLY call site that sets `cache_control` at all, so
cache tokens arise on Ask rows and nowhere else.

**The reconciliation against a real bill is PARTIAL, and saying so is the point.**
Diego's console for the 30 days to 2026-10-02: 2,385,121 tokens in, 43,035 out,
26 web searches, billed $21.53. Those three figures at the rates above come to
$13.26, leaving **$8.27 unexplained**.

The gap being POSITIVE is what makes it readable. If cache reads were hiding
inside "tokens in" at a tenth the price, the bill would be LOWER than predicted,
not higher — so there is billed volume the three figures do not include. About
1.3M cache-write tokens would account for it exactly; 16.5M cache reads would
also, and is not credible. Ask caches its system prompt and tool definitions on
every pass, so cache writes in that order over a month are unremarkable.

**And the console is a SUPERSET of what the app can ever report**, which is the
part worth carrying forward:

  - **The evals spend real money and write no ledger row.** There are eight
    `*.eval.ts` files and **not one of them mentions usage at all** — verified by
    grep rather than by naming three of them, because a roll-call of files is the
    kind of claim this repo has watched rot. `draftLines.eval.ts:228` passes
    `undefined` into the `onUsage?: ModelUsageReporter` slot
    (`anthropic.ts:374`), which is the shape of all of them. So every eval run
    bills Anthropic and leaves `AskUsage` untouched. 12 of those 26 web searches
    were eval runs on 2026-10-02 alone.
    Derive it rather than trust this: `grep -rl onUsage --include='*.eval.ts' .`
    should print nothing.
  - The key is org-wide. Anything else on it lands in the console and not in the
    app's rows.

So `/settings/assistant` reports what the PRODUCT cost, and the Anthropic
invoice reports that plus development. They are different questions and the
first will always read lower. A future step could report eval spend by passing a
reporter under a `feature: "eval"`, which would make the two reconcilable — it is
not done here, and the gap is recorded rather than left to be rediscovered as a
discrepancy.

**Status of the figures: sourced and dated, partially reconciled.** The next real
invoice with cache tokens broken out closes it. The `source` string on each rate
is what makes that check possible.

### The denominator comes from the allowance ledger

A cost per unit needs the unit the allowance is denominated in, and those counts
already existed on `AskAllowancePeriod`: `planSheetsUsed`, `addendumPagesUsed`,
`pagesUsed`, `questionsUsed`. Counting `AskUsage` rows instead would divide by
the wrong thing for three of the four — a plan-sheet row happens to be one
sheet, but one document read is one row and many pages, so a per-page figure
taken from rows would be the per-CALL figure wearing the wrong label.

`*Used` INCLUDES the failures, which is right for a cost: the claim increments it
before the call and `markAskAllowanceFailure` adds to `failed*` without taking
anything back, because a call that died halfway was still billed. The failed
count rides along so the screen can say how much of the month produced nothing.

### What this step does NOT decide

Whether a plan set belongs inside the $399 plan or is metered. That is Diego's
call and it was always going to be — this step exists to make it answerable
rather than to answer it. The per-unit figures on `/settings/assistant` are the
input; 1,500 sheets and 600 addendum pages remain figures rather than
measurements until a real month has run through a complete rate table.

## Step 3 — reading a bid addendum (2026-09-29)

### The reader writes nothing any other module reads

Not `BidAddendum.affectsPricedScope`, not `acknowledgedOn`, not `issuedOn`, not
`BidInvitation.dueDate`. It produces a list of what the document says it changed;
every assertion about the bid stays the estimator's.

**Why, and it was already decided.** `lib/ask/commands/estimating.ts` refused
`saveBidAddendum` to the assistant because "whether it changed work you already
priced is an estimator's judgement about drawings the assistant has not seen".
Reading the addendum gives the model the addendum — not the drawings, not the
estimate — so the objection stands unchanged.

**The design that was rejected, because the reasoning transfers.** The first
version proposed `affectsPricedScope` beside the human's tick, the
`DocumentIntake` pattern, and Diego approved it on that framing. A review asked
what the write would DO:

- accepting `false` overwrote a person's own tick, and the reprice warning plus
  the job's supersession banner both vanished — a model clearing a warning on a
  job somebody is building, with nothing recording it happened;
- accepting `true` did nothing, because `takeoff-currency.ts:141` supersedes only
  when `issuedOn` is set and a model-proposed date is deliberately inert text.

Destructive one way, a no-op the other. **Every decision that design quoted was
quoted correctly; none of them said what the write would do once made.**

### A decision belongs to the scope, not to the reading

`@@unique([bidAddendumId, normalisedReference])`. `PlanSheetProposal` can key on
the run because `pageNumber` is stable across runs; an addendum's items are not —
`ordinal` is per-run and the text is reworded on a second pass. Keying decisions
to a reading would discard them all on every re-read, which `plan-ingest.prisma`
and `intake.prisma` both refuse in their own words.

Proved in `addenda-readings.dbtest.ts` rather than argued: decide, re-read with a
different spelling, and the decision is still attached to the new item.

### Addendum pages are metered separately — a fourth unit

`AskAllowancePeriod.addendumPagesUsed` / `failedAddendumPages`, and
`CompanyAiSettings.addendumPagesPerMonth` (600).

**Why not the document-page ledger**, which `quoteRead.ts` argues for and which
was the plan's first answer: it checks the per-document CEILING and never the
MONTH. An addendum is ~8 pages against a 100-page ceiling, so one fits — but 20
bids with 3 addenda each is ~480 pages against a 300-page month shared with Ask
and with the compliance paperwork the won job needs. This is the plan-sheet
argument arriving again; the two differ only in how the volume shows up.

**600 is a figure, not a measurement**, exactly as 1,500 was for sheets.

### Opus, not Haiku, and the volume test is why

An addendum reader is 2-6 documents per bid against the quote reader's one, so it
is more volume — but `models.ts`'s rule is not "more than one", it is that every
feature is Opus unless Diego asked otherwise, and he asked for one thing:
high-volume page work. Three documents is not three hundred pages, and the
per-document stakes are a quote's. An eval may reverse it; this entry may not.

### The whole PDF goes to the model, not extracted text

GC addenda are routinely scanned and a scan has no text layer. `plan-ingest`
reads text instead, and that is a COST rule about 300 pages per set rather than a
capability — at one document per click there is nothing to save.

## Open questions

Recorded so nobody re-derives them, and so a later claim can be checked against
what was actually known.

- ~~**Cost per plan sheet is unmeasured.** The $15–$40 classification estimate in
  the step 1 plan was made on an Opus basis and needs redoing for Haiku before
  anybody quotes it.~~ **MEASURABLE AS OF 2026-10-02, and not yet measured** —
  which is a different state from either and worth the distinction. Step 2 above
  computes cost per sheet from recorded tokens, and `/settings/assistant` shows
  it. What it cannot do yet is report a number: three of the five rates are
  unconfirmed, so the figure reads "not priced" until they are pasted in, and
  then a real month has to run through them. The $15–$40 estimate is superseded
  rather than corrected — it was a guess about a different model, and there is
  now an instrument instead of a better guess.
- ~~**Whether Haiku 4.5 is accurate enough for sheet classification and title
  blocks.** The eval decides. Nothing is known yet.~~ **ANSWERED 2026-09-29, and
  it had been answered for a day before anybody wrote it here.** The eval ran on
  `plan-title-block.1` against nine synthetic sheets:

  ```
  requested 9, returned 9
  sheet number: 9 correct, 0 INVENTED, 0 WRONG, 0 missed
  calibration:  0 OVERCLAIMED
  other fields: 1 off (reported, not fatal)
  ```

  `requested 9, returned 9` first, so the numbers are over the whole suite rather
  than over however many cases survived. **Nothing over-claimed** is the one that
  matters, because this file says the metric is false confidence rather than
  accuracy: a count that is 85% accurate and reads as certain is a wrong bid.

  Bounded the way the eval's own header bounds it: clean, digitally generated
  sheets. What it measures is the JUDGEMENT — a reference mistaken for the
  sheet's own number, a missing number invented, a date reformatted.

  **The delay is the lesson, not the result.** The eval ran, it answered this
  file's own open question, the answer went into a PR body, and the file whose
  entire charter is "a claim here carries a date and the evidence" was left
  saying nothing was known. A question marked open long after it closed is the
  same defect as a claim left standing after it went false — it just fails in the
  direction nobody checks.
- ~~**The 250MB upload ceiling for plan sets is not built.**~~ **BUILT, #551,
  2026-09-28.** This entry existed because the ceiling had simply been dropped,
  and it predicted its own ending correctly: "if it is forgotten, the first real
  plan set is refused at 15MB with a sentence on screen. It announces itself." It
  did, on 2026-09-27.

  It was right about the shape of the work too — not a constant bump, but a
  per-target ceiling. `DocumentUploadTarget.maxBytes` is REQUIRED now, so the
  compiler makes a new purpose decide rather than inherit, and only
  `plan-takeoff` moves. **So the paragraph this entry used to carry, describing
  `DOCUMENT_UPLOAD_TARGETS` as having "no per-target byte cap", is also retired:
  it does.**

  **What it got WRONG is the part worth keeping.** It said the deferral was safe
  because a 250MB buffer "would OOM a Vercel function" and needed a ranged pdfjs
  read first. Both measured, both false:

  | | |
  | --- | --- |
  | 119MB set, 900 pages, 200 read | peak RSS never rose above the process baseline, while extracting 112,092 characters |
  | the ranged read, `disableAutoFetch` | 203 Range requests serving 25.8MB for a 12.9MB file |

  The proposed fix bounds nothing — it fetches the whole document in pieces and
  pays for the round trips — and the hazard it was for does not exist, because
  pdfjs is lazy and `page.cleanup()` releases what a page needed. The cost is the
  buffer, not the document.

  Writing that down found a real bug before it shipped: `openPlanPdf` passed
  `new Uint8Array(bytes)`, which COPIES a Node Buffer. Invisible at 15MB, 250MB of
  avoidable peak at the new ceiling — enough to make the measurement above wrong
  by a factor of two.

  Still uncovered, and no laptop can cover it: a Vercel function's real memory
  ceiling. If a large set kills an invocation, that constant is the number to
  change and the ranged read is not the alternative.

- ~~**`promptVersion` has no writer, and forgetting THAT is silent.**~~
  **WRITTEN, #551.** `titleBlock.ts` passes `PLAN_SHEET_PROMPT_VERSION` on every
  usage row, and `promptVersionCensus.test.ts` is the guard this entry asked for:
  a versioned prompt whose usage rows omit the version fails the build. It
  anchors on `feature: "..."` inside the object literal rather than on
  `recordAskUsage(`, because the first draft did the latter and went green — the
  call site is `deps.recordUsage(...)`.

  This entry asked to be replaced by a test rather than kept as a note, and said
  why: "'nobody has fixed X' is a claim with an expiry date, and this paragraph
  is one. The test is what outlives it." It did.

- **What a plan set should cost, and whether it belongs inside the $399 plan or
  is metered.** Unanswered. The figures in this file — 1,500 plan sheets, 600
  addendum pages — are Diego's for the $399 plan and neither is a measurement.

- **Whether symbol-counting can reach a precision an estimator would accept.**
  Unanswered, and it gates the takeoff-from-drawings work rather than anything
  shipped.
