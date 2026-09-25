### Thirteen estimating features now get clicked by a machine (Cyrus)
`cyrus/estimating-e2e`

Between 22 and 24 Sep, thirteen estimating and takeoff features merged —
#435, #460, #467, #470, #476, #491, #492, #494, #496, #499, #500, #502 —
and every one of their PR bodies ends with the same sentence: *"Nobody has
clicked it."* The pure arithmetic under them all has unit tests. Not one
SCREEN had coverage of any kind, and three query modules had none either.
So a page could render an error boundary, a form could refuse in silence,
and nothing in this repo would know — which is precisely the state the
whole `e2e/` directory was written to end after 2026-09-21.

Three new Playwright specs, on three new personas, in the shape
`journey.spec.ts` set:

- **`estimating-spine.spec.ts`** — the Estimate tab's five panels; wall
  types and a job's wall schedule turning one run into four derived lines;
  the bid recap's cost types, rates and apply; labor hours and a production
  rate saved and read back; an estimate template created on `/catalog` and
  applied; the proposal clause library and a job's proposal document; the
  job's gross area and the conceptual $/SF calculator.
- **`takeoff-plan.spec.ts`** — a real PDF opened by pdf.js, the scale set by
  two clicks and a typed dimension, a run traced, and the measured quantity
  arriving on the estimate as an unpriced line named after where it was
  measured. This is the one feature in the batch that cannot be checked any
  other way: the unit suite runs in happy-dom, where
  `getBoundingClientRect` returns zeros, so a tool that turns a click
  position into a fraction of a page width is invisible to it.
- **`bid-desk.spec.ts`** — the four panels #491/#492/#494/#496 stacked into
  one row of `/bids`: alternates, unit prices and allowances with what each
  does to the total; an unacknowledged addendum making the bid
  non-responsive and the acknowledgement clearing it; two quotes where the
  cheaper one leaves the soffits out; a won bid linked to the job it became.

**Every `expectHealthy` is passed its monitor.** A call without one never
looks at what the browser threw — the "absence of a failure is not a pass"
shape, wearing an assertion's clothes.

**No assertion here judges a money formula, deliberately.** What a markup
or a variance SHOULD come to is Diego's call, and a figure pinned by
something that cannot see the screen is worse than no figure. The money
assertions are arithmetic these files supplied themselves (1,000 SF at
$2.00 is $2,000 direct; $120,000 plus an accepted $12,400 alternate is
$132,400; $82,000 against $79,000 is a $3,000 spread) plus the structural
claim that applying a recap reached the database — the unit price read back
from the server is no longer the one that was typed. The exact totals are
on the click-list for a person.

**Geometry is asserted to the precision a mouse has.** A click lands on a
device pixel, so a fraction of a 300px-wide sheet carries about ±1/300;
40 ft is asserted within 1.5 ft and the sheet's 100 ft width within 3 ft.
What is asserted EXACTLY is that the figure the overlay read while the
shape was a draft is the figure the server re-derives from the stored
geometry afterwards — the round trip, not the rounding.

**Two `.dbtest.ts` files for the two query modules that had nothing**, and
both were mutation-tested rather than argued:

- `conceptual-estimate-query.dbtest.ts` — drop the `COMPLETE` filter and 4
  tests go red (a running job priced at $900/SF walks into the range); drop
  the `companyId` and the same 4 go red on another company's $500/SF work.
- `takeoff-currency-query.dbtest.ts` — reach bids by `companyId` instead of
  `wonJobId` and 2 go red; drop the `affectsPricedScope` filter and 1 does;
  drop `companyId` from the plan query and the tenancy test does. Same-day
  revisions must not supersede, and an undated addendum has to be REPORTED
  rather than dropped, because it cannot be placed in time either way.

`takeoff-plan-view.ts` was on that list of three and gets a **unit** test
instead, said out loud in the file: it opens no database and has nothing to
query — it is pure types plus the `TOOLS` constant. What is worth holding
there is the decision its own header records, THERE IS NO CEILING TOOL,
because a traced polygon has an area and not a length and a width. That was
a comment; it is a test now.

**One thing this branch got wrong, and the guard that caught it in
seconds.** The first draft of the specs wrote `[data-tour="…"]` selectors
literally. `walkthroughCensus.test.ts` counts every `data-tour` literal in
`apps/web` with `git grep` and requires the import walk from the app's own
pages to reach all of them — and a spec file is in no page's render graph,
so the count went 281 against 277 and the build went red naming the gap.
`e2e/lib/dataTour.ts` exists for exactly this and says so at length; the
specs now use it. The census's exclusion list covers `*.test.ts` and not
`*.spec.ts`, which is why nobody had hit it before — the existing specs all
went through the helper.

