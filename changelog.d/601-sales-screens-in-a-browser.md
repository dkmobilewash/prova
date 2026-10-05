### The two screens the whole sales channel runs through had never been loaded by a browser (Cyrus)
`cyrus/sales-signals`

`/sales` and `/sales/[id]` are where every imported §4104 prospect is read,
banded and confirmed. No browser test had ever opened either one, and four green
CI checks over 63 collected specs said nothing about it.

**It was unreachable by construction, not by omission, and that is the part worth
reading.** `journey.spec.ts` step 10 walks "every main nav destination" by reading
`a[href^="/"]` out of the rail — and `app/(app)/layout.tsx` appends the Internal
group carrying `/sales` only when `company.isProvaOperator && role === "OWNER"`.
No persona in the suite had that flag; `grep -rn "isProvaOperator" apps/web/e2e/`
returned nothing at all. So the rail never offered the link and the walk never
followed it. The nav walk was not failing to check these pages — it could not see
them. *Nothing is ever missing from a question nobody is asking*, arriving as a
link that is not in the DOM.

Both halves of that gate also fail SOFTLY: `/sales` renders "Not part of your
access" and `/sales/[id]` calls `notFound()`. Neither crashes, so a health check
that only watches for a thrown error would pass on both.

A `sales` persona now carries the flag — on its own company, deliberately, rather
than on MAIN. Setting it on MAIN would have been one line shorter and would have
quietly enlisted step 10 into walking these screens, so a crash here would be
reported as a broken nav walk. `seedDatabase.test.ts` asserts the flagged set is
exactly `["clerk-sales"]` so that cannot happen by accident.

Eight browser tests (collected goes 63 → 71, derived by `collected.mjs` from
`playwright test --list`, so no literal anywhere needed changing and `ci.yml` is
untouched). The confirm is proved by three things that CANNOT be true beforehand,
each asserted ABSENT first: the `Call this one` band (derived on every read, stored
nowhere), the reviewer line (the seed leaves `reviewedByUserId` null on every row),
and the claim's occurrence count crossing 1 → 2. `monitor.hydrationMismatches` is
deliberately NOT asserted here, with the reason in the file: the open #418 shell
race (#510) fires on a different page set every run, and failing this file for the
shell's reason under the headline "the sales CRM is broken" would be a lie about
what broke. `retries: 0`, because the confirm is irreversible — nothing in this
product returns a signal to PROPOSED — so a retry would test a different fixture
under the same name.

`salesFixture.test.ts` re-derives every literal the browser spec looks for from
the app's own `qualify`, `buildSalesPipeline` and `winRateLabel`, so a fixture
drift fails in the 3-minute `ci` job instead of a 20-minute red `e2e` run.
`salesCoverage.test.ts` fails if these specs ever vanish again.

**The browser half is UNRUN and is not reported as passing.** The signed-in suite
needs a Clerk secret that must not travel through an agent channel, and Clerk's
FAPI host plus Turnstile are unreachable from an agent container. What a green
`e2e` job will mean precisely: 71 collected, 71 verdicts returned, and both routes
loaded in real Chromium with a `pageerror` monitor attached.

Eight mutations, each red, each total read before the colour. Two are worth
naming: removing `isProvaOperator` from the seed — the original defect — reds 2 of
37 naming the flag; and changing the proposed signal's kind so confirming it would
no longer reach STRONG reds with `expected 'Worth a call' to be 'Call this one'`,
which proves the spec's key assertion cannot silently become unreachable. One
mutation (pointing `testDir` at a missing directory) dropped the total to 30
rather than failing an assertion — the file stops LOADING. Still loud, and a
reminder to read the total first.
