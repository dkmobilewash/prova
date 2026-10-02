### Five tabs instead of three, and a job hub that says how much of each thing there is (Diego)
`diego/mobile-ui-overhaul`

**Phone only. No schema, no migration, no API call added, no business logic
touched.** Structure and hierarchy, from a UI review against reference
layouts in Procore, JobNimbus and CompanyCam.

**ALERTS AND OUTBOX WERE HIDDEN DESTINATIONS AND ARE NOW TABS.** Alerts was
reachable only by tapping a push notification. Outbox only from a row inside
Settings. Both are things a person needs to CHECK without being prompted —
"did my report actually send?" is the question a queue exists to answer, and
it was two taps inside a menu. The bar is Home · Jobs · Alerts · Outbox ·
Settings.

The files moved into `app/(tabs)/`, and **that changes no URL**: `(tabs)` is
a route group, so `/alerts` and `/outbox` are still `/alerts` and `/outbox`.
Every `router.push` and the notification tap router (`lib/push-target.ts`)
work untouched. Both screens gained a `LargeTitle` and a `SafeAreaView` —
they had been borrowing the root stack header, which as tabs they no longer
have.

**AND IT RETIRES THE COLD-START DEAD END ON /alerts STRUCTURALLY, which is
worth more than the tab.** That bug — a notification tap from a killed app
landing on a screen with no back chevron and no tab bar — took four releases
(#548, #553, #554, #555) and three silent failures. A tab destination cannot
have it: the navigator renders the bar on every frame, cold launch included.
That is a stronger guarantee than a view each screen has to remember to
draw.

So `<WayHome />` is **removed from Alerts** and kept on `/job/[jobId]`, which
is still outside the group. Keeping it would have been actively wrong:
`canGoBack()` is false at a tab root, so it would have put a redundant Home
button at the top of the Alerts tab on every single visit.

**That meant changing `push-destination-exit.test.ts`, which is scar tissue,
so the rule was SPLIT rather than relaxed.** Its old sentence — every
destination renders `<WayHome />` — was right while every destination was a
bare stack screen, and wrong the moment one became a tab. Now each
destination is asserted against the mechanism it actually has:

    TAB   -> must be declared in the tab layout, and must NOT draw WayHome
    STACK -> must draw WayHome in its body, exactly as before

Its resolver also learned that a route group is invisible in a URL, derived
from the directory listing rather than hardcoded, so `app/(tabs)/alerts.tsx`
resolves for `/alerts` instead of reporting "no screen file" for a screen
that exists. And a new case asserts neither branch is empty, because a split
rule can be satisfied by a vacuous side.

| mutation | census |
| --- | --- |
| ctl nothing changed | green |
| WayHome put back on the Alerts tab | **RED** |
| WayHome removed from `/job/[jobId]` | **RED** |
| alerts tab undeclared in the bar | **RED** |

**THE JOB HUB NOW CARRIES NUMBERS, AND THEY COST NOTHING.** It listed the
same nine features with a fixed description under each — "Photos / Site
photos and videos". That is a label, not information: every row looked
equally urgent, so the screen disclosed nine doors and said nothing about
what was behind any of them. It is now a large title, a full-width status
band, two operational facts, and a two-column grid of tiles carrying a count
each.

The counts are free because `lib/prefetch.ts` already fills exactly those
nine cache keys, from Home, while there is still signal — so the hub reads
them back with `cacheGet` and makes **no request of its own**. The band
reuses `statusPair("job", …)`, the same source `StatusBadge` reads, so the
band and any badge on the screen physically cannot disagree about what a
status means.

**An empty cache renders NO number, not `0`.** Null is not zero and the
difference is the point: an empty cache means the section has never reached
this phone, and printing `0` would be the app asserting "no photos on this
job" on the strength of a failed sync. Home already refuses that trade; a
tile is a louder place to get it wrong, because a number reads as a fact.

**No money, deliberately.** The reference layout leads with job value and
balance due. The phone carries no figures at all, by product rule. The band
and the two facts are the operational equivalents — what the job IS, when it
runs, and how much is open on it.

**And no site address, which is a data limit rather than a choice:** the
phone's `Job` type is `{id, name, status, startDate, endDate}`. A location
would need the API and the type to carry one, which is a bigger change than
a layout and is not in here.

**What is NOT proved.** Nothing in this repo can measure layout — happy-dom
returns zeros from `getBoundingClientRect`, which is how a 1.35-point line
height once shipped on five screens. So tile height (`hitTarget * 1.5`),
five tab labels at 375pt, and whether the status band reads as doubled-up
beside its badge are all claims a phone has to settle. The four design
censuses (`design-tokens`, `theme-contrast`, `theme-parity`,
`touch-targets`) pass, and they check tokens, not pixels.
