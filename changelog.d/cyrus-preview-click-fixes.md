### Two print documents nothing linked to, a crew count of zero above 35 hours, and certified payroll opening on an empty week (Cyrus)
`cyrus/preview-click-fixes`

All found by clicking a real preview against the demo data, signed in.

**Form WH-347 and the fringe remittance sheet were unreachable.** Both pages
were built and each linked back up to its parent, and nothing linked to them.
Every mention was a comment, a permission key, a `revalidatePath`, or (for
the remittance sheet) an Ask citation that only appears if you ask the right
question. Certified payroll now has "Form WH-347 for this week →", carrying
`weekStart`. `/union-compliance` has "Fringe remittance sheet for this month →",
carrying `month`. `lib/routeInboundLinks.test.ts` now fails the build for any
page under `app/` that no string in the app links to. It reads literals through
the TypeScript parser, so a comment can't count as a link. It ignores
`revalidatePath`, `lib/permissions.ts` and Ask citations. It asserts its route
count against an independent walk, and asserts that every top-level source
directory is either scanned or named with a reason. Its first run found the
WH-347. With Ask citations excluded, it also found the remittance sheet. The
five exemptions (Clerk's sign-in and sign-up, `/pilot`, the `/estimating`
redirect, Intuit's disconnect page) each carry a reason, and each must stay
unlinked to stay on the list.

**"Crew 0 people" above 35.3 logged hours.** The job header counted
`JobAssignment` rows. That table only holds users, nobody has to fill it in
before logging time, and a crew member without a login can't be in it at all.
It now counts distinct people who are assigned OR have logged hours on the
job, each person once (`crewHeadcount`). The count is derived on every render
and never stored.

**Certified payroll opened on an empty week.** Payroll is run after the week
closes, so the current week is almost never the one wanted. With no
`?weekStart=`, the page now opens on the week of the job's latest hours,
capped at the current week so a future-dated typo can't become the default.
An empty week now points at the week that has hours and at Crew & time. The
copy says "the fringe rate schedule set under Union & fringe" in words,
instead of the model name `FringeRateSchedule`.

**Craft pickers with nothing to pick.** The time-entry and dispatch pickers now
link to `/union-compliance#setup` when the company has no classifications.
`/union-compliance` shows a "Start here: add your local" pointer above the four
sections that read from setup, which is still the last section on the page.

**Copy.** Wall-and-ceiling placeholders on change orders, replacing the tile
backsplash (placeholder text only: change orders are Diego's lane, and #436's
date work in that file is untouched). Trade scopes read "EIFS" and "Lath &
plaster" from `lib/trade-scopes.ts`, not the enum lowercased. Stored values
are unchanged. `/safety` no longer says "No cases logged" twice. It's "C
Stream", not "cstream", and "program"/"check", not "programme"/"cheque". A
parser-backed census in `components/copyFixes.test.ts` pins all of it.

**Not done: dispatch can't name a crew member.** `DispatchSlip.employeeUserId`
is a required `User` key, so recording a hiring-hall dispatch for someone
without a login needs a migration. That goes to Diego before anything is
written.
