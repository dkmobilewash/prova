### The Ask box logs a bid invitation — phase 4c, the command the estimating exclusions promised once a contact resolver and a date parser existed, with every field the row will carry on the card (Diego)
`claude/prova-ai-task-completion-96pjes`

"Invite Turner to bid on the Riverside drywall" and "log a bid invitation
from Skanska for the Main St ceilings, due October 3" now produce a card
headed "Log the bid invitation" with seven lines — From, Project, Trade,
Due, Notes, Status, Bid amount — and a button "Log invitation". The tap
writes a `BidInvitation` row through a lifted core,
`lib/estimating/bid-invitation.ts`, and `/bids` and the contact's own
page show it afterwards, status Invited, exactly as the "Log invitation"
form at the foot of the contact page would have logged it.

**What a bid invitation is here, read rather than assumed.** There is no
Bids form on `/bids`: that page is a filterable list. The record is
created from the contact page's form (`createBidInvitation` in
`lib/actions/estimating.ts`) with a project name, an optional trade tag,
an optional due date and optional notes; status defaults to INVITED and
there is no bid amount until `updateBidInvitationStatus` records one.
Since that update touches status and amount only, the trade and the due
date are set once and never editable — which is why the card warns when
either is missing rather than treating them as ordinary optionals.

**The exclusion this replaces**, from `lib/ask/commands/estimating.ts`,
quoted exactly: `{ action: "createBidInvitation", reason: "Bid tracking
is a later phase; needs a contact resolver and a due date the person
types." }`. Both halves existed by the time this was built — phase 1's
`resolveContact`, which `create_estimate_job` and `send_email` use, and
phase 4b's `lib/ask/dates.ts` — so the line is gone and the action is
registered. `updateBidInvitationStatus` and `deleteBidInvitation` keep
their exclusions.

**Why a lifted core and not the action.** `createBidInvitation` throws
its two refusals ("Contact not found", "Project name is required"), and
production redacts a thrown Server Action message, so
`commands.coverage.test.ts` refuses a DIRECT command over it. The body is
now `createBidInvitationRecord`, beside `create-job.ts` and
`job-schedule.ts`; the action calls it and rethrows its sentence, so the
form's behaviour is unchanged and the page and the card refuse in one
voice. The core takes `reuseOpenDuplicate`, the command's option like
create-job's `refuseDuplicateName`: an INVITED or SUBMITTED invitation
from the same contact for the same project (case-insensitive) is that
invitation, linked rather than doubled. The form does not set it, so a
GC re-inviting on a project that was LOST is a new row from either door.

**Nothing on the card came from the model.** The contact is resolved by
name from the company's own list — a name matching nobody is a refusal
that points at `/contacts` (the form cannot log an invitation from a
contact that does not exist, so neither can this), several matching is a
chip row on `contactId`, and the resolver's duplicate-contact warning
rides onto the card. The trade is the person's own word — "drywall",
"stucco", "ceilings", "ACT", "fireproofing" — mapped to one of the five
tags in code by whole-word match (`readTrade`); a word naming none of
them is a chip row of the five plus "No trade tag", a phrase naming two
is a chip row of those two, never a pick. The due date goes through
`parseDateWords` against the person's own today with the same outcomes
the schedule command has: a which-year chip row for a month-day already
past, a question back for a relative phrase (a new record has nothing to
count from), a question quoting the words for anything unreadable. The
one figure the row can carry, a bid amount, is not on the form and not
on the card — but the card says so in its own line, so every field the
row will hold is visible before the tap.

**Capability.** Offered on `MANAGE_ESTIMATING`, the capability that
guards `/bids`; ESTIMATOR and PROJECT_MANAGER are offered it, FIELD and
ACCOUNTING are not, and `confirmAskProposal` refuses a member without it
in a returned sentence before anything is claimed. No `requiresAlso`,
because no money is on the card.

