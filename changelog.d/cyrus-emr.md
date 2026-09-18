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
