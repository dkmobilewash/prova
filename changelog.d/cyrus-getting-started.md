### A brand-new account now gets told where to start (Cyrus)
`cyrus/getting-started`

A new account used to land on `/dashboard` with $0.00 tiles, the Ask box,
and one line saying there were no jobs yet. Nothing told a new contractor
what to do first, and the first real test user is a small contractor who
is not technical. So the dashboard now opens with a short "Getting
started" card: name your company, add your first job (by form, or in one
sentence to the assistant), add your crew, put someone on the schedule,
log your first day on site — plus two optional steps, bringing in a
spreadsheet and connecting QuickBooks. It shows "3 of 5 done" and
disappears once the required steps are.

Every tick is worked out from real rows on every load, never saved. A
stored "step done" flag would stay ticked after somebody deleted their
only job; this cannot. The company-name step recognises the two names
sign-up invents (`<name>'s Company`, `My Company`); a company genuinely
named that way stays unticked, which is the harmless direction to be
wrong in.

Each step is shown only to someone who can actually do it. A foreman sees
three steps, not a link to Settings that refuses him; renaming the
company, inviting people, importing and QuickBooks are owner-only because
those pages and actions already refuse everyone else.

"Hide this" is a cookie read on the server, not a column — it is a
preference about one card, not a fact about the business, so no
migration. The server decides whether the card exists before any markup
is built and the browser never reads the cookie, so there is nothing for
hydration to disagree about. The cookie holds the company id, so hiding it
for one account does not hide it for another on the same browser.

The check: the page itself is rendered in
`app/(app)/dashboard/getting-started.test.ts` — gone when complete, gone
with this company's cookie, present with another company's — and 23
deliberate breakages (each step's rule, the permission filter, the
per-company scoping of every count, the hide-when-complete line) each
turned a test red.

The import step links to `/settings/import`, which is being built on a
separate branch and does not exist here yet.
