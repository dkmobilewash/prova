### A dropped column outlives the build that read it — AUDIT, docs only (Diego)
`diego/drop-deploy-window-audit`

#378 dropped `PunchListItem.isDone` and `completedAt` and shipped the code
that stopped reading them in the same PR. Both halves were correct and the
result was still a two-and-a-half minute production outage on
`/punch-lists`: `migrate.yml` runs on merge and finishes in seconds, while
Vercel is still building the commit that removes the reads, so the live
build spent that window selecting a column that no longer existed.

Recorded with the measurement rather than the fright, because the size of
it is what makes the rule proportionate: columns dropped 07:44:33Z, deploy
READY around 07:46, and exactly one runtime error in the window —
`P2022`, one user, and that user was the agent that pushed it. A Sunday
morning is the only reason it cost nothing.

The entry this adds to CLAUDE.md is the ordering: the PR that stops reading
a column ships first, and the drop follows once that deploy is live. The
file already said "additive only unless you've pinged first", which reads
as being about losing data — the hazard here is the window, and pinging
does not shorten it by a second.

Docs only, under the audit exception in the working agreement: it records
what an investigation established, with the evidence, so the next person
does not rediscover it at somebody's expense.
