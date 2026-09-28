### A plan set reads itself: what each sheet says, proposed for an estimator to confirm (Diego)
`diego/plan-ingestion`

A 300-sheet PDF landed on a job and the app knew nothing about it — an estimator
hunting the partition schedule opened sheets one at a time. #538 shipped the
resumable runner that can walk 300 pages and deliberately gave it no work to do.
This is the work: per page, read the title block and propose a sheet number, title,
discipline, scale, revision and issue date; then a screen where a person confirms or
corrects each one.

**Six comments said this was impossible, and the premise was false.**
`takeoff.prisma`, `stages.ts`, `actions/planIngest.ts`, `takeoff/page.tsx` and
`docs/ai/DECISIONS.md` all said the server had no PDF library and could not open a
plan file "until something rasterises it". Both halves were wrong, and the second
is the one that cost a week: **it conflates reading a PDF with rasterising one.**
`lib/ask/pageCount.ts` has counted PDF pages server-side for billing since it was
written, and `pdfjs-dist` — already a production dependency — gives page count,
sheet size, `/Rotate` and positioned text in Node. Only `page.render()` fails,
because that is the one thing needing a canvas, and nothing here calls it.

**Rasterising would not have worked anyway, which is why this reads TEXT.** An ARCH
D sheet is 36 inches wide; fitted to the high-resolution tier's 2576px long edge
that is 65 DPI, putting the 1/8" lettering a title block uses at about **eight
pixels tall** — four and a half on the standard tier. The vector text is already in
the file. Rasterising throws away the only legible copy of the thing we came for and
costs four to eight times as much per page for the privilege.

**The rotation bug is the one worth reading about.** `getTextContent()` reports
positions in UNROTATED user space; `getViewport()` applies the page's `/Rotate`, as
`takeoff.prisma` already said of the viewer. AutoCAD exports plan sheets rotated
routinely, so a raw x/y title-block filter reads a strip down the **wrong edge** on
exactly those sheets — and hands the model a region with no title block in it, which
then looks like the model failing. Mutation-proven rather than asserted: the
rotation-unaware version turns `/Rotate` 180 and 270 red and leaves 0 and 90 green.
Two of four cases discriminate, recorded as two rather than rounded up to four. The
load-bearing fact is that **0 stays green** — a suite with only an unrotated sheet
in it would have shipped this.

The fixtures had to learn the same thing. A real title block appears bottom-right
*as somebody looks at the sheet* whatever `/Rotate` says — that is what `/Rotate` is
for — but the user-space corner that lands there is a different corner per rotation,
measured out of pdfjs rather than derived. The first fixture wrote the block at the
user-space bottom-right and rotated the page, which moves it: a sheet nobody
produces, failing for reasons unrelated to the code.

**The work is split across two stages because everything expensive was being paid at
the wrong grain.** A stage that both parses a 15MB PDF and calls a model is paced by
the model — about 2.5s a page, so a 5-second Server Action slice fits one or two
pages and refetches the whole file for each pair: **two to four gigabytes of egress
for one 300-page set.** So `PAGE_INVENTORY` does the PDF work and makes no model
call, which lets it run at the full budget — ten to twenty pages a browser slice,
around a hundred a cron tick, one fetch each — and `TITLE_BLOCK` reads rows. That is
also what makes a retry cost one model call and no parse.

**A scanned sheet is a FACT, not a failure**, and the difference is money.
`WorkOutcome`'s error renders beside a Retry button, and "no text layer" is
permanent: as a refusal it fails three times with backoff, spends three sheet
claims, and leaves a button that can never succeed. A wholly scanned 300-page set
would have produced **900 claims and a 300-row retry list**.

**The proposal row is keyed on the RUN, not the page.** `PlanIngestJob` supports
re-running a stage, so keyed on the page a second `TITLE_BLOCK` pass would overwrite
a proposal an estimator had already accepted beside — destroying the one question the
proposed/accepted pair exists to answer. Append-only per run, the shape
`TakeoffScaleCalibration` already uses: the newest row is the active one, derived at
read time.

**`TakeoffPlanPage.label` is still typed by a person, and accepting a proposal does
not write it.** That column's comment refuses a label "parsed off the title block",
and the distinction that matters is not human-versus-machine but **authored versus
not-noticed**: a typed label is somebody asserting, an accepted label on row 147 of
300 is somebody failing to notice. `lib/intake/review.ts` reached the same conclusion
first — "a label promising it before it exists is how a demo becomes a lie."

**The page count now comes out of the file, and the message you kept hitting is
gone.** This panel used to be handed `plan.pages.length` — the number of *calibrated*
sheets, zero on a freshly uploaded set — so the button was disabled and the advice
was "open this plan set in the viewer first", which was asking somebody to do
unrelated work to satisfy a limitation that did not exist. That sentence was fixed
twice before it was deleted, which is its own lesson: a message needing two fixes is
usually a message that should not exist.

**`promptVersion` gets its first writer anywhere in this app, and its census — which
was vacuous on the first attempt.** `docs/ai/DECISIONS.md` argued the guard must ship
WITH the first prompt file, because a missing cap shouts and a missing version does
not: rows accumulate with null and nothing breaks until somebody tries to attribute
an improvement to a prompt and cannot. So the census was written. It searched for
`recordAskUsage(` — and the stage injects its ports so it can be tested without a
database, so the call there reads `deps.recordUsage(…)`. **Deleting the version left
the census green.** A guard for one silent defect, blind to that defect at its only
call site, is worse than none: it would have been cited as evidence. It is anchored
on `feature: "plan-ingestion"` now — the string the ledger's own column holds — and
walks out to the enclosing object, so a wrapper, a helper or an injected dep cannot
hide it. All three mutations red.

**The gate census caught the same shape first, and was right.** The stage's first
draft injected `typeof aiGate`, so the literal call lived at the call site and
`aiFeatureGateCensus` could only see `deps.gate(...)`. A swappable gate is exactly
the hole it exists to close. The feature is bound once in the production wiring now,
and the dep's type no longer accepts a feature at all — passing the wrong one is
unrepresentable rather than merely unlikely.

**Gaps are deliberately not flagged.** The plan said "duplicate sheet numbers and
gaps", and a gap detector is the obvious other half. On real numbering it would be
wrong far more often than right: A-101 followed by A-201 is the elevations series
starting, not a hundred missing sheets. Sets skip cancelled numbers, restart per
discipline, and write A2.1 as readily as A-201. A caution that is usually wrong is
worse than none — the defect the quote reader paid for twice. Duplicates are
unambiguous and are flagged; gap detection needs a rule about SERIES, and that is its
own work with its own evidence.

`claimPlanSheet` finally spends the meter that step 0 built and nothing incremented:
`planSheetsUsed`, `failedPlanSheets`, and a 1,500-a-month ceiling on
`CompanyAiSettings`. One sheet at a time, claimed before the call, failing closed,
marked-never-released — and the order has its own test and its own mutation, because
a gate checked after a claim charges a company that said no, 300 times.

Migration `20260928210000_add_plan_sheet_proposals` is additive: two tables, two
enums, five indexes, five foreign keys, nothing dropped. Both tables CASCADE from
`TakeoffPlan`, which keeps them out of `HANDLED_MODELS` and both cleanup `del()`
orders — the trick that model's own comment documents.
