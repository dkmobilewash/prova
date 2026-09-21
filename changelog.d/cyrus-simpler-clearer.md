### The bid wizard loses a step, and the bar with nothing to say stops covering the button (Cyrus)
`cyrus/simpler-clearer`

Cyrus measured this in a real browser and it is the reason for half of
what follows: on `/jobs/new/<id>/items` at a 740px-tall window, the
"Continue" button sat at y=674 while the scroll port ended at 631, and
`document.elementFromPoint` at the button's centre returned the company
money bar. The bar read `ESTIMATED REVENUE $0.00 · GROSS MARGIN — · CASH
COLLECTED $0.00 · RETAINAGE HELD $0.00`. **A strip with no information to
give was standing where the primary control of the screen would have
been**, on the second screen of the first job a pilot contractor ever
creates.

**One correction to how that was read, because it changes the fix.**
`MetricBar` is not fixed and does not overlay anything — it is a flex
sibling of the scroll port in `app/(app)/layout.tsx`, 52px tall. So there
is no occlusion anywhere in the app; what `elementFromPoint` reported was
the button being BELOW the port, with the bar occupying the pixels it
would otherwise have used. That is why the fix is to give the pixels back
rather than to change a z-index, and why no other screen needed auditing
for the same defect.

**So the bar renders nothing until it has a figure.** `hasNothingToSay`
(`lib/company-financials.ts`) is false the moment any of the six figures
is a number — including a NEGATIVE gross profit, because "nothing sold
yet" and "this is going badly" must not look alike and the second is what
an owner keeps the bar for. It tests every field of `CompanyFinancials`
rather than the four the bar renders today, so a fifth figure added to
the bar without a line there would be silently suppressed on exactly the
accounts that have only that one; a key-set assertion fails the build if
the interface grows. `components/metricBar.test.ts` MOUNTS the component,
because the predicate having its own passing tests is precisely how
"written, documented, and never called" happens — deleting the one line
that consults it leaves all of them green.

**The wizard is two steps, not three.** "Review" collected nothing, and
its own file said so: *"there is nothing left this step needs to collect
that steps 1 and 2 didn't already save as it was typed, so 'Finish' is a
plain link rather than a submit."* What it rendered was the job name, the
GC and the line items — every one of them typed on the two screens behind
it, every one of them on the job page it handed off to. A review step
earns its place as the last moment before something irreversible; nothing
happens at the end of this wizard, because the job row was written the
instant step 1 submitted. The route redirects to the job rather than
404ing an open tab. `BidWizardSteps`' "Skip ahead — open this bid in full"
went with it: on the last step it pointed exactly where the primary button
points, which is two controls for one destination, one of them whispering
that the wizard is something to escape from. Cyrus read that link as the
author doubting the flow, and he was right.

Both buttons now name their destination — "Start the job — add the work
next" and "Done — open the job" — where both said "Continue", which on the
one control that creates a real row understates it and on the last screen
of a wizard promises a screen that does not exist.

**The `/jobs/new` tour was telling people to press a button that has never
existed.** *"Press Create job. It starts as an estimate, and you land on
the job's page to add prices."* Two false claims in one sentence,
spotlighting the control it was wrong about, to the one reader who has no
way to check. `lib/walkthroughs/quotedControls.test.ts` now treats every
phrase a walkthrough puts in curly quotes as a quotation of something on
screen and requires it verbatim in the app's source.

**That file failed its own mutation test twice, and both failures are the
point of writing it down.** The first version scanned `app` and
`components` and reported `/dashboard`'s “Needs pricing” as a phantom — the
label is real and lives in `lib/estimate-stage.ts`, outside the walk. A
census that calls a true sentence a lie costs more than one that misses,
because somebody then edits the correct string. The second version scanned
`lib` and went GREEN on a mutation that renamed the button without touching
the tour: `lib/walkthroughs/` is inside `lib`, so every quotation was
matching the tour that wrote it, and comments explaining the old label
matched too. Excluding the walkthroughs and stripping comments is the whole
check rather than a detail.

**Ten empty states that described a condition and gave no way out of it.**
CLAUDE.md requires "real empty states with a way out"; `empty-states.test.ts`
is a hardcoded list of 24 top-level list pages, so everything below that
level had drifted with nothing watching. `/prevailing-wage` was the worst:
*"No wage determinations recorded yet. Upload one on a job first"* — it
NAMED the way out and then gave nothing to press, which is worse than
saying nothing, because it proves the product knows the answer. Also the
dashboard's own receivables and GC-payment cards (the first screen, the
first morning, two dead ends side by side), `/contacts/[id]`'s invoices
and jobs, `/union-compliance`'s two, and `/punch-lists`' "Nothing here." —
two words on a list that is empty only because a filter is on.
`/prevailing-wage` and `/union-compliance` are now rendered in
`empty-states.test.ts` and asserted to offer a link.

**Text nobody could read, and the census that could not see it.**
`MetricBar`'s labels were `text-slate-500` — **3.66:1** on `surface`, at
10px, uppercase, on the strip naming which of four money figures you are
looking at, on every screen, in a truck in daylight. Verbatim the scar
`theme-contrast.test.ts` already records, returning through the door
nobody shut: that census matches `bg-brand`, and a raw grey has no fill to
match on. The disabled nav items were worse at **2.29:1** on both the
desktop rail and the phone drawer — not dim, invisible — on the label that
is the only thing saying which feature is coming.

The new census bans only the shades that fail 4.5:1 on BOTH sides at once:
every dark ground this app paints AND the brand-yellow fill. That lands on
the -500s, is derived from Tailwind's own palette rather than a literal,
and needs no layout — which nothing here has. What it therefore cannot
catch is said out loud in the file: a -600 misplaced on the rail is
legitimate on a yellow fill and invisible to this, and naming the hole
beats a rule that bans the app's own convention. Twenty-odd sites moved to
`text-ink-muted` (6.9:1), which stays plainly quieter than body text, so
the hierarchy the grey was buying survives.

**Our words, on his screens.** `LABOR`, `MATERIAL`, `SUBCONTRACTOR`,
`OTHER` were rendered raw in the cost picker and printed beside every
logged cost as `(SUBCONTRACTOR)`; they have a label table now, asserted
exhaustive against the enum as `jobs.prisma` declares it rather than
against its own TypeScript union — a table checked against itself passes
on any pair of matching mistakes. `placeholder="cost-only"` was a phrase
from the data model sitting in a box as if it were an instruction.
`placeholder="Amount"` said nothing about dollars, in a 24-character box.
`confirmLabel="Confirm"` says confirm what. `NoAccess` explained itself in
terms of "your access" and "your job function", which are this app's words
for its permission model and nobody else's. The getting-started card
called Ask C Stream "the assistant", a second name for the thing the nav
rail names, on the card a brand-new owner reads first.

**Not done, and deliberately.** The `/welcome` gate, the empty dashboard's
eleven mostly-empty sections, making the GC optional at job creation, and
three nav labels are all in another agent's lane or are product decisions —
they are in the report to Cyrus with a recommendation each, not in this
diff.

Eleven mutations run, eleven caught — two of them only after the census
that missed them was fixed.
