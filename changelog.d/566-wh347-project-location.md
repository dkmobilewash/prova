### What actually changed, in plain English (Cyrus)
`cyrus/seed-counters-zzbqtu` — second capability in #566

**The WH-347 told people to do something that could not work.** The federal
form's header wants PROJECT AND LOCATION. The page built it with
`job: { name: job.name }` and nothing else, so the location was always null,
always in `blocking`, and the form always reported itself not ready to file —
while the red sentence beside the empty box read *"Record the job's site
address on the job page."* Doing that changed nothing. `Job.siteAddress` and
`Job.projectLocation` are both columns, both were on the row that page already
loads, and neither was ever passed.

The reason is one stale comment, and it is this file's most expensive recurring
shape. `Wh347JobInput.location` said *"Neither is on the Job model yet; both
are accepted so the caller that gains them does not change this module's
shape."* True when it was written. The columns landed, nothing broke, nobody
re-read the comment, and the sentence went on telling every reader the app did
not hold the value — which is the direction that stops people looking. Same as
the `InvoiceCounter` entry: a claim about what the app does NOT have perishes
exactly as fast as a claim about what it does. (It is STILL true for
`contractNumber` — there is no such column anywhere in the schema, verified,
which is why that field keeps its honest "a job does not record one".)

**The rule already existed and the WH-347 was the only form not using it.**
`lib/das-print.ts` has resolved this since the DAS forms were written:
`job.siteAddress ?? job.projectLocation` — the street address first, the
looser "in the person's words" location as a fallback. So the fix is not a new
decision. It is `lib/job-form-location.ts`, one named rule with a test, called
by both, so a fourth government form cannot pick a different order. Two
documents a state receives disagreeing about where one job is would be the
two-computations-disagreeing shape this repo keeps paying for, on paper
somebody signs.

Extracting it fixed a second, smaller thing in `das-print`: `??` does not
treat a blank as absent. A cleared form field leaves `""`, which `??` returns —
so the looser location that IS recorded got skipped, and `project.location ===
null` then called the empty box filled in. `committeeDeliverability` already
states the rule for the same reason ("a space is what a form field leaves
behind"), and on a document a state receives a box that LOOKS filled is worse
than an empty one, because nobody re-checks a filled box.

**Two guards, because one of them proves nothing on its own.** The first bans
the `??` chain anywhere in the five form sources. The second requires the two
form builders to actually CALL the helper — needed because banning the chain
is satisfied by a form that passes no location at all, which is exactly what
the WH-347 did. Both mutation-tested: restoring the chain in `das-print` reds
the first, and removing the call from the WH-347 page — the bug as it shipped —
reds the second.
