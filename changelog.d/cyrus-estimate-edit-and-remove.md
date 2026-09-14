### What actually changed, in plain English
`cyrus/estimate-edit-and-remove`

A job's name, client and scope could not be changed. At all. The job page
could edit a line item, a forecast and the schedule; the job's own identity
was fixed at creation. So a name typed wrong — or drafted wrong by the
assistant from a spoken scope — was permanent on every job in the system,
and the only remedy was somebody running SQL against the database.

And a job could not be removed by any means. That is RIGHT for a job that
has been worked: it carries the certified payroll, the pay applications and
the retainage, and the per-job invoice counter makes it sharper than a
principle — delete a job and its invoices and a later invoice can reuse a
number a GC has already been sent (#224). It is plainly WRONG for an
estimate created by accident thirty seconds ago, which is what a person
actually does on their first day.

Both are now possible, and the line between them is EVIDENCE rather than
age or intent. A record that has been sent, billed or worked is history. One
that has not is a draft, and a person may fix or discard their own draft.

**The client is the one field with a stage rule.** Name and scope are
descriptions and stay correctable forever — a typo on a contracted job is
still a typo. Who the job is FOR is not a description: once contracted it is
who signed, who is invoiced, who holds the retainage and who every pay
application went to. `mayChangeClient` is written as an allow-list of one
rather than `status !== "ESTIMATE"`, so a JobStatus added later cannot
inherit permission by default; the test enumerates every other status.

**Removal is owner-only, estimate-only, and refuses with the reason.**
`JOB_HISTORY_RELATIONS` is every relation on Job except `lineItems` — those
ARE the estimate, not evidence it was worked — and the refusal names only
the non-zero kinds, the shape `deleteSalesLead` already had to be fixed into.
`ownerRefusal` rather than `assertOwner`, because the action's type promises
a sentence and a thrown one is redacted to a digest in production.

Placed with Job status and Schedule, far above the three fixed lower slots
(Retainage → Field Reports → Pay Apps) that nothing in that file marks and
nothing may reorder.

Neither is an Ask command, and both are recorded in the exclusions with the
reason: a rename reaches every document naming the job, and a removal is the
one irreversible act in the product. Neither should be confirmable from a
card where the thing being changed is out of sight.

Mutation-checked: dropping `invoices` from the history list, and letting the
client change on a contracted job, each turn the suite red.

Gates: typecheck clean, lint clean, 144 files / 2,451 tests. No migration.
