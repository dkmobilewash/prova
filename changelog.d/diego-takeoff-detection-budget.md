### Wall detection was being killed, silently, on real plan sets

#791 made the walls find themselves when a scale is saved. On the bench and on
small sets it works. On a **52-sheet dealership bid set it produced nothing at
all**, and the reason is not in the detection logic.

Found by a click-through, then proved from production's own runtime log. One
save, request `7lj2t-…`, 2026-10-15:

| | |
| --- | --- |
| 02:11:38.758 | `[db] connected` — the action begins |
| 02:11:46.464 | `Cannot polyfill Path2D` / `ImageData` / `DOMMatrix` — pdf.js loading, **7.7s later** |
| — | nothing further from that request |

Those pdf.js lines are detection starting up inside `after()`. It never reached
a `pageStrokes` call. The invocation was ended by the platform, the browser got
a **503** on a save whose calibration had in fact stored correctly, and the
sheet showed no wall groups.

Most of those 7.7 seconds is `readPlanBytes` pulling the whole plan set out of
blob storage before a single wall can be looked at. A Server Action posts to the
route of the page that rendered it, so that work was running inside the takeoff
page's default function budget.

### The fix is a budget AND a deadline, because the failure was invisible

`maxDuration = 60` on the takeoff route is the half that buys time. The half
that matters more is `DETECTION_BUDGET_MS = 45_000` inside the detector, which
expires **first** — `plan-ingest/runner.ts`'s pattern, under the same 60, for the
reason it states: *stopping ourselves beats being stopped.*

**Being killed leaves nothing behind**, and nothing is exactly what a sheet with
no walls on it writes, by design — a row saying "no walls" would be
indistinguishable from never having looked. So the two states were identical from
outside: no proposals, no log line. Detection now says which one happened, and
`detectWallsForCalibration` returns a `DetectOutcome` so a caller and a test can
tell `out-of-time` from `nothing-found`, `unreadable`, `too-dense` and `failed`
without reading the log.

### Running out while sampling costs the template filter, not the walls

Only one deadline gives up: the one after the download, where nothing has been
read yet. Past that there is always a smaller job worth finishing.

The sampling loop — six more pages parsed to learn where the frame and the title
block sit — now stops on the deadline exactly as it already stops on a page that
will not parse: **drop the template pass and detect anyway.** That is the
fail-safe direction `sheetTemplate.ts` and this file both state in as many words,
*"cannot tell" must not mean "drop it"*, and a mutation making the deadline
abandon the run instead is red.

### Verified

- `detectWallsForCalibration.test.ts`: the clock is INJECTED, the way
  `runner.ts` injects its budget and for its reason — a deadline read from
  `Date.now()` can only be tested by waiting for it. These run in 3ms.
- **4 of 4 mutations red**, control green: both deadline checks removed, the
  sampling deadline made to abandon rather than degrade, and the injected budget
  ignored.
- The degrade test carries its own control. Without one, "fewer pages were read"
  would pass on a sampling loop that never ran at all, so the generous arm asserts
  it reads more than one page before the pressed arm is compared against it.

### Next does emit it for a PAGE route, which was the doubtful part

Every `maxDuration` in this repo until now was on a **route handler**
(`/api/agents/run`, `/api/notifications/digest`, `/api/plan-ingest/run`), so
whether a page segment's config reaches the function was an assumption rather
than a fact. Read out of the production build instead of believed —
`.next/server/functions-config-manifest.json`:

```
/api/agents/run            {"maxDuration": 60}
/api/notifications/digest  {"maxDuration": 60}
/api/plan-ingest/run       {"maxDuration": 60}
/jobs/[id]/takeoff         {"maxDuration": 60}   <- new
```

That manifest is what the platform reads to configure the function, and a
Server Action posts to the route that rendered it — so the action and the page
are the same function and carry the same entry.

### What this does NOT prove, stated rather than implied

**No test in this repo can see a platform time limit.** `maxDuration` is not
observable from vitest, and 60 seconds is not measured to be enough — it is
measured to be more than the 7.7 seconds that were being spent before anything
happened at all. The proof is the production log after a save: proposals on the
sheet, or detection's own ran-out-of-time line. **Silence is now a bug**, which is
the whole change.

If that line does appear, the answer is not a bigger number. It is to stop
downloading an entire bid set to look at one sheet — a byte-range read or a
cached per-page stroke table, and its own PR.
