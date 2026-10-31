### A job has a spec book, whether or not it had a bid (Diego)
`diego/job-spec-sections`

Specs belonged only to a bid, so nothing after award could read them.
`/jobs/[id]/specs` now lists the winning bid's sections, reached through
`wonJobId` and never copied, plus sections added to the job directly.

`BidSpecSection` gains a nullable `jobId` and **`bidInvitationId` becomes
nullable**, which relaxes a required column. Diego approved that and it was
announced in #prova-build first. A database CHECK requires every section to
belong to a bid or a job. The cost reader stays bid-only and is unchanged.

The page says it shows only what was uploaded, not necessarily the whole book.
