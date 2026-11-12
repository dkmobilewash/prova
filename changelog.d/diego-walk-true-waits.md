### The flow walk's seconds are what a person spends (Diego)
`diego/walk-true-waits`

The two biggest waits left in the Totem Lake and Falafel Fresh flow measurements were the walk's own,
not a person's. The review queue's 284 s was the walk re-opening an empty queue: `?open=review` does not
open a queue with nothing in it, so each re-check sat in a 120 s timeout (240 s on Falafel). Run
takeoff's ~20 s was the walk looking for a demolition-pairing bar on sets that have no demolition plan.
The price questions that follow typed walls arrive on their own 0.1 s after the queue says it is done,
with no reload, so a person does not wait there either.

Each step now reports `seconds` (a person's), `wallSeconds` and `walkSeconds`, through
`e2e/lib/walkClock.ts`: a look that never finds its target, a fixed pause, and a wait that runs out
are the walk's; what appears and work in progress are the person's. A census
(`e2e/lib/walkClock.test.ts`) keeps every fixed wait in the walk on that clock. True app time,
sign-up to a signing link, no AI: **Totem Lake 19.0 s** (queue 2.8 s, Run takeoff 4.4 s), **Falafel
Fresh 23.6 s** (queue 3.0 s, Run takeoff 4.4 s). The same totals: $39,098.73 and $8,993.03.
