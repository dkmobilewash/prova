### The phone-width suite that existed but had never run anywhere (Cyrus)
`cyrus/e2e-mobile-ci`

`apps/web/e2e/` is eighteen Playwright specs, a `mobile-375` project, a
database-safety guard and a long docstring explaining that this is the only
suite in the repo that can see layout, because the unit suite runs in
happy-dom and happy-dom does no layout. No workflow invoked it. Checked
twice over: `grep -rln "playwright\|test:e2e" .github/workflows/` returns
nothing, and the repository's entire Actions history has only ever run three
workflows — CI, Migrate, and Migrate demo database. So every phone-width
claim about this product was still a claim.

**Why it could not simply be switched on.** `globalSetup` mints four Clerk
users through the Backend API before any browser opens, so the whole suite
needs a Clerk development instance — including `pilot.mobile.spec.ts`, which
signs nobody in and asserts nothing but `scrollWidth <= innerWidth`. Those
secrets are Diego's to add and are not added yet. A suite that needs a
credential nobody has is a suite that keeps not running.

So it is now two suites over one set of specs. `pnpm test:e2e:public` runs
every page reachable WITHOUT signing in — the landing page, `/pilot`,
privacy, terms, the QuickBooks disconnect page, the GC portal and the
e-signature page — at 320, 375 and a 1280 control, against a throwaway
Postgres and no credentials at all. `pnpm test:e2e` is unchanged.
`.github/workflows/ci.yml`'s `e2e-public` job runs the first on every PR and
its `e2e` job runs the second, failing by name when
`E2E_CLERK_PUBLISHABLE_KEY`/`E2E_CLERK_SECRET_KEY` do not exist rather than
skipping. (This entry said `.github/workflows/e2e.yml` when it was written.
That file was never pushed — its PR's workflow push was rejected — so the two
jobs live in `ci.yml` instead. Corrected here rather than in `CHANGELOG.md`
because this entry has not been collected yet.)

**A wall worth writing down, because it looks like a broken app.**
`clerkMiddleware()` runs on public pages too, and a DEVELOPMENT instance
answers a browser's first request with a 307 to its Frontend API. With a
placeholder publishable key that host does not resolve and EVERY
navigation — `/pilot` included — dies with `net::ERR_NAME_NOT_RESOLVED` at
the top-level URL. A `__clerk_db_jwt` cookie suppresses that one redirect.
It signs nobody in: every request stays anonymous and `middleware.ts`,
`lib/auth.ts` and the capability checks are untouched. There is still no
auth bypass in this suite.

**What the suite found on its first run, and it is on the page the founder
complained about.** The landing page could not be made narrower than 342px.
At a 320px device `window.innerWidth` came back 342 — the browser widening
the layout viewport to hold one unbreakable word, "subcontractors.", 326px
wide at the hero's 48px floor in a 288px box. Isolated by hiding that `<h1>`
and watching 342 become 320. `/pilot` and `/terms` tracked the device width
exactly at the same moment, so it was that element and not the shell.

The reason nobody had caught it is the interesting half: **`scrollWidth <=
innerWidth` was TRUE the entire time.** That check asks whether the page
scrolls inside its layout viewport. It cannot ask whether the layout
viewport is the phone. The page passed the check every existing mobile spec
makes while being 22px wider than the screen. The new spec asserts both, and
names them as different questions. 320 CSS px is not an exotic device: it is
the iPhone SE 1st gen and the 5/5s, and it is any iPhone with Display Zoom
switched on.

The floor is 2.5rem now — the largest that fits, measured: at 40px the word
needs 288px in 288px, at 44px it needs 300. Nothing at or above 444px moves,
because the clamp has not been on its floor there, so the measured desktop
scale the comment defends is untouched.

**`main` was red while this was written, and the fix is NOT here.**
`801b7a0d` does not typecheck — #404's demo pay-app panel passes a
`retainagePercent` that another PR had just deliberately removed — and two
landing-page censuses fail with it. Nothing that needs a build can run on
plain `main`, which is how this work started by fixing four files that #441
was already fixing, green and waiting on a human. Those four are reverted
here rather than shipped twice; #441 merges first and this rebases onto it.
The one landing-page change that stays is the `<h1>` above, which is this
suite's own finding and is in neither PR.

**The e2e port is `E2E_PORT` now, defaulting to 3100.** It was a bare
literal, so two runs on one machine collide and the second gets `next
start`'s "port already used" through Playwright's webServer — which surfaces
as a suite-wide timeout with no results, reading as a broken suite rather
than a busy port. Two sessions lost time to it on the same day.

**Two more things the suite's absence had been hiding.**
`failed-save-keeps-input.spec.ts` opened the contact form by
`[data-opens="contacts-add"]`, which is on the EMPTY-state button — and that
spec runs on a persona seeded with a contact, so the empty state is never
rendered and the locator could never match. It would have timed out one line
before the assertion anybody would have gone looking at. (That assertion is
still correct; the way in was what had rotted.) And `main` itself did not
compile: `801b7a0d` is red, because #404's demo pay-app panel passes
`retainagePercent` to `calculatePayAppSummary` and another PR had just
removed that field, deliberately and with a long comment saying why the rate
must not be in reach of the function that totals retainage. The caller never
needed it — it builds its own withheld figures — so the line is gone.

**The counter that stops this suite going quiet again.** `verdicts.mjs`
counts the verdicts the run returned against the number of tests collected
and fails if they differ, because a run that collected nothing, a run whose
tests were all skipped, and a run where everything passed are the same exit
code. `publicRoutes.test.ts` pins the walked route table to `middleware.ts`
and to the filesystem in the UNIT suite, which does run on every push — add
a page anyone can reach without signing in and the build fails until someone
says whether it is checked at phone width or deliberately is not.

**What is still unmeasured, and it is most of the product.** Every screen a
foreman actually uses on a phone — daily field reports, time entry, photos,
punch lists, safety — is behind `auth.protect()`. Nothing in this change
reaches them, and nothing else can until the Clerk secrets exist. That job
is wired and will fail by name until then, which is the point.
