### The yard is dated on the viewer's calendar, not the server's clock — #173 (Cyrus)
`cyrus/equipment-viewer-day-173`

`/equipment` and `/deployment` judged every stay against the SERVER'S UTC
day while the send-out form defaulted its date to the VIEWER'S own day —
`localToday()`. Two clocks answering one question, which is #155's shape on
a different pair of files, and #172's fix deliberately did not cover it.

What it did, concretely. West of UTC, every evening: a dispatcher in Los
Angeles sends a lift out at 18:00, accepts the form's own default, and the
row reads "out 1 day" about a machine dispatched minutes ago — because the
server's calendar had already rolled to tomorrow. East of UTC it inverts:
in Tokyo at 08:00 a piece sent out today classified as a FUTURE stay, so
the row said "due out today" about a machine already on the truck, and the
yard count kept a piece that was gone. A plausible number, not an error,
which is exactly why this class of bug survives clicking.

Both pages now take `today` from `viewerToday()` — the same helper /alerts,
/sales and the layout already use, zone from the browser's own cookie,
geo-IP header as first-render fallback, UTC as the floor. Nothing about
STORAGE or RENDERING changed: dates are still UTC midnight in Postgres and
still rendered in UTC; only "which day is now" moved to the reader's wall
calendar, the one place UTC was never the right answer.

The check. `equipmentDeployment.test.ts` pins both sides of UTC from real
instants that straddle midnight (Asia/Tokyo 23:00Z, America/Los_Angeles
01:00Z), asserts the fixtures actually straddle before asserting anything
else, and writes the old symptom down as assertions — the UTC day yields
"due out Sep 5, 2026" for a machine already gone and "out 1 day" for one
just sent; the viewer's day yields "out since today" for both. And because
those pure tests cannot see which clock a page READS, a source guard (same
shape as the one in alerts.test.ts) requires `await viewerToday()` in both
pages by name and refuses any calendar day derived from `new Date()`'s
ISO string. Every assertion was mutation-tested red.

Also verified in passing, not changed: #149's three fixes (the `<li>`
nested in `<li>`, the future-dated dispatch counted as out, the location
printed twice) all landed on main in #174 — the issue is still open but
the code is done; only the branch `cyrus/equipment-page-truth` is stale.

**This entry revives a stranded commit.** The fix above was written and
mutation-tested three weeks ago on `cyrus/equipment-truth-and-viewer-day`
(`7764544`) but never opened as a PR; that branch's base sat 122 commits
behind `origin/main`. Reapplied here via `git cherry-pick -n 7764544` onto
current main: `apps/web/app/(app)/deployment/page.tsx` and
`equipmentDeployment.test.ts` applied cleanly; `equipment/page.tsx`
conflicted only on the import block (main had since added a `toJobOption`
import next to the one this fix adds) and was resolved by keeping both
imports — the rest of that page's diff, including the `today` line and its
comment, applied unchanged and still matches the current file. Confirmed
both pages still read `new Date().toISOString().slice(0, 10)` for "today"
on current main before treating this as a live bug rather than an already-
fixed one. The `#149`/`#174` and `#172` cross-references above were
re-checked against current `main` and still hold. No other server-clock
"today" reads were found in either page — the remaining
`.toISOString().slice(0, 10)` calls in both files render stored UTC-
midnight dates (`sentOutOn`, `returnedOn`, `startDate`, `endDate`), not
"what day is it", and are unchanged.