**One race these specs had, fixed before CI ever read them.** A dozen
assertions here read a value back after a reload, which is the right way to
prove a write landed — but `click()` resolves when the button is pressed, not
when the action answers, so `click(); await page.reload()` navigates out from
under an in-flight `fetch` and races the write it is about to check. That check
then fails, or worse passes, for a reason that has nothing to do with the
feature. `settleAction` in `e2e/lib/journey.ts` arms a response wait first and
returns when the server has answered; every read-back in these three specs goes
through it, and it takes a callback because half of them are a `<select>`'s
change rather than a press.

**AND THE THING THAT ACTUALLY STOPPED THIS BRANCH: THE E2E SUITE COULD NOT
GROW A PERSONA AT ALL.** Adding three was the first time
`clerk.users.createUser` had been reached in weeks — the six existing personas
are found by the read above it, so the create path only runs the day somebody
adds one — and the `striking-jaybird` DEVELOPMENT instance answered `422`. The
whole log was nine words: *"ClerkAPIResponseError: Unprocessable Entity"*. It
named neither the persona nor the problem, Playwright collected 62 tests and
returned 0 verdicts, and there was nothing else to read.

So the failure was made to say everything: which persona by its `PERSONAS` key,
Clerk's `code`, its `longMessage`, its `meta` and its trace id — and "Clerk
returned no errors[] to report" out loud when there is none, because that is a
different fact from nobody having printed it. One CI run later it answered:

    HTTP 422  [form_data_missing]
    ["phone_number" "username"] data doesn't match user requirements set
    for this instance

Not a quota — the instance requires a username and a phone number, and has for
longer than anybody knew. Every persona carries both now, the phones inside
Clerk's own reserved `+1 555 555 01xx` test block for the same reason the emails
carry `+clerk_test`: nothing in that range can reach a handset. `personas.test.ts`
pins the three identifiers Clerk rejects a duplicate of, by NAME rather than as
a count, because a collision would arrive as one more bare 422 in global setup
with no test to attribute it to. Three mutations, all caught: a duplicate phone,
a phone outside the reserved block, a blank username.

`skipPasswordChecks: true` went at the same time. It means "accept this password
without validating it" and there is no password — `skipPasswordRequirement` is
the point. It had been passed since this file was written, for the same reason
nothing else here was noticed: the call was unreachable.

**WHAT THE FIRST REAL RUN SAID, and it is the reason to read this entry
carefully: 42 of these passed, and every one of the five failures was a
SELECTOR, not a feature.** Three were mine, all the same mistake — Playwright's
`getByRole`/`getByText` match by SUBSTRING unless told otherwise, and this app
puts the same words in two places on purpose:

  - `/wall-types`' page title is "Wall types" and its empty state's heading is
    "No wall types yet", which contains it;
  - the takeoff tab's h2 is "Takeoff" and the job's own h1 is its NAME, which in
    this spec's fixture contains the word;
  - `ConfirmDelete`'s describe text is a hidden tooltip in the same row, and it
    quotes the thing back — "Removes ZZ-E2E Acme Framing's quote from this
    comparison" — so the vendor's name is on the page twice.

In every case the write had LANDED and the row was on screen; the spec refused
to look at it. `exact: true` throughout, and the comment at each site says which
of the three it was, because the next person writing a spec against these
screens will hit the same thing.

One more of mine was a genuine misreading of a screen rather than a selector:
the proposal clause LIBRARY renders a clause as an editable input's value, not
as page text — it is an edit-in-place row — so the read-back now asks the input
for its value. The job's proposal is where the clause prints as prose.

**And one failure that is NOT this branch's and is fixed anyway, because it is a
broken test rather than a product judgement.** `dashboard-empty.spec.ts` asserts
that each Getting-started step links to its page, and asserted it as "this
step's only link has this href". #413 (21 Sep) put a SECOND link inside the same
`<li data-step>` — the "Ask C Stream" prompt pointing at `/ask` — so the locator
resolved to two elements and Playwright refused, four days before anybody ran
it. Nothing about the dashboard is wrong: the step does link where it says. It
asks "a link with this href is in this step" now.

