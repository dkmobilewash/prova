### The bid watcher looks at your open bids every morning (Cyrus)
`cyrus/ai-watcher`

Every day at 13:00 UTC — on the alert digest's cron, which runs the watcher
after its own work (`lib/agents/cron.ts`; Vercel's Hobby plan allows two
cron jobs on `prova-web` and both were taken, so no third entry) — the bid
watcher looks at bid data C Stream
already holds and records what needs a person, each with the records it
came from: new invitations, addenda nobody has read, acknowledged or sorted
into scope, bids due within the company's "due soon" window that are still
Invited, bids past due and still Invited, and pursuits expected to bid soon
with no invitation logged. No model call — it is date and count comparisons,
so it spends nothing, but it still runs through `runAgent` so the AI switch,
the watcher switch and the spend cap gate it like every agent.

A finding is said once: its key carries the fact (`due_soon:<bid>:<date>`),
so the same due date is not repeated and a moved one is new. New warn/flag
findings push to the owners' (or the chosen people's) phones through the
existing `pushToUser`; nothing is emailed.

Bid-related email intake does not exist (no bid kind in DocumentIntakeKind),
so the watcher reads none.

The check: `lib/agents/bidWatcher.test.ts` drives fixture bids, addenda and
pursuits through the real run/finding spine — one finding per kind, nothing
new on a second run, a moved date is new, an over-cap company leaves a
PAUSED_CAP row and no findings. `queries.test.ts` fails if the schedule /ai
shows disagrees with `vercel.json`; `lib/agents/cron.test.ts` fails if
`vercel.json` grows a third entry or stops scheduling the entry that runs
the watcher, and `digest/route.test.ts` proves the digest actually calls it.
`/api/agents/run` stays as the manual, CRON_SECRET-gated route.
