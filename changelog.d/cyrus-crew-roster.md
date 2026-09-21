### A contractor can add his field crew, and log their hours from the office (Cyrus)
`cyrus/crew-roster`

**What a union drywall sub saw before this.** Signed in as a brand-new
owner, the dashboard's getting-started checklist says "Add your crew" and
links to `/team`. `/team` offered exactly two things: invite a teammate by
email, and a sign-up link to share. Nothing on the page said anything about
a person who does not have a company email address and never will.

He has fifteen to forty of them. They are the reason he is here — certified
payroll, the apprentice ratio and the WH-347 are all computed from their
hours. He does not file that as a bug. He concludes the payroll half is not
real and stops believing the rest of the page.

**The mechanism, verified against `main` rather than taken from the
report.** `app/(app)/team/page.tsx` wrapped the whole crew section in
`crew.length > 0 || archivedCrewCount > 0`, so it did not render when empty
— the empty-state failure where the only affordance that would create the
first record is hidden until one exists. It costs nothing to anybody
building the app, because they all have data. The only working path was
`Settings → Import → Crew (CSV)`, owner-only, and nothing on `/team`
mentioned it.

The second half of the report checked out too. `TimeEntry` has named a
`User` OR a `CrewMember` since #292 — a database XOR check enforces exactly
one — and the phone's API has written both ever since. `logTimeEntry` had
not caught up: it read `employeeUserId` and looked the id up in `User`, so
the ONE screen where hours are typed with a keyboard offered only people who
had completed a Clerk sign-up. A crew member's hours could be entered on
site and not in the office, which is where a certified payroll actually gets
typed up.

**No schema change.** The columns were already there and already nullable;
what was missing was a form, a dropdown and a decision about who may use
them.

**What is on `/team` now.** A Crew section that always renders, with its own
empty state naming what a crew member IS ("no login, no email needed") and
an add form open on the screen rather than behind a button when the list is
empty — a button whose only job is to reveal a form is a step for no reason
on a page that has nothing else on it. First and last name are the only
required fields; craft and employee number are optional, and the form stays
OPEN after a save with a line confirming who landed, because a crew is
entered off one sheet in one sitting and closing the form after each name
turns a list into fifteen button presses. Inline row edit, two-step archive
through the shared `ConfirmDelete`, and the spreadsheet import moved onto
this page instead of living only in Settings — forty hands typed one at a
time is not a serious offer.

**The name cannot be edited, and the form does not pretend otherwise.**
`prova_crew_member_identity_lock` refuses any change to a legal name at the
database, because a signed and filed WH-347 names this person. So the edit
form renders the name as text with the reason beside it and offers the
employee number and the craft, which are what a payroll office actually
sends over later. An input for the name would have worked perfectly in
`next dev` and been a dead button in production, where a thrown Server
Action message is redacted to a digest.

**THE PERMISSION ANSWER, AND IT IS A CHANGE.** Creating crew was owner-only
— `importCrew` still is on `main`. `PAYROLL_COMPLIANCE` is the job function
of the person who runs certified payroll every week; she holds
`MANAGE_FIELD` and `MANAGE_COMPLIANCE` and is not the owner. She could
already import the payroll REGISTER, which is deliberately not owner-only
for exactly this reason, and could not create the crew members its rows have
to match. The person whose job it is could not do it.

So adding a crew member — by hand or by spreadsheet — is `MANAGE_FIELD`
now, and grants nobody a login or access to anything. **Archiving keeps the
owner gate**, and the asymmetry is the decision rather than an oversight:
there is no un-archive anywhere in this app, so it is the one-way door.
`archiveCrewMember`'s own comment claimed the two were the same pair; that
sentence is corrected rather than left standing. The cost, stated plainly:
because the name is locked, correcting a misspelling means archive-and-re-add,
so an office manager who fat-fingers a name can add the corrected person but
needs the owner to retire the typo.

Setting which CRAFT somebody works under stays `MANAGE_COMPLIANCE`, matching
`setWorkerCraft` on `/union-compliance` — fringe rates and the apprentice
ratio are computed from it, and writing the same row from a second form
under a weaker capability would be a hole opened by a second door. The field
is not rendered to somebody the action would refuse, so it is never a dead
control.