**What the tests pin.** `estimating/bid-invitation.test.ts`: the two
refusals as sentences before any write, the contact asserted in-company
in the read itself, the exact `create` data, and that the duplicate check
runs only when asked for. `commands/bids.test.ts` runs `resolve` against
a fake Prisma: the question before any read, the `/contacts` refusal,
contact chips, a chip's id re-asserted in-company, the seven preview lines
and the exact payload, both warnings, the resolver's duplicate warning
carried, trade chips in both shapes and the "no tag" chip on the re-run,
the three due-date outcomes with their sentences and chip values, the
weekday on the card, the open-twin link; and on `execute` the exact
arguments the core receives including the option. `readTrade` has its own
table, with word-boundary cases ("contract" is not ACT). `commands.test.ts`
pins ESTIMATOR gaining `log_bid_invitation`, FIELD and ACCOUNTING not,
and the capability equal to `ROUTE_CAPABILITY["/bids"]`.
`commands.coverage.test.ts` sees `createBidInvitation` leave the
exclusions for a registration. The eval gains three `log_bid_invitation`
cases (the two sentences above and an ESTIMATOR with "10/3") and two
`no_command` cases (FIELD asking for one; "mark the Riverside bid as
won"). `lib/actions/ask.dbtest.ts` proves the tap against a real
Postgres: a FIELD member refused in a sentence with nothing written, the
row landing with the form's own fields and status INVITED and no amount,
a differently-cased twin linked with the count still one, a LOST
invitation followed by a genuine new row, and a foreign contact refused
with "Contact not found".

**Not clicked.** Nobody has loaded a page with this on it, and the routing
eval was not run from here. Whether the model puts "drywall" in `trade`
and "Riverside" (not "Riverside drywall") in `projectName` is asserted by
the schema descriptions and the eval cases, not yet observed. The click
list, on a preview signed in as OWNER on the Development Clerk instance
(the demo database — if it has no contact named Turner, add one on
`/contacts` first and use its name below):

1. `/contacts` → confirm a contact whose name contains "Turner" exists,
   and that none contains "Skanska". `/bids` → note the count line ("N
   bids").
2. Dashboard → ask "invite Turner to bid on the Riverside drywall, due
   October 3".
3. Expect a card headed "Log the bid invitation" with exactly: From
   "<the Turner contact's full name>", Project "Riverside", Trade "Metal
   framing / drywall", Due "Oct 3, 2026 (Saturday)", Notes "none", Status
   "Invited", Bid amount "none yet — entered when you mark the bid
   submitted", and a button "Log invitation". A Due line other than Oct 3,
   2026 is a failure. No card, or a card with a bid amount, is a failure.
4. Tap it. Expect "Logged <name>'s invitation to bid on Riverside, due Oct
   3, 2026 (Saturday)." with a link "Riverside · <name>". Open `/bids`:
   the count is one higher than step 1, and the top row reads "Riverside",
   badge "Invited", "<name> · Metal framing / drywall · Due 10/3/2026",
   no amount. Open the contact's page: the same row under "Bid
   invitations".
5. Ask the same sentence again. Expect a card with NO button, headed by
   the sentence "<name> already has an open bid invitation for Riverside"
   linking to `/bids`, and `/bids`'s count unchanged. A second Riverside
   row is a failure.
6. Ask "log a bid invitation from Skanska for the Main St ceilings".
   Expect NO card and the sentence 'No contact matches "Skanska". Add them
   on the contacts page first, then ask again.' with `/contacts` named.
   Any card, or any new contact on `/contacts`, is a failure.
7. Ask "invite Turner to bid on the Main St ceilings, due sometime next
   month". Expect NO card and a question asking for the bid due date as a
   calendar day, quoting "sometime next month". Any card, or any date it
   picked for you, is a failure.
8. Ask "invite Turner to bid on the Main St insulation". Expect a chip
   row '"insulation" isn't one of the five trade tags — which should this
   bid carry?' with six chips ending in "No trade tag". Tap "No trade
   tag". Expect a card with Trade "no trade tag", Due "not set", and one
   warning about the due date only. Tap Log invitation; `/bids` shows
   "Main St" with no trade and no due date.
9. Ask "invite Turner to bid on the Oak St plaster, due September 1".
   Expect a chip row '"September 1" has already passed this year — which
   due date?' with "Sep 1, 2026 (Tuesday)" (detail "N days ago") and "Sep
   1, 2027 (Wednesday)" (detail "in N days"). Tap the 2027 one; expect Due
   "Sep 1, 2027 (Wednesday)" on the card.
10. In a browser signed in as a MEMBER with job function FIELD, ask step
    2's question. Expect no card and a sentence that it needs estimating
    access (MANAGE_ESTIMATING).
