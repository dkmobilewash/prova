### Turning the answer key off takes its raw list off the customer's panel (Diego)
`diego/key-mode-list-clears`

Answer-key mode shows the finder's RAW runs on purpose, because a key grades the
finder. That list was written into the same state the customer's Layers /
Quantities panel reads, and nothing cleared it when the mode was turned off.
Reproduced on Jane Hahan A2.1 (:3010, 2026-11-19): the customer's own Run takeoff
says **Found 4 runs, 63 ft**; a find in key mode says **Found 119 runs** (7-3/4"
25 runs 347 ft, 7-1/2" 31 / 325 ft — on the title block, the notes column, the
legend samples, the grid lines); turning the key off left **119 runs, 1,332 ft**
on the customer panel. That is the screen Diego kept seeing. Every measurement
of the offered list was right — the panel was showing a different list.

Now every find also keeps the customer offer (the same `offeredCandidates` call),
and turning the key off puts that on the panel; on a sheet paired with its
demolition plan it clears the panel instead, since key mode skips the plan
comparison. Check: `keyModeList.test.ts` — a key-mode list is replaced by the
offer, never the raw runs; mutating the helper or removing the key-mode mark
turns it red.
