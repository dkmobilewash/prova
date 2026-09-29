### The way home hides when there is a real back chevron — a refinement, on working code (Diego)
`diego/way-home-conditional`

**No schema change, no migration.** Mobile only. Three lines of behaviour
and two tests.

#555 shipped `WayHome` UNCONDITIONAL on purpose, and the reason is worth
repeating because it is the only reason this change is safe: whether
`router.canGoBack()` is false on a cold notification tap was an INFERENCE,
drawn from the missing back chevron. After three fixes that rendered
nothing, a control able to hide itself was not a bet worth taking. Always
rendering cost a redundant button on a warm tap — cosmetic. The inference
being wrong would have cost somebody trapped for a fourth release.

**The inference is now an observation.** Diego tapped a notification from a
cold start on build 6 and reported the Home button present **and no back
chevron beside it** — which is `canGoBack()` returning false, seen rather
than reasoned. So the condition comes back, on code already confirmed to
render, which makes this a refinement rather than a fourth attempt at a fix.

**What it buys:** opening a job from the Jobs list pushes it onto real
history, and that native chevron is the way out that belongs to the stack.
Two exits from one screen is its own small confusion, and `/job/<id>` is
reachable both ways.

**What makes it safe is behavioural, not structural, and that is the whole
lesson of the four attempts.** `screens/way-home.test.tsx` MOUNTS the
component both ways and asserts what renders. Mutation-tested three ways:

| | mutation | reds on |
| --- | --- | --- |
| M-A | never renders (**the failure that shipped 3×**) | "renders a pressable Home control" + the replace test |
| M-B | condition removed | "renders nothing when the stack can already go back" |
| M-C | **condition inverted** — the subtlest way to be wrong | all three |

M-C is the one that earns the pair. An inverted condition shows the button
exactly where it is not needed and hides it exactly where it is — the dead
end returning while every structural check stays green.

**The census gave up an assertion here, deliberately.** It used to require
`wayHome.tsx` to contain no `return null`, which was right while the control
was unconditional and is wrong now. It asserts `canGoBack` is still asked,
and carries a note saying that whether the control RENDERS is not a question
any census can answer — that being the exact thing that let three releases
ship a header button that did nothing. Strengthen the mount test, never that
assertion.

**Not claimed:** the warm-tap case has not been seen on a phone. The cold
one has (build 6). The risk is bounded in the direction that matters — if
the condition is somehow wrong on a cold start the button disappears, which
is why M-A and M-C exist and why this rides in its own PR rather than
alongside anything else.
