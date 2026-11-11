### "Try it on a sample set": a new company sees the whole flow before uploading its own plans (Diego)
`diego/sample-job`

Right after the trade pick on /welcome, a new company is offered a sample job. Pressed, the server
builds it with the same steps a pilot's job goes through, on an invented sheet (fixture S13,
"Professional office suite", whose title block says SYNTHETIC FIXTURE · NOT A REAL PROJECT):
plan, scale from the printed 1/8" = 1'-0", the wall finder (no model), Run takeoff's posting, and the
review queue's Enter on the biggest group, which writes the estimate lines. The other group and the
lines' prices wait in the queue for the person. About a second to build; the job opens on its
stepper with Plans, Scale and Takeoff done.

**Not Baker.** Every real set is a client's drawing and is never shown to another company.

**Labelled and contained.** `Job.isSample` (additive migration): an amber "Sample" banner over every
tab and a badge in the jobs list. It is not counted in "still being priced". It is deleted in one
two-step press, takeoff and all; the delete refuses a real job, and a sample somebody has used for
real work (invoices, time, a contract).

**Never uses plan sheets.** The plan is `sample:office`, the deployment's own file (named in
`outputFileTracingIncludes`), so nothing is uploaded and no company's delete can remove another's file.
The free stages run as usual; the three that use sheets (title blocks, wall legend, schedules) and
the by-sight legend read refuse on a sample with a sentence.

Checks: `lib/actions/sampleJob.dbtest.ts` (built for real: 192 ft scale, walls on the job, lines,
a group left; same job on a second press; a title-block read refused and nothing started; deleted
with nothing left, a real job refused). `e2e/specs/sample-job.spec.ts` walks it in a browser on a
fresh company.
