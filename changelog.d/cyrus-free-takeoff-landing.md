### A free read of the drawing set, and a page that cannot promise what we cannot do (Cyrus)
`cyrus/free-takeoff-landing`

`/wall-takeoff` is a public page for outreach. A subcontractor sends the
drawing set they are bidding this week, and we email back what we read off
it: every sheet numbered and titled, any sheet number stamped twice, every
schedule on the set typed out as rows, and the set's own particulars. No
charge, no account, no call booked before they have seen anything.

**The problem this page has that the marketing page does not.** A contractor
hands over the one file they cannot un-send, and the page is all they had to
go on. So the offer is not copy — it lives as data in `lib/takeoff-offer.ts`,
and every line of it names the code that produces it. `takeoff-offer.test.ts`
resolves every one of those names: a stage against `plan-ingest/stages.ts`'s
own `STAGE_WORK` map, a module symbol against the file on disk. A page
promising `CLASSIFY` — in the enum, deliberately never built — now fails the
build naming the three stages that are real. Mutation-tested.

The defect it is pointed at already happened one page over.
`components/LandingPage.tsx`'s header records a brief for that page asking
for a panel comparing estimated against actual labour HOURS; this app
compares DOLLARS. One person noticed during the build. No check could have.

**So the page offers less than the first draft did.** Wall measurement is
not on it: `takeoff/wallVectors.ts` and the scale reader run in the plan
viewer with a person present, neither is a `PlanIngestStage`, so neither can
be part of a send-it-in-and-wait promise. A test asserts the copy never
drifts into claiming it, and the limits section says so out loud in the same
type size as the promises.

**Two guards, not one**, per the rule for a canonical list: the backing check
above is completeness, and a second census walks every app source through the
TypeScript parser and fails on a hand-written second copy of any promise —
because a list can be perfect and unimported. It separately asserts the page
reads the real one.

**The size assertion earned itself on the first run.** The stage-map parser
crossed the type annotation with `[^=]*`, and the annotation contains
`=> StageWork`, so it stopped at the arrow and the map parsed to EMPTY. Every
backing check would have passed vacuously. The count, pinned against the enum
in `plan-ingest.prisma`, went red instead and named it.

**Delivery is a plain email with the read in the body** — no attachment, no
link, no login. `packages/integrations/src/email.ts` carries the finding:
HTML mail is measurably more likely to be filtered, and a first email from an
unknown sender carrying a PDF is the most filterable thing we could send.
That choice also removed a token column, a migration and an objection window
from this branch. The text leads with **what we could not read**, before
anything we did: #672 pointed outward, where two whole bid packages turned
out to have no text layer at all. `MAX_EMAILED_SHEETS` is 120 and truncation
says how many it left out; the gap and duplicate sections are never cut.

**Three things were wrong and were caught by one agent reading another's
file**, which is worth more than the fixes. `DELIVERY.form` promised "one
link… a page with everything we read" — written while the share-link was
still the plan, and left standing after the decision that killed it, so the
page promised a link nothing mints. `confirmation()` said "reply to the email
we just sent" and the action sends no email at all, by design, so an install
with no mail provider can still take a request; the on-screen address is the
whole mechanism and now the sentence carries it. And the delivery email
printed `sheetIndexSentence` above the index — the canonical sentence, not
wrong, written for the review screen where `countSheets` files a
read-but-empty title block under `awaiting` while the table renders it "not
read". Measured at "2 need their numbers typed in" above three unread rows.
Both alternatives were worse (a second copy of that sentence here, or editing
a review screen in another lane to fix an email's wording), so the table
stands alone and a test pins the decision.

The action is the only one in this app with no signed-in caller. It resolves
Prova's own operating company from `isProvaOperator` server-side and never
from input, writes exactly three rows, dedupes a resubmission inside 24 hours
(a public form is double-submitted, and two identical leads means somebody
gets rung twice), stops at an hourly ceiling naming the address so nobody is
left with nowhere to go, and refuses rather than throws so production cannot
redact the sentence. Nine dbtests against a real Postgres, including one that
proves it never writes to a company that is not the operator — the only guard
that an unauthenticated endpoint cannot be aimed at a tenant. `@/lib/auth` is
deliberately NOT mocked there: mocking it would hide the property worth
proving.

Not yet clicked by a person. The `e2e-public` suite walks the page at 320,
375 and 1280, which is the only instrument in this repo that can see layout.
