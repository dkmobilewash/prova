### "Walk me through this page" on fourteen more pages — money, paperwork and the yard (Cyrus)
`cyrus/walk-wave2a`

The second wave of the guided tour from the Help button. Covered now:
`/alerts`, `/backcharges`, `/bids`, `/cash-flow`, `/catalog`,
`/certifications`, `/closeout`, `/compliance`, `/drawings`, `/equipment`,
`/intake`, `/lien-deadlines`, `/material-orders`, `/messages`. Each is
taken off `ROUTES_WITHOUT_WALKTHROUGH`; the other half of the list is a
parallel branch (`cyrus/walk-wave2b`).

Every page carries steps for its EMPTY state as well as its full one — "No
bids logged yet" says bids are added from a contractor's page under
Contacts, the cash-flow page says invoices are made on the job, "No lien
deadlines" says an empty list means nothing was typed in, not that nothing
is running. The overlay skips whichever set is not on screen. Where a form
has a no-jobs fallback (backcharges, drawings, material orders,
certifications), the step describes both, because the same box shows one
or the other. `/messages` puts its "Send an email" anchor on the button and
the open form rather than their wrapper, so a company whose email is not
set up — where that wrapper holds a "sending is switched off" sentence —
is not told to press a button that is not there.

No behaviour changed. Outside `lib/walkthroughs/` the diff is `data-tour`
attributes and nothing else — checked by stripping them from the diff and
comparing the remaining lines, which were identical (64 each side). That
includes Diego's-lane files (cash-flow, catalog, bids, closeout, intake,
lien deadlines), which were announced in #prova-build before the push.

Checked: the census (101 tests) green; six anchors removed one at a time
(`alerts-list`, `closeout-callbacks`, `messages-compose`, `lien-add`,
`intake-table`, `cash-flow-wip`) — six requested, six returned red, each
naming its route — and one step removed (`bids-list`), which the orphan
check caught. Nobody can sign in to a local app (Clerk), so the tours were
not clicked here; the PR carries a click-list.