**The opening paragraph is gone rather than reworded.** It read: "Two
separate things. Owner decides who can administer the account… A job
function decides what someone sees, and leaving it unset gives the full
office access every member has always had." Every sentence was true, and it
was three clauses of permissions abstraction aimed at a man who hangs
drywall. The job-function dropdown already says it better at the moment
somebody is deciding — its first option IS "Full office access (default)"
and it prints what the choice means underneath. What the top of the page
needed was the fact nothing said: this page holds TWO KINDS OF PEOPLE.

**The web time-entry dropdown.** One list, teammates and crew, posting
`user:<id>` / `crew:<id>` — the prefix convention the crew schedule and
`setWorkerCraft` already use, because `user_abc` and `crew_abc` are
different people in different tables. `employeeUserId` is still accepted
when the new field is absent, since the Ask assistant's direct command posts
it and has no form to notice. A bare id is REFUSED rather than guessed at as
a user id: guessing turns a missing prefix into a silent misattribution on a
government form instead of a visible refusal.

**One defect found while building it, which would have shipped looking
correct.** The duplicate-submit guard filtered on `employeeUserId` alone. On
a crew entry that column is NULL, and `{ employeeUserId: null }` matches
every crew row on the job — so two crew members with the same eight hours on
the same cost code within ten seconds, which is what a crew sheet IS, would
have had the second one refused as a repeat of the first. Both identity
columns are in the `where` now, with a test that fails if either leaves.

**THE CHECKS.** 357 files / 5,829 unit tests, typecheck, lint, production
build and `./scripts/preflight.sh` all exit 0, read as exit codes rather
than off the tail of the output.

Thirteen mutants, each broken, watched go red, and restored:

| # | Mutation | Killed by |
| --- | --- | --- |
| 1 | re-wrap `<CrewRoster>` in `crew.length > 0` | `crewRoster.test.ts` source scan |
| 2 | `CrewRoster` returns null when empty | 5 render tests |
| 3 | hide the add form while the list is empty | 3 render tests |
| 4 | select renamed back to `employeeUserId` | `logTimeEntryForm.test.ts` (all 4) |
| 5 | duplicate guard drops `crewMemberId` | "does not mistake a second crew member for a repeat of the first" |
| 6 | drop the legacy field the assistant posts | "still accepts the old field name" |
| 7 | owner gate back on `importCrew` | "lets the payroll & compliance manager import crew" |
| 8 | edit writes the locked legal name | "never writes the legal name" |
| 9 | craft write loses its capability check | "refuses a craft to a foreman" |
| 10 | archive loses its owner gate | "still refuses her the archive" |
| 11 | bare id parsed as a user id | 2 `worker-select` cases |
| 12 | CSV import taken back off `/team` | "offers the spreadsheet import here" |
| 13 | the source scan stops judging anything | its own 4 fixture cases |

**The empty-state guard asks the question twice, on purpose.** A render test
alone passes on a perfect component wrapped in `{crew.length > 0 && …}`,
which is the original bug with extra steps. A source scan alone passes on a
component that returns null. So `crewRoster.test.ts` renders the component
AND reads `/team`'s source for a conditional wrapper around the element —
and because a scan that derives its input has two failure modes (CLAUDE.md),
the element is counted before it is judged, the comment-and-string blanking
is checked against markers it must not have eaten, and the judgement itself
is run over eight fixtures including a conditional SIBLING, an optional
chain, and a comment quoting the forbidden pattern. Mutant 13 is that half:
a checker that has stopped distinguishing them fails here rather than
passing everything downstream.

**Not done, and worth knowing.** A brand-new company has no union local and
therefore no craft classification, so the craft field is not offered on a
true first run — the form says where crafts come from and saves the person
without one, rather than showing an empty dropdown. `ArchiveCrewButton.tsx`
is deleted; its behaviour moved into `CrewMemberRow` so arming the archive
hides the Edit beside it, which a separate button could not do.
