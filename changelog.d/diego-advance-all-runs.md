### Every queued plan reading advances while the page is open, oldest first

**What happened:** found by the 4th's walk. On a new company the wall-legend read, queued when the free pass closes, was never advanced by the plan panel, which pumped only the newest run. It waited for the daily 04:17Z cron: 65 legend pages unclaimed, and no suggested types or heights until the next day.

**Fix:**
- The panel asks for every unfinished reading on the set (`queuedPlanReads`, oldest first) and pumps each in turn. That covers the inventory, title blocks, wall legend and schedules. The whole-set walls and scanned-sheet runs keep their own panels.
- It does this on opening the page and whenever a reading completes. It names the reading on screen ("The wall legend: 25 of 65") and what is queued next.
- A paused run no longer waits for "Keep reading".
- The cron stays, for a tab that was closed.

**Spec:** `legend-without-cron.local.spec.ts` uses a brand-new company with plan reading on and uploads Baker. With the page left open and no cron, a legend proposal is stored after 0.6 minutes. With the old panel, there is none after 4 minutes.
