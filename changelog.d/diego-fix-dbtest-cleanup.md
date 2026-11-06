### Main's db suite green again: a test's cleanup deletes the estimate lines confirming now writes (Diego)
`diego/fix-dbtest-cleanup`

#1009's `levelHeights.dbtest.ts` confirms two wall groups and then deletes its job.
#1010 made confirming a group write the item's estimate lines at once
(`syncDecidedItems`), so the job had `JobLineItem` rows, and the job delete failed on
`JobLineItem_jobId_fkey` (main run 42146550544, 68b531be). Each PR was green alone. The
cleanup now deletes the job's lines first.

The only other db test that confirms something and then deletes its job is
`confirmWindows.dbtest.ts`. It posts counts through `confirmWindows`, which doesn't sync
lines, so it doesn't need the change.
