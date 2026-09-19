### Ask can read the getting-started checklist, and offers to do the steps it has a card for (Cyrus)
`cyrus/ask-getting-started`

A brand-new user asked "Can you help me complete everything in get started
on the jobs and estimates page" and was told "I can't see that page's
get-started checklist — nothing here reads it." That was true. The new read
tool `getting_started` fixes it.

It does not recompute anything. It calls the dashboard card's own loader
(`lib/getting-started-counts.ts`) and the card's own function
(`lib/getting-started.ts`) with the asker's company and role. So the steps
match the card: steps the asker cannot do are left out, and "done" comes
from the same rows. For each step it returns done or not, the card's own
wording, the page link (also cited), and `askCanDo` when a confirm-card
command can do it for this person: `create_estimate_job`, `add_contact`,
`schedule_crew`, `log_daily_field_report`. Renaming the company, inviting
people, importing and connecting QuickBooks stay as page links. The registry
excludes `updateCompanyProfile` and `inviteTeamMember` on purpose, and this
tool does not get around that. If the person hid the card, the tool says so
but still returns the steps.

The check: `handlers.gettingStarted.test.ts` compares the tool with
`gettingStartedChecklist` for five roles and three companies, using a fake
database that applies every where clause. It also spells out the expected
result for a half-set-up company by hand, and pins each offered command's
capabilities to the command's own definition. Mutation-tested: counting
another company's rows, an unscoped company lookup, "crew" computed as
`users > 0`, ignoring the asker's role, and obeying the hide cookie each
turned the suite red.
