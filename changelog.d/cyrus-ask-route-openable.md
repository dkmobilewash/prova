### Ask stops sending people to a page that does not exist (Cyrus)
`cyrus/ask-route-openable`

Ask answers "how do I bill the GC" from the app's own walkthroughs, which is
the right answer from the right source — and then cited `/jobs/[id]/billing`.
That is a Next.js route PATTERN, not a path. `AskPanel` renders a citation as
a `<Link>`, so tapping it navigated to `/jobs/%5Bid%5D/billing` and showed
"This page doesn't exist." Nothing threw and nothing logged; the answer was
correct and the place it sent you was not real.

Measured on `origin/main` (9b53afc) before the fix, for an OWNER and a FIELD
member alike: "how do I bill the GC" → `/jobs/[id]/billing`, "where do I see
the estimate for a job" → `/jobs/[id]/estimate`, "how do I add crew to a job"
→ `/jobs/[id]/crew`, "where do I put job photos" → `/jobs/[id]/photos`, "how
do I log a field report" → `/jobs/[id]/field-reports`. Six walkthroughs carry
a pattern route — the five job tabs and `/jobs/[id]` itself.

Global search shipped the same string from the same registry in #386. That
half is fixed on #408, which is **still open**, so the predicate lives in
`lib/route-shape.ts` where both surfaces reach it rather than in either one:
two callers that must agree about what 404s cannot each keep a copy of the
rule. When #408 lands, `lib/search/query.ts` should import `isOpenableRoute`
from there and drop its own.

**The match is not dropped, and that is the one place this deliberately
differs from #408.** A search row is only a link, so a row reading "A job —
billing" that opens the jobs list is worse than no row at all — #408 excludes
those six and says why. Ask has prose and the page's own steps around the
link, so it can say the true thing: open the job from Jobs, then its Billing
tab. Excluding the match instead would have left a contractor with "nothing
in the app's own walkthroughs matches" for a question the app answers well,
and a model with nothing to cite is a model that guesses. That naive version
is mutation-tested as its own red case.

So `app_help` now returns a `route` that always opens, plus `insideOneJob`
when that route is the list to start from rather than the page itself, and
the tool description tells the model what to do with it. Citations are
deduplicated by href, because three job tabs collapse onto one `/jobs` and
`AskPanel` keys its links by href.

`appHelpRouteCensus.test.ts` is the guard, and it pins the two things
CLAUDE.md records this repo getting wrong about derived checks — plus a third
this defect demonstrated:

| pinned to | source that cannot drift with it |
| --- | --- |
| **size** | `git grep -o` count of `href:`, raw bytes, per file |
| **scope** | `git ls-files`, plus every file named by a `followTo` |
| **expressions** | every non-literal `href:` enumerated with a written reason |

That third row is why this got past `tools.test.ts`, which already derives
Ask's citations from `handlers.ts` — it reads `href: "…"` literals only, and
the defect was `href: match.route`. An expression is invisible to a literal
scan, so one that is not listed now fails the build rather than being assumed
fine. Vacuity floors sit above all of it: the registry must still CONTAIN
dynamic routes, every one of them must still start at `/jobs` (or
`insideOneJob` is a lie), and the drive must still return pages.

Eight mutations, each broken, confirmed red **for the right reason**, and
restored:

| # | mutation | went red on |
| --- | --- | --- |
| M1 | the shipped bug — `match.route` back | names the role, the question and the route |
| M2 | `isOpenableRoute` always true | the registry vacuity floor |
| M3 | dynamic-segment regex matches nothing | same floor, from the other side |
| M4 | href scan matches nothing | "git counts 149 … and this file parsed 0" |
| M5 | scope narrowed to `handlers.ts` | the `git ls-files` scope pin |
| M6 | citations not deduplicated | three `/jobs` links, one React key |
| M7 | description stops naming `insideOneJob` | the model is never told |
| M8 | **the naive fix** — drop the match | "nothing matches" for a question it answers |

Nothing here touches the confirm gate: `app_help` is a read tool, it reaches
no command, and no write path changed.
