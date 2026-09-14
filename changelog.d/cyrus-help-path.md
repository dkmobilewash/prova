### There is now a way to ask us for help from inside the app — T5 (Cyrus)
`cyrus/help-path`

The founding-partner one-pager promises "a compliance question at 6 AM before
a certified payroll deadline — you get an answer, not a queue." The product
delivered nothing against that sentence: there was no address, no form, and
no link anywhere in the app. Whoever signs it would have had to already know
an email address that appears nowhere in the product.

**"Help" now sits in the topbar, next to the alert bell, on every screen.**
It opens a small panel, and the panel sends a real email.

**Why the topbar and not the two shapes everybody reaches for first.** A
fixed bubble in the corner is the universal signifier of live chat — it
promises a reply in seconds from a company of two, and it sits on top of the
content it is meant to help with (over the last row of a takeoff on a laptop,
over the Save button of a field report on a phone). A footer link would have
to live in `MetricBar`, which is gated on `VIEW_COMPANY_FINANCIALS`: the help
link would then be invisible to a foreman with no money permission, which is
the worst possible person to hide it from. A rail item would be one of 27
labels inside six collapsed groups since #240, and help is not a place in the
app anyway — it is something you do from wherever you already are.

**It reuses `sendOutboundEmail` rather than adding a channel.** No new model,
no migration, no second provider. That function already gets the hard part
right — the message row and its handover event are written BEFORE the
provider is called, and a failure is recorded with its reason instead of
vanishing — and those are exactly the properties a question sent at 6 AM
needs. The side effect is the best thing about the feature: a help request is
a row on `/messages` like any other mail, with its own delivery status, so
"did my question actually reach them" is something the contractor can answer
without asking us.

**The honest part, and it is not an edge case.** This app sends from the
CONTRACTOR's own verified domain and deliberately has no shared sender —
sending as the vendor is what puts a quote in a GC's spam folder. So on day
one, before a new customer has a Resend key and a verified from-address, the
server cannot send on their behalf at all. The panel therefore has three
states and says which one it is in:

| Support address | Outbound email | What the panel offers |
| --- | --- | --- |
| set | working | a form that sends and records it |
| set | not set up | a `mailto:` to that address, subject prefilled, and the reason |
| unset | either | nothing can reach us, and the setting that fixes it |

The `mailto:` carries the **subject only** — company and page. Not the body:
the body is whatever the person typed, which is the part most likely to be
sensitive, and a URL is the one place this repo will not put user content.
The two context lines are printed in the panel to copy instead.

**What it sends is exactly what the panel lists**: the question, the company,
the page they were on, the job that page belongs to if it is a job page, and
their name and address so we can reply. Nothing else — no screenshot, no
record of what was clicked. `helpBody` is asserted **whole** in
`help-request.test.ts` rather than by a pile of `toContain` calls, because a
substring test can only prove that what is listed is present, never that
nothing else is.

The page the question was asked from is treated as untrusted, and that is not
theatre: it comes from the browser, it goes into an email subject, and the
action answers whoever posts to it regardless of what the panel sent. A
newline, a `//host`, a `scheme:`, a query string or 500 characters of path
all come back as "not recorded" rather than as a cleaned-up guess. The job is
never accepted as a posted id — it is derived from that path and then looked
up scoped to the asker's own company.

**The expectation is printed before anything is typed**: a real person reads
it, there are two of us, we answer within one business day, nobody is
watching a queue at 2 AM. "Instant support" would be a lie, and a panel that
implies it is worse than a quiet email address.

**The checks.** 30 unit tests in `apps/web/lib/help-request.test.ts`, all
written before the code and watched failing (20 of them red against a
deliberately naive stub). Four mutations, each reverted one at a time with
the tests kept: dropping the path charset check reddens two cases including
the newline; making `helpChannel` ignore a broken email setup reddens the
`mailto` fallback and the distinct-kinds count; making the job line
unconditional reddens the "omits the job line" case; deleting `<HelpButton>`
from the topbar reddens the shell-mounting check. That last test exists
because "reachable from any page" is a claim nothing else in the toolchain
can see — the reachability guard is satisfied by ONE caller anywhere, so a
help button wired to a single page would pass it while the feature was
missing from the other forty screens. And the channel cases are a cross
product whose SIZE is asserted, so a third input that decides this cannot
silently halve the coverage.

`SUPPORT_EMAIL` is the new setting, documented in `apps/web/.env.example`. It
is validated with `looksLikeEmail` rather than trusted: an unset variable and
a typo'd one must not look the same, because a panel offering
`mailto:suport@…` is a dead end that looks like a working one.

`requestHelp` is excluded from the Ask box's command surface with a reason.
Reaching a person is the one thing the assistant must not do on somebody's
behalf — the words have to be theirs, and a model-composed question arrives
claiming to be.
