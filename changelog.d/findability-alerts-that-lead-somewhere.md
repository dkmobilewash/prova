### Two alerts that told you about a problem and then dropped you nowhere near it (Cyrus)
`cyrus/seed-counters-zzbqtu`

From the same seven-agent UI sweep as the portal work. The founder's brief
was "anything that takes more than four or five clicks, shorten it" — and the
sweep's finding was that click depth is mostly fine and **findability is
not**. Almost nothing it turned up was a bug in the normal sense: it was
features that exist and cannot be reached.

**One — the certified payroll alert was a six-click dead end.** `alerts.ts`
set `href: "/compliance"`, a page with no certified-payroll sheet on it and
no link to one, while `period.jobId` sat in scope two lines above. So the
most time-critical weekly filing in the product raised an alert you could not
act on: `/compliance`, back to the dashboard, the job, Crew & time, certified
payroll, the week.

It points at the week now. **`periodEnd` is handed over rather than a
computed week start**, because `openingCertifiedPayrollWeek` already SNAPS
whatever it receives to the containing week and falls back to its own default
on anything it cannot parse. So a weekly filer lands on exactly the late
week, a monthly filer on the last week of the late period, and a malformed
value degrades to the page's default rather than to a confidently wrong week.
Computing the start here would be a second implementation of a rule that
module owns.

**Pinned as a regression, not as a census, and the distinction is the point.**
A census that every alert href resolves to a real route would have passed on
this bug — `/compliance` resolves. The defect is semantic: the page cannot do
the thing the alert is about, and nothing mechanical sees that. So it is an
explicit pin with the reason attached rather than a guard pretending to more
reach than it has. Mutation-tested: restoring `/compliance` reds both cases.

**Two — renewal alerts dropped you at the top of a 900-line page.**
`lib/renewals.ts` sent licence, insurance and bond expiries to `/settings`,
which has ten sections and had `id`s on five of them. The three that matter
here had none, so "Licence 8821 — expires in 9 days" meant a scroll.

**That one IS mechanically checkable, so it gets a census.**
`renewalAnchors.test.ts` requires every `/settings#…` href to name an element
that exists. A fragment with no matching `id` fails **silently** — it scrolls
nowhere and reports nothing, which is indistinguishable from a working anchor
on a page you have not scrolled yet. It asserts its own size against a second
expression, strips comments before both reads (renewals.ts and the test both
quote `/settings` while explaining the bug), and says plainly what it cannot
see: that the section an anchor lands on is the RIGHT one. `#licences`
resolving to the bonding section would pass it. Mutation-tested three ways —
href reverted to bare `/settings`, an `id` removed, the href pattern drifted
to match nothing — each red, control green either side.

**Three — a refusal that named one section out of ten.** `/settings` answers
non-owners with "Only the account owner can manage integrations". Integrations
are one of its ten sections; the others are the company profile that prints on
the WH-347, contractor licences, insurance policies, bonds, company locations,
employer burden rates, phase codes and default markup. It now names what is
behind the door.

**AND A PLANNED CHANGE THAT WAS DROPPED AFTER CHECKING ONE FACT.** The sweep
proposed adding `/settings` to `OWNER_ONLY_FOOTER`, on the rule the nav file
states itself — *"a button to a page that only refuses is a door that will
not open."* That was announced in Slack and then **not done**, because
`ALERT_CAPABILITY` gates `RENEWAL` on `MANAGE_COMPLIANCE`: a compliance
member genuinely receives licence and bond alerts, and those alerts point at
`/settings`. Hiding it from their rail would leave them an alert pointing at
a page they can neither open nor navigate to — strictly worse than today.

The real fix is to let `MANAGE_COMPLIANCE` read the licence, insurance and
bond sections, since they are the person chasing the renewal. That is a
permissions decision, it is not one to make on the way past, and it is
recorded here rather than guessed at.

Also recorded, unfixed: `/settings` renders `id="quickbooks-import"` twice.
Both appear to sit in mutually exclusive branches, so the duplicate is
probably never in one document — "probably" is why it is written down rather
than called fine.

**Still held, not shipped:** the global-search aliases. Search returns
"Nothing found" for `certified payroll`, `WH-347`, `DAS-140`, `retainage`,
`takeoff`, `insurance`, `licence`, `bond` and `pay application` — because
`isRelevant` needs a title or route hit, a step title scores 3, and the word
"certified" is in no walkthrough at all. The fix is additive (`aliases?:
string[]` scored 6, `isRelevant` untouched) but `lib/ask/appHelp.ts` is the
AI lane, and the post-and-wait has not been answered by its owner.
