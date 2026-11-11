### Plan reading takes turns across sets, and never waits on a set the AI provider is refusing (Diego)
`diego/drain-fair`

The background drain served the globally oldest unfinished plan-reading run, one per call.
cmb's wall legend was the oldest, and every page of it was in the provider's backoff because
the account was out of credit. So 300 drain calls reached only it and found nothing to claim,
and six new sets never got their page reading: no sheet list, no printed scales. A customer
uploading during an AI outage would have waited the same way. Now a run is served only when
a page of it can be claimed right now (not in a backoff window, not leased), or when nothing
of it is left, so it is still closed. Among those, the set served longest ago goes first, so
sets take turns. A stage that needs no model (page inventory, printed scales, keyless titles)
is never queued behind one waiting on the provider. Checked by `drainFairness.dbtest.ts`,
through the real claim ports with a simulated 400 credit error: set A's refused model read
goes into backoff, and set B's inventory is then next; when both can run they alternate; a
finished run is still offered for closing. Mutation: with the old oldest-first rule, three
of the four tests fail.
