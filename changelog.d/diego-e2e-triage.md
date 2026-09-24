### Three of the seven e2e failures were the suite being wrong, not the app (Diego)
`diego/e2e-triage`

The signed-in browser suite started telling the truth on 2026-09-24, when the
Clerk **Development** instance's Organizations setting was changed to make
membership optional. Every persona had been landing on
`/sign-in/tasks/choose-organization`, which renders nothing, because this app
does not use Clerk organizations at all — tenancy is Prova's own `Company`.
The suite went from `collected 36, returned 0` to **29 passed, 7 failed**, with
all 36 verdicts returned.

**Its first honest run found seven failures, all pre-existing on `main`** —
confirmed by result rather than assumed: `main`'s own run fails the identical
seven, same specs, same split. Three of them were the suite asserting things
the app stopped doing, and this fixes those three. None was an app defect.

**`job-detail`: the rail gained a tab and two lists did not.** #476 added the
Takeoff tab between Estimate and Crew & time, and the spec's hardcoded rail
order still listed eight entries. Added to the order **and** to the tab walk —
naming a tab without opening it would leave the next one half-checked, which is
the shape this spec exists to catch.

**`failed-save-keeps-input`: asserting a sentence the app improved away from.**
It expected `"paymentTermsDays" must be a number` — the old message, which read
the FORM KEY back at the person, quotes and camelCase and all. One parser writes
these now (`lib/numeric-input.ts`) and it names the field as the screen labels
it: *"Payment terms has to be a whole number — "abc" isn't one."* The spec now
matches the idea rather than the wording; the full sentence stays pinned in
`lib/actions/company.dbtest.ts`, which is the right place for punctuation. A
test that breaks when somebody reflows a paragraph is measuring the wrong thing.

**`dashboard-empty`: it was asserting against `/welcome`.** The EMPTY persona is
gated on purpose — `seedDatabase.ts` deliberately leaves `businessScopeAskedAt`
unset because *"they are meant to be brand new, so they get the gate a real new
customer gets"* — and `/dashboard` is the ONE route that redirects
(`lib/onboarding-gate.ts`). A bare `goto("/dashboard")` therefore landed on the
questions and never saw the Getting started card. It walks the gate now, via the
`landOnDashboard` the journey already used.

That last one explains why it looked like flake for so long: the three sibling
empty-state specs on the SAME persona — contacts, punch lists, field reports —
all pass, because none of them goes to `/dashboard`. One route is gated and it
is the only one anybody pointed a spec at.

**What is NOT fixed here, and is recorded rather than guessed at** (see #447):

- `/settings/import` still hits the error boundary — #447's Cause C, the most
  urgent thing on that list. Its other half, `/punch-lists`, now passes.
- `journey` step 11 reports a **React hydration mismatch on seventeen pages**,
  which is not in #447 at all. Its own message blames something rendered from
  "now"; that is a hypothesis, not a finding. What has been eliminated: the
  Playwright config sets no `timezoneId`, so server and browser are both UTC in
  CI, and `lib/render-date.ts` already pins `timeZone: "UTC"`. Nothing on this
  machine can run the app, so the cause is open.
- Two `field-screens.mobile` specs at 375px are Cyrus's lane.
