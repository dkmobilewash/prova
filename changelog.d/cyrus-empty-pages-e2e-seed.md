### Certifications starts with its setup, material orders says "nothing" once, and most of the signed-in e2e suite stops failing on the wrong screen (Cyrus)
`cyrus/empty-pages-e2e-seed`

**/certifications.** A company with no requirement and no card on file
used to open on the record form, then four tiles all reading 0, then
"Require OSHA 10 below", and only at the very bottom the section that
sentence meant. For that company the requirements now come first, marked
"Start here", and the tiles wait until there is something to count. In
that state every tile is zero by construction, so nothing is hidden. A
company with anything on file keeps its tiles and its order. Check:
`app/(app)/certifications/setup-first.test.ts` renders the page empty, with
a card only, and with a requirement only. Its three empty-state tests fail
against the old page, and the populated ones pass on both, which is how
"unchanged for accounts with data" was checked.

**/material-orders.** The page said "nothing" three times: the status line,
"0 outstanding", then the EmptyState. It now copies `/bids` and #451. The
status line and the count wait for the first order. The gate is "ever
logged OR rows shown", not the count alone, because #451 found a test
faking a count of 0 while rows are listed. Check: `one-empty-sentence.test.ts`
has a case with rows shown and the count faked to 0. Changing the gate to
count-only turns that case red.

**The e2e seed.** `seedDatabase.ts` created MAIN's company without
`businessScopeAskedAt`, and MAIN is an OWNER. So `/dashboard` sent it to
`/welcome`, which has no Topbar, no Help button, no Ask launcher and no nav
rail. `ask-panel`, `ask-panel.mobile`, `tour` and `money-rail-gate`'s OWNER
test all failed hunting for those. None of it was about the feature they
test. That last one is the costly one: it is the positive control, so only
the negative test ever ran. MAIN is now seeded as an established account.
The brand-new personas (EMPTY, JOB_CREATE, JOURNEY, BAD_INPUTS) are left
alone and still meet the gate, like a real new customer. Check:
`e2e/lib/seedDatabase.test.ts` runs in the unit suite on every push and was
mutation-tested.

**`job-detail.spec.ts`** asserted headings from the single long job page.
Since the tab split, those headings live on the Estimate, Billing and Field
reports tabs. It now visits every tab and asserts what that tab shows. The
old Retainage, Field reports, Pay apps order survives as the order of the
tab rail.

**`jobs-new.spec.ts`** pressed a "Create job" button that never existed
and waited for a redirect the wizard has never made. This was held back
for #413, which changed that wizard. #413 merged without touching this
spec, so it is fixed here against the merged wizard. It now drives
journey.ts's `startJob`/`finishWizard`, the helpers the journey already
uses, so the button labels live in one file. It reaches the dashboard
through the welcome questions, because JOB_CREATE is a brand-new company
on purpose.

NOT EXECUTED: the signed-in specs need Clerk dev keys that the session that
wrote this did not have. They were fixed from source. `test:e2e:public`
and the unit suite were run.
