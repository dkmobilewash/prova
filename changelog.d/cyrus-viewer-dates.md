### Thirteen screens stop being a day ahead of the person reading them (Cyrus)
`cyrus/viewer-dates`

Every evening, for about seven hours, this app told a contractor things
that were not true. An invoice due TODAY read "1d overdue" from 17:00
Pacific and put its whole balance on the first tile an owner sees. A
certification good until today read EXPIRED, on the page whose own copy is
about a man being turned away at a gate. A message sent an hour ago read
as never confirmed. A change order approved at 6pm in Denver recorded
tomorrow's date on a document the GC quotes back — and correcting it the
next morning was refused with "A change order can't be answered before it
was sent", blaming the contractor for typing the right date.

One cause: `new Date().toISOString().slice(0, 10)` is the SERVER'S calendar
day, and west of UTC that rolls over in the afternoon. The dates these are
compared against are plain calendar days — the UTC midnight is only how a
date with no time gets into Postgres — so the day that compares correctly
is the day on the reader's wall calendar. `lib/viewerToday.ts` has known
that since issue #111, and fourteen pages already used it.

**What was measured, not argued.** Fourteen screens are now rendered at
17:01 in Los Angeles and read: `app/(app)/evening-dates.test.ts` (six
screens), `app/(app)/jobs/[id]/change-order-dates.test.ts` and the existing
correspondence-dates file. Before the fix, nine of those assertions failed
and every "the page rendered at all" assertion passed — the $85,000 invoice
really did sit in the 1-30 bucket, really did flip the forecast row from
"Sep 2026" to "Overdue", and really did read $85,000.00 on the dashboard's
Overdue invoices tile at one minute past five.

**`lib/cash-flow.ts` is money code and this did not change a line of its
arithmetic.** Two comments only, saying what `asOf` must be. The defect was
in what the two pages handed it, and flooring the instant inside the
function would not have fixed it — that is still the server's day, which is
already tomorrow. `viewerAsOf()` (new, four lines in `lib/viewerToday.ts`)
is the reader's day at UTC midnight, so the subtraction is exact whole days.

**`components/ChangeOrders.tsx` takes the day as a prop rather than reaching
for `localToday()`,** which is what ~30 other forms use and would have been
wrong here. `<Decision>` renders for every SUBMITTED change order and
`<DraftActions>` for every DRAFT, straight out of the server render — they
are not mounted by a click — and the hidden `decidedOn` inputs are
*controlled*, so a browser-derived day there is a hydration mismatch of the
loud kind.

To be precise about what was NOT wrong, since the obvious guess is wrong:
the old `today()` did not mismatch. `toISOString()` is UTC in every process,
so the server and the browser produced the same string — the same WRONG
string. It was consistently wrong, which is exactly why no hydration
warning ever fired and nothing caught it for months. The prop gets the
right day without reintroducing the risk the naive fix carries.

**/field-reports is fixed rather than exempted, and its comment was the
thing to check.** It argued that because dates are stored at UTC midnight,
"today" for deciding which days are over is the UTC date. The premise is
true and the conclusion does not follow — `lib/viewer-timezone.ts` says why
at length. The cost was specific: `today` decides which weekdays have
FINISHED, so from 5pm a foreman still on site found today already named as
a day nobody filed and the week's coverage dropped to match. That is the
claim #397 removed from the first screen, arriving again on this one.
/pipeline was half-fixed — two different answers to "what day is it", eight
lines apart, the second kept deliberately to match an Ask tool that was
wrong in the same way.

**The guard was the point of the exercise.**
`app/(app)/correspondence-dates.test.ts` banned this expression over three
files named by hand and pinned with `toHaveLength(3)`. Its comment defended
the hardcoding — a glob that stopped matching would assert nothing — which
is true and beside the point: at the moment it was written ELEVEN other
pages carried the exact expression, and a hand-written list cannot report a
file that is not on it. Nothing is ever missing from a list you wrote
yourself, which is `theme-contrast.test.ts`'s scar (CLAUDE.md, 2026-09-16)
arriving from the one direction that file did not cover.

`lib/viewerDayCensus.test.ts` derives the set instead, and asserts the two
things a derived check can get wrong, separately:

- **scope** — roots come from `apps/web/tsconfig.json`'s `include` plus the
  source directory of every `workspace:*` dependency in its `package.json`.
  Add a package to the app and the census extends to it with no edit;
  name a dependency that does not resolve and it fails rather than
  scanning less.
- **size** — the recursive walk is checked against `git ls-files`, which
  knows nothing about it. A wrong root or a broken filter names the files
  it missed instead of passing over nothing.

It parses with the TypeScript AST rather than grepping, which is not
decoration: three files in this repo discuss the banned expression in
prose, including the one that fixed it, and a regex counts all three as
offenders — while missing the same expression split across lines by a
formatter. Comments are not nodes; line breaks are not syntax.

Mutation-tested nine ways. Reintroducing the defect on a page turns the
census red WITH THE FILE AND LINE NAMED, and turns the render test red too.
Narrowing the scope to `app/(app)` — which is what the old guard effectively
did — fails seven assertions rather than going quietly green. Breaking the
finder so it matches nothing fails every vacuity case. Reverting each of the
three fixes turns exactly its own screens red and nothing else.

**Two things recorded rather than fixed, both named in the census so they
cannot be forgotten.** `lib/ask/handlers.ts` has the same defect three
times — the Ask box's first suggested prompt on /dashboard is literally
"What's overdue and who do I chase first?" — and it is Diego's lane, so per
the working agreement it is an issue, not this PR. The census has a second
check for that shape (a bare `new Date()` handed to `daysPastDueFor` and
friends, which has no `.toISOString()` in it and is invisible to a string
search) with that one file listed as known-remaining; the list can only
shrink. And `components/QuickBooksReconcile.tsx` stamps a UTC clock TIME —
"checked at 00:04" for someone who ran it at 5pm. A different question from
a calendar day, so outside this file's rule, and asserted by name so it
cannot grow quietly.
