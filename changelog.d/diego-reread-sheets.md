### A fix to the reader reached no plan already uploaded (Diego)
`diego/reread-sheets`

`PAGE_INVENTORY` records what each page of a plan set says — and, since #655,
the scale the sheet declares about itself. That is DERIVED data, so it goes stale
the moment the code deriving it improves.

**And there was no way to re-run the stage from the app at all.** The "Read the
sheets" button is replaced by the paid title-block one the instant the pass
completes, so a finished set had no reading control left. #662 stopped the app
proposing a calibration line it would then refuse — and that changed **nothing**
for any plan already in the app. The only route to the fix was to delete the plan
and upload it again.

Found by a click-through that was asked to re-read three sets, could not, and
**correctly stopped rather than press the button beside it** — which costs a
sheet allowance per page (29 of them on one set) and proposes sheet numbers
rather than scales. The report was right on every point; the instruction naming a
button that does not exist was mine.

**The server already allowed this.** `startPlanIngest` blocks only a run still in
flight — `where: { planId, stage, finishedAt: null }` — so a finished pass never
blocked a new one. Every row the stage writes is an upsert keyed on
`(planId, pageNumber)`. Only the control was missing.

So: **"Read the sheets again — costs nothing"**, offered beside the title-block
button once the free pass is complete. It says its price on the button because
the paid one sits next to it naming a sheet count, and a reader who cannot tell
them apart will press neither.

## What the dbtests hold

A second pass must REPLACE the row rather than add one, or "which scale does this
sheet have" becomes a question with two answers. Proved against a real Postgres
rather than read off the schema — and the stale EVIDENCE has to go with it: a
prefill showing last week's matched dimensions under this week's scale would be
the worst of both, so `agreedText` and `inheritedError` are cleared when the
source changes. Other pages of the same set are untouched.

## What this does not do

It does not re-run the paid stages, and it does not touch anything a person has
confirmed — accepted sheet numbers and saved calibrations are their own records
and outlive any re-read.

Four gates: **9,257 unit tests, 680 db tests** on a throwaway Postgres,
typecheck, lint. No schema change, no migration.

## Click-list

1. Open a job with a plan set already read. *Expected: the "Reading the sheets"
   panel says "Every sheet read", and there are now TWO buttons — the title-block
   one naming its sheet count, and "Read the sheets again — costs nothing".*
2. Press **Read the sheets again**. *Expected: it works through the pages as a
   first read does, and finishes at "Every sheet read".*
3. Press **Set scale** on a sheet afterwards. *Expected: the offer reflects the
   CURRENT reader — on a sheet whose dimensions are all too short, it should now
   decline with a sentence naming the scale, rather than offering a line the form
   then refuses.*
4. Check your sheet allowance before and after step 2. *Expected: unchanged. The
   button says it costs nothing and it must be telling the truth.*
