### Twenty blind presses to reach A-101, now one

The takeoff pager read `Sheet 23 of 52` between Prev and Next — a position in
the file, not the sheet's own number. So reaching `A-101` on a real 52-sheet set
took **twenty presses of Next**, and every one was blind: nothing told you which
sheet you were near, so there was nothing to aim at.

**That number was measured, not guessed, and it is why this was built first.** A
walk-through of all nine estimating steps on one real bid counted the presses and
typed values each step costs today. Step 2 came out highest at 27 presses — and
**twenty of the 27 were this pager.** It was also the only step whose cost was
navigation rather than a decision somebody has to make, which made it the
cheapest real hour in the table to give back.

The pager now carries a sheet picker: `A-101 · First floor plan`, every page an
option, jump straight to one.

### It queries nothing

The takeoff page **already loads every sheet's number and title** —
`sheetIndexFor`, the same rows the sheet review on that page renders — and used
them for one thing only, the duplicate-walls caution. The numbers were on the
screen and were not reachable. This is one more assignment inside a loop that
was already running; there is no new query, no new column and no new read of the
PDF.

### What it deliberately does not do

**It labels no quantity.** `TakeoffPlanPage.label` is "TYPED, never parsed off
the title block", because "a wrong one labels somebody's quantities with another
floor's name". That argument is about naming measurements and it stands
untouched — nothing here is stored, nothing attaches to a measurement, and the
worst a misread number can do is open the wrong sheet, which the estimator is
looking straight at.

**Every page stays in the list, including the ones nothing read a number off** —
those keep the old `Sheet 23` wording. Listing only the named sheets would leave
a scanned page reachable by nothing but Prev and Next, which is the control being
replaced.

**Prev and Next stay.** Reading a set is often "the next sheet" and a picker is
the wrong shape for that. This adds a way to aim; it takes nothing away.

**A title alone is not an option.** `sheetPickerLabel` returns null for a page
with a title and no number: six sheets reading `ENLARGED PLAN` are six options a
person cannot choose between, which is worse than the page number they already
had.

### Verified

Preflight's four gates green, 702 test files, 10,906 tests, no production schema
touched.

The control is its own exported component because the pager renders only once
pdf.js has reported a page count and pdf.js never runs in happy-dom — the same
reason `ClusterTag` is exported from that file. `sheetPager.test.tsx` renders it:
the #665 lesson, that a census proves the code is there and only rendering proves
somebody can reach it.

**Twelve mutations, eleven red** — the viewer never mounting the pager, the
picker dropping unread pages, the jump being swallowed, the picker always showing
sheet 1, Next deleted, Next unbounded at the last sheet, Prev walking forwards, a
bare title becoming an option, a long title never shortened, and the label
leading with the title instead of the number.

**One got past a green suite and added an assertion, which is the useful part.**
Gating the pager behind `pageCount > 10_000` hides it on every set there will
ever be, and every test still passed: the control was mounted, correct, and
rendered by the viewer — just never for a real drawing. *"Is it mounted"* and
*"is it mounted when somebody has a drawing open"* are different questions and
only the first was being asked. The guard is pinned as a literal now, because
what broke was the comparison and a looser assertion would have passed it too.

**And one mutation is still not caught, recorded rather than papered over.**
Putting `hidden` on the Next button leaves the suite green: happy-dom returns it
from `querySelectorAll`, reports its `disabled` state and dispatches its click,
because visibility is a layout question and there is no layout. Deleting the
button is caught; inverting or unbounding either direction is caught. No
assertion was added for the attribute — matching that one mutation would say
nothing about the next way a control gets hidden, the same treatment
`scaleBar.ts`'s redundant zero check and `sheetNumber.ts`'s unproven type-size
sort already get. Visibility is what the click-list is for.
