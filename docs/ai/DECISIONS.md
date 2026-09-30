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

## Open questions

Recorded so nobody re-derives them, and so a later claim can be checked against
what was actually known.

- **Cost per plan sheet is unmeasured.** The $15–$40 classification estimate in
  the step 1 plan was made on an Opus basis and needs redoing for Haiku before
  anybody quotes it.
- **Whether Haiku 4.5 is accurate enough for sheet classification and title
  blocks.** The eval decides. Nothing is known yet.
- **The 250MB upload ceiling for plan sets is not built, and this entry exists
  because it was simply dropped.** Diego approved it as part of step 0 — 250MB
  for plan sets only, direct-to-storage — and step 0 shipped without it and
  without recording it, which is the failure this file is supposed to prevent.
  It surfaced only because he asked whether step 0 was complete.

  What it actually takes, checked rather than assumed: it is **not** a constant
  bump. `DOCUMENT_UPLOAD_MAX_BYTES` is a single global 15MB, and
  `DOCUMENT_UPLOAD_TARGETS` carries `root`/`scope`/`capability`/`refusal` per
  target with **no per-target byte cap** — so "plan sets only" means adding
  per-target ceilings plus a plan-set target that does not exist yet. Job media
  already caps per kind (25MB a photo, 200MB a video, enforced at the moment
  the token is minted), so there is prior art to copy rather than invent.

  It rides with ingestion deliberately, because a raised ceiling with nothing
  uploading a plan set is a number no test can exercise. **Carrying it is safe
  in a way the entry below is not: if it is forgotten, the first real plan set
  is refused at 15MB with a sentence on screen.** It announces itself.

- **`promptVersion` has no writer, and forgetting THAT is silent.** It gets one
  when prompts become versioned files, in the step that first changes a prompt.

  The asymmetry with the entry above is the point, and it changes what has to
  be built alongside it. A missing cap shouts; a missing prompt version does
  not — rows accumulate with `null`, nothing breaks, and the first time somebody
  claims a prompt change made anything better, the rows cannot be attributed to
  either version. That is this repo's most expensive recurring shape.

  So the guard is built WITH the first prompt file, not after it: a census that
  fails the build if a usage row can be written for a feature whose prompt is
  versioned without carrying a version. A note in this file is not sufficient
  and saying so here is not a contradiction — CLAUDE.md's own lesson is that
  "nobody has fixed X" is a claim with an expiry date, and this paragraph is
  one. The test is what outlives it.
- **A manual-entry path for compliance documents**, so switching document
  reading off does not stop filing. Not built.
- **Whether the Ask loop's `recordProposal` should carry a company's model
  override.** It records `ASK_DEFAULT_MODEL` — the process-wide default — as
  "which model proposed this write". With an override in play that is wrong,
  and threading the resolved model through `CommandContext` for an audit column
  was judged out of scope for step 0. It is a known small inaccuracy, not an
  oversight.
