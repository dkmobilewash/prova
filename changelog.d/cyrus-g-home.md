### The home page is Concept G: what needs you, the money, today's crews, and each job's next step (Cyrus)
`cyrus/g-home`

The signed-in home used to be a "Today" heading over four count tiles, an Ask
box, a field card, a money section, a job-health list and a long jobs table.
It now opens on a greeting with the day's real counts, the big search box with
four shortcuts (New job, Log hours, Send pay app, Find an RFI), and three
blocks. **Needs you today** has one line per thing waiting, each with one link:
late invoices, RFIs whose answer date has passed, signed days of hours nobody
has approved, papers expiring, and jobs forecast over budget. **Money** shows
billed and collected this month, retainage held and what is overdue.
**Crews today** reads today's crew schedule, not the job roster, because
crew-schedule.prisma says the roster is not today's crew. Under them, **Your
jobs** shows cards with a five-stage strip (Estimate → Contract → Crew →
Billing → Closeout) and one next-action button, both worked out on every load
by `components/home/home-logic.ts`. On a phone, four big tiles come first.

Nothing is stored and nothing is made up. A block with nothing in it says so:
nobody scheduled today links to /schedule. Every shortcut and action is offered
only to someone who can open the page it goes to. The searchable, filterable
list of every job is still on the page, now at `#all-jobs`, and `#jobs` is the
cards.

Checks: `home-logic.test.ts` pins the stage and next-action rules (mutation:
billing on zero invoices goes red). `new-account.test.ts` pins block order,
every figure, the Needs-you links and a FIELD viewer seeing no money (mutation:
showing invoices without billing rights goes red). `evening-dates.test.ts`
still proves an invoice due today is not overdue at 17:01 in California
(mutation: using the server's UTC day goes red). The Ask panel is no longer on
the home. The search box is where you ask now, and /ask is still there, so the
capability census lost its three Ask-card entries for /dashboard.
