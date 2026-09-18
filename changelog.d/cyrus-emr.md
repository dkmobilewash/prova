### "What's our mod rate this year?" has an answer — recorded from the bureau, never computed (Cyrus)
`cyrus/emr`

A GC's prequalification form asks for the experience modification rate, and
nothing in the app could say what it was. The hundred-question census had it
as a gap with `safety_record` named as the tool most likely to be reached for
by mistake — and that near-miss is the whole reason this is shaped the way it
is. The OSHA log is what a rating bureau calculates an EMR FROM, together with
payroll and loss data this app never sees. A figure derived from it would be a
number no insurer has ever quoted, written onto a form a GC relies on.

So the EMR is RECORDED, not computed. `/compliance` has a new section where a
person copies the rate off the bureau's worksheet — the rate, the effective
date, who issued it, an optional link — one row per company per policy-year
start (`@@unique([companyId, effectiveDate])`; a bureau revision is an edit of
that row, and the effective date is locked on edit). It lives on
`/compliance` rather than `/safety` on purpose: beside the OSHA log it would
read as something derived from it.

Which rate is current is DERIVED, never stored: the latest effective date
that is not in the future. Next year's mod can be entered the day the bureau
issues it and does not become current until its date. A current rate whose
policy year has already ended is called out rather than presented as this
year's.

The Ask box answers it through a new `experience_mod_rate` tool, gated like
the page (MANAGE_COMPLIANCE), whose description forbids the model from
deriving, adjusting or forecasting a rate. The "experience modification rate"
entry is REMOVED from `KNOWN_GAPS` in the same change — that list is injected
into the system prompt and would have told the model to refuse a question it
can now answer. The census goes from 6 gaps to 5. Recording a rate is
deliberately not a command: the model must never be the one supplying the
number.

Migration `20260918100000_add_experience_mod_rate` — additive only, one new
table, no backfill (there is nothing honest to backfill from), plus a
`CHECK (rate > 0)`. Hand-written with every foreign key on one line, and
checked against `prisma migrate diff` from `main`'s schema.

The check: on `/compliance`, record 0.87 effective 2026-01-01 and 0.79
effective 2027-01-01. The 0.87 row is marked current and the 0.79 row "not yet
in effect". Ask "what's our mod rate?" — it must say 0.87 and cite
Compliance, and must never offer a number when no rate is on file.

## Five things an independent review found, all fixed and pinned

- **The current rate switched over on the UTC day.** On 31 December at 17:00
  in California the UTC day is already next year, so `/compliance` and the Ask
  box would have shown next year's mod to somebody filling in a prequal that
  evening. `serverToday()`'s own comment says it is not good enough "where the
  exact day decides an outcome"; both now use `viewerToday()`. The renewal
  rows on the same page keep `serverToday()` — a different fact, on a 30/60-day
  horizon where a day either way is noise — and the page comment says so.
- **`1.000` displayed as "1".** Prisma's `Decimal.toString()` drops trailing
  zeros, so the figure the tool tells the model to repeat onto a GC's form lost
  its places. Now written as an EMR is written: at least two places, three when
  real. The comments that said the rate was shown "as stored" were false and
  are corrected.
- **The stale-year banner asked for a rate already on file.** It now names the
  next rate when one is recorded.
- **A year of `0025` was stored** and read back as ending in 1926 (`Date.UTC`
  treats years under 100 as 19xx). Years outside 1990–2100 are refused.
- **`2026-02-30` was stored as 2 March.** It is a valid `Date` in JavaScript;
  the typed string must now survive the round trip.

Each fix was mutation-tested: undoing it turns a named test red.

`ExperienceModRate` is also now in the data export's omissions list — the table
shipped and the export neither carried it nor said so.
