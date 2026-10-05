### Four titles, one kind — the sheet index could not be filtered (Diego)
`diego/sheet-page-type`

The estimating audit's stage 1.1 asks to *"auto-tag page types (e.g. Floor Plan,
Elevation, Schedule, Detail Sheet, Cover Page)"*. The title-block reader already
extracts sheet number, title, discipline, scale, revision and issue date — and
the page TYPE existed only inside the title string.

`proposedTitle` holds what the sheet printed. That is a label a person reads,
and nothing can act on it: **"FLOOR PLAN", "PLANS - LEVEL 2", "ENLARGED PLAN"
and "OVERALL FLOOR PLAN" are four strings and one kind.** So this adds the kind,
as a closed set of seven — COVER, PLAN, ELEVATION, SECTION, DETAIL, SCHEDULE,
OTHER.

**It is what the next piece of work needs.** Schedule parsing has to find the
schedule sheets, and until now nothing in the app could answer "which pages are
the schedules?"

## Three decisions, each the opposite of something nearby

**CLOSED, where `normaliseDiscipline` three lines away is deliberately OPEN.**
That function KEEPS a value it has never heard of, because a set can carry "AV"
or a consultant's own code and dropping it would lose what the sheet said. Page
type cannot afford that: its whole purpose is a filter, and a filter over an
open vocabulary answers wrongly the first time a title block says "SCHED."
Nothing is lost — the title is stored verbatim one column away.

**TEXT, not an enum, where the PR two before this one added enum members.**
This column holds MODEL OUTPUT. An enum column rejects an unexpected value at
write time, and a thrown Server Action message is REDACTED in production — so a
model answering "FLOOR PLAN" would cost the whole proposal rather than one
field. `normaliseSheetPageType` is the gate instead, and
`sheetPageType.test.ts` holds its promise: nothing reaches the column but the
seven. The enum in #637 was safe to add because nothing writes model output
into it.

**NOT BACKFILLED from `proposedTitle`**, though the normaliser could do it in
one statement. A backfill is a classification with no reading behind it, and
`proposedReason` — the sentence a person checks a proposal against — would not
mention it. The review surface shows a proposal and asks somebody to accept it;
a field nobody proposed has no business in that row. Re-running ingestion is how
an old set gets page types.

## NULL and OTHER are different facts

Null means nobody has read this page, or the text gave nothing to judge from.
OTHER means it was read and is none of the six — a legend, a general-notes
sheet, a specification printed on a drawing. Collapsing them would make an
unread page look classified, so the normaliser keeps null null and the prompt's
rule 6a says which is which.

A proposal written before prompt `plan-title-block.2` also holds null, because
that reader did not return the field at all. That is why the version bump
matters: without it, an old null reads as "unclassifiable" rather than "not
asked".

## Verification

- **8 unit tests**, and the important one is not that "FLOOR PLAN" maps to PLAN.
  It is that **nothing maps outside the set** — "GENERAL NOTES", "AV", a
  discipline name, and an emoji all answer OTHER, asserted against the canonical
  list rather than against a literal.
- A title naming two kinds picks the one printed FIRST, which is stated rather
  than accidental: "ENLARGED PLANS AND SECTIONS" is PLAN, "SECTIONS AND ENLARGED
  PLANS" is SECTION. There is no right answer for a real sheet like that; a
  reader can at least predict this one.
- **The column was read back out of Postgres**, not inferred from the migration
  applying: a throwaway cluster, every committed migration, then
  `information_schema.columns` — `proposedPageType`, `text`, nullable.
- The db suite with the migration applied: **65 files / 644 tests**, and the log
  names `Applying migration 20261005210000_add_plan_sheet_page_type`.
- `typecheck` 5/5, `lint` 5/5, **577 files / 8,963 unit tests**.
- Announced in `#prova-build` before the push, per rule 4.

## Not verified here

`pnpm eval:plan-sheets` spends real model calls and has not been run on the new
field, so **whether the model classifies a real title block correctly is
unmeasured**. The normaliser is proved to keep the vocabulary closed whatever
comes back, which is a different claim. Running the eval is the next step, and
the fixtures in `planSheetCases.ts` already carry titles that exercise four of
the seven kinds.
