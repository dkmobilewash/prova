### The alert push never arrived, and nothing was alive to say so (Diego)
`diego/push-after-response`

Found 2026-09-27 on a real phone, which is the only place it could have
been found. **No schema change, no migration.**

**What was wrong.** `sendMyAlertDigest` — the "Email these to me" button on
`/alerts` — sent its email and fired its push with `void
dispatchAlertPush(...)`. In a server action a floating promise does not
mean "later"; it means "until the response is sent". Vercel may tear the
function down the moment the action returns, and whatever the promise had
left to do dies with it. `dispatchAlertPush` makes **five database
round-trips** — device tokens, `loadAlerts`, sent keys, claim, release —
before it ever reaches `pushToUser`, so its window is hundreds of
milliseconds wide. The push never arrived once.

**The control is what named it, and it is the more useful half.** Two
pushes went to the same phone 49 minutes apart: the alert digest, and
`assignCrewMember`'s "New job assignment". One landed and one did not —
which ruled out the push key, the device token, the iOS permission,
`EXPO_ACCESS_TOKEN` and the whole Expo transport in a single observation,
none of which any amount of reading had managed. The difference is that
`assignCrewMember` is ALSO fire-and-forget, and is one HTTP call with a
millisecond-wide window. Same bug, different odds.

**So both are `after()` now, including the one that was working.** It was
working on odds, and odds are not a design. `after` keeps the response
immediate — the button's result still speaks for the email, exactly as
before — and keeps the function alive until the work finishes. The cron
path never had this bug: `notification-run.ts` AWAITS `pushDispatch`,
which is why the schedule was never the suspect.

**Why the server never told anyone.** Nothing was logged about the push
failing because nothing was alive to log it. This defect was invisible
from its own output — no error, no warning, not even a "nothing due" —
and was only ever going to be noticed by a person not getting a banner.
That is worth remembering the next time something is "working, because
there's nothing in the logs".

**What guards it.** `lib/floatingPromiseCensus.test.ts` fails the build on
a `void <call>(` anywhere under `lib/` or `app/`, with one named
exemption: `app/api/ask/route.ts`'s stream `cancel()` handler, which is
STOPPING an abandoned generator rather than asking for work to outlive the
response — `after()` there would mean the opposite. The exemption list is
itself checked, so an entry whose file has stopped using `void` fails
rather than quietly sheltering the next one. `jobs.assignCrewMember.test.ts`
now asserts the push is scheduled rather than dropped.

**Comments are stripped before matching, and that is load-bearing.** The
note explaining this bug quotes `void dispatchAlertPush(...)` verbatim, so
a raw-text census would flag the file carrying the fix — somebody would
quiet it with a DELIBERATE entry and that entry would then hide the real
thing. Exactly #185, where a comment quoting a census's own pattern
disarmed it.

**Mutation-tested five ways**, and the third row is again the one that
earns the scope assertion:

| | bug | census scope | `leaves no work` says | overall |
| --- | --- | --- | --- | --- |
| M1 | `void` restored | full | RED, names the file | RED |
| M3 | absent | non-recursive | green *(blind, 223 files)* | RED on scope |
| **M4c** | **`void` restored** | **non-recursive** | **green — blind and wrong** | **RED on scope** |

Plus M2, a DELIBERATE entry gone stale, which fails and says to drop it;
M5, a comment quoting the pattern, which must NOT be flagged; and M1b,
real code added after stripping was introduced, which must still be
caught. The last two are a pair: stripping has to blind the census to
comments without blinding it to code.

**WHAT IS NOT PROVEN, and it is the important sentence here.** No test can
see a serverless teardown, so nothing in this PR demonstrates the fix
works. The mechanism fits all four observations and no other candidate
survives — the `push:` prefix logic, the claim ledger, the config check
and the token were each read and are correct. **Confirmation is a person
clicking "Email these to me" after this deploys and seeing a banner.**
Until that happens this is a well-argued hypothesis with a correct fix
attached, and it should be described that way.