**THE SECOND RUN: 47 passed, and the two remaining spec failures were worth
the trip.** One more of mine was the edit-in-place shape again — a wall RUN's
name is an input's value, not page text — and the four derived estimate lines
above it had already proved the run saved.

The other is the one to read. `bid-desk` set the GC's answer on an alternate to
"took it", pressed Save, got a success, reloaded — and the bid still read
`Alternates accepted $0 of $12,400 offered`. The answer had not been written.
The cause is not in the feature: `setBidLineAccepted` reads `"yes"` and writes
`true`, correctly. It is that the spec reloaded the page and then set a
`<select>` before React had attached. `ActionForm` is `onSubmit` +
`preventDefault`, so nothing on that panel works until hydration — and a
`<select>` set in that gap is snapped back to its server-rendered default, so
the post carried "not said" and the save reported success. The reload before
those figures is gone (the action's own `revalidatePath` already re-rendered
them from the server, so it added nothing), the answer is now set on a page that
three prior submits have proved interactive, and the control is read back before
it is submitted — because the failure being guarded against is a value that was
set and then silently un-set.

Worth stating plainly for whoever writes the next spec here: **a reload puts you
back before hydration, and this app's forms are all client-side.** Assert
server-rendered text after a reload; press things only on a page you have
already pressed something on.

**ONE DELIBERATE SOFTENING, flagged so it can be overruled.** These three specs
ended by asserting that no React #418 hydration mismatch had been seen. It has
been — on `/jobs/new` and the job tabs, the SIGNED-IN SHELL race diagnosed in
#501 with the fix pending. `journey.spec.ts` step 11 already fails the whole run
over it, by name, listing every URL. Four specs red for one defect that belongs
to none of them would bury whether the estimating screens work, so these three
record it as a test annotation and assert `monitor.crashes` — an uncaught
exception, a page that actually fell over — instead. The comment at each site
says to put the assertion back the day #501 lands, and it is one line.

**WHERE IT LANDED: 59 of 63 passing, `takeoff-plan` and `bid-desk` green end to
end, `estimating-spine` green with one last selector of the same family fixed
(`main` holds the printed clause AND the picker's `<option>`, which reads
"Exclusion — <the clause>"). The only remaining red is `journey.spec.ts` step
11, the #501 shell hydration race — 21 mismatches across /jobs/new, the job
tabs, /dashboard, /ask, /alerts, /messages, /schedule, /compliance,
/union-compliance, /safety, /vendors/pricing and /settings — which is Diego's
pending fix and was red on `main` before this branch existed.**

Worth saying about the four runs it took: not one failure was a defect in the
thirteen features. Two were the suite's own infrastructure (a Clerk instance
that would not mint a persona, and nothing saying so), six were selectors
matching a substring in two places, and one was a spec pressing a control before
React had attached. The features themselves — the wall schedule deriving four
lines from one run, the recap applying markup to a line price, a template
appended, a measured 40 ft reaching the estimate unpriced, an unacknowledged
addendum making a bid non-responsive, two quotes levelled with their exclusions
— did what they say on the first run that could reach them.

**AND A SMALL ACCESSIBILITY FINDING THAT FELL OUT OF THE LAST SELECTOR, for
Diego rather than fixed here.** `ConceptualEstimateHelper` is rendered INSIDE
the "Estimated value of our scope" `<label>` (`BidPursuitList.tsx`), so that
field's accessible name is its own text plus everything the calculator renders —
including "Gross area of the building (SF)" and the "Not saved — this is a
calculator" prose. Two textboxes answer to that name by substring, which is how
the spec found it. The consequence for a person using a screen reader is that
announcing the pursuit's value field reads the whole calculator as its label.
The comment above the helper already says "BESIDE the field, never inside it";
making it a sibling of the label rather than a child would satisfy both that
sentence and the screen reader. It is Diego's markup and his call, so the spec
asks for the name exactly and says why.

**What still has no coverage, stated rather than left to be assumed.** The
`/api/takeoff/plan/[planId]` route is stubbed in the browser by the takeoff
spec (the fake blob it would proxy does not exist in the suite), so its own
tenancy and capability checks are still unproven. The actual-vs-estimate
production back-check (#435) needs hours logged against a line and is not
driven. Neither is the wall schedule's "Refresh from wall types", the
takeoff area and count tools, a multi-sheet plan, or a SETTLED bid outcome
— that one needs a COMPLETE job with real costs on it.
