### The onboarding questions became a screen you land on, not a card over one (Cyrus)
`cyrus/onboarding-gate`

Follow-up to #390, from Cyrus watching it live: the three onboarding
questions rendered as a modal mounted in the shared app layout, so it
appeared as a card over whatever page happened to be behind it — he saw
it float over `/messages`. That defeats the feature. The questions exist
to decide what a six-person plaster outfit sees in the sidebar before
they conclude "this is for bigger companies than me," and a card that
shows up after the full sidebar is already on screen has already lost
that four seconds.

**The three questions are now a real page, `/welcome`, reached only by a
server-side redirect from `app/(app)/dashboard/page.tsx`** — the one page
a fresh signup or sign-in ever lands on by default (`ClerkProvider`'s
`signUpFallbackRedirectUrl`/`signInFallbackRedirectUrl`, both auth pages'
own `fallbackRedirectUrl` props: all three say `/dashboard`, confirmed by
reading the code rather than assumed). `/welcome` sits OUTSIDE the
`app/(app)/` route group, a sibling of `/sign-in`, `/sign-up` and
`/pilot`, so nothing renders behind it — no `<Sidebar>`, no `<Topbar>`,
nothing carrying the very menu items these answers decide.

**A deep link is never intercepted, by construction rather than by
promise.** The redirect lives in exactly one page — `lib/onboarding-gate.ts`'s
`redirectToOnboardingIfUnasked`, called only from `dashboard/page.tsx` —
and `lib/onboardingGateCensus.test.ts` fails the build the moment a
second page starts calling it. A signed-out visitor following a link
straight to a job or invoice hits `requireCompanyContext`'s own
`/sign-in` redirect and Clerk's `redirect_url` mechanism (which takes
precedence over the fallback whenever one is present) sends them straight
back to that page, never through `/dashboard` at all.

**Existing companies are never redirected — not as a special case, as a
fact about the data.** New migration `20260921000000_backfill_business_scope_asked_at`
(data-only, additive, no schema change) sets `businessScopeAskedAt` to
each row's own `createdAt` for every company that predates it. After
that runs, `businessScopeAskedAt IS NULL` means "created after this
shipped and never asked" — not "never got around to answering," which is
what it meant for both a brand-new signup AND a two-year-old company
before this migration. `shouldGateToOnboarding` (the one function both
directions read) cannot tell those two apart from the column alone
any more than it could before; the backfill is what makes them actually
different rows.

**Never a trap.** `/welcome` re-checks the exact same condition on every
load (`redirectAwayFromOnboardingIfAsked`) and bounces itself back to
`/dashboard` the moment it stops applying — already answered, already
skipped, or a MEMBER who was never able to answer it in the first place
(a company's first user is always its OWNER; a MEMBER only joins an
existing one). A stale bookmark, a forwarded link, or hitting back-then-
forward all land here with no assumption that reaching the URL was proof
of anything. Skipping still means skipping, permanently — the SAME
`skipBusinessScopeQuestions` action from #390, unchanged, stamps
`businessScopeAskedAt` without setting any answer, which is what makes
skip and "answered nothing" the identical, nav-shows-everything state.

**Copy and layout pass, same session, Cyrus's second round of feedback
after seeing the page live.** The three questions, the wording of each
("Does the GC make you fill in a form every month before they will pay
you?" stays exactly as written), the "twenty seconds" line and the
"nothing is ever hidden for good" reassurance are the same sentences
#390 shipped — none of that was rewritten. What changed is order and
weight: a new one-line lead ("This helps us set C Stream up around the
way you actually work") now opens the page, and the reassurance moved to
a quiet line under the questions instead of a dense paragraph above them.
`BusinessScopeFields.tsx` gained a presentation-only `spacious` prop
(Settings keeps the original compact layout; `/welcome` gets larger
question text, more air between the three questions, and options that no
longer sit tight against their label) — the questions themselves are the
same fragment either place, so the two forms cannot drift on what they
ask.

**Testing.** Full suite 349 files/5689 tests green (main has moved well
past #390's own count since it merged, from unrelated work — this is not
a delta against it), typecheck clean, lint unchanged from baseline
(pre-existing warnings only), `next build` compiles clean and fails only
on the documented `Missing publishableKey`/`DATABASE_URL` case,
`preflight.sh` migration report: additive only. 5 mutations requested, 5
caught, each breaking exactly the test named and nothing else (all
restored): the owner check dropped from `shouldGateToOnboarding` (3 red),
the null check inverted (6 red), the redirect call removed from the
"in" function (2 red), the guard inverted in the "away" function (4
red), and a second page made to call the "in" function directly —
simulating the exact deep-link-hijack this feature exists to prevent —
which the structural census caught by name. `onboarding-gate.dbtest.ts`
(new) reads the migration's own SQL off disk and runs it against a real
Postgres rather than re-typing the UPDATE statement as a second copy that
could drift — NOT run this session, no scratch database available;
written and left for CI / the next session, per CLAUDE.md's rule against
claiming a suite passed without running it.
