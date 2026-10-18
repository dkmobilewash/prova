### A result belongs to the sheet it was found on, and a legend is not offered for takeoff

**Find the walls was pressed on A120 and its runs appeared on A130 and A140**,
in identical positions, on a partition legend and a details sheet. Reported
from the workspace.

The viewer had already been through this with the wall GROUPS — a find once
showed its runs on sheet 30, sheet 52 and S-101 — and fixed it by keeping the
page beside the result. `wallGroups.ts` says in as many words that the rule has
to live in ONE place every render site reads. Four states added afterwards did
not follow it: the answer-key review, the check's labels, its missed-wall list,
and the name of the view the quantities are about. The groups were right and
everything around them was another sheet's.

`lib/takeoff/perSheet.ts` is now that one place, and both components ask it.
Keyed by page rather than cleared on a page change, deliberately: an effect is
a thing somebody has to remember and the next state added beside it will not be
in its dependency list — and an answer-key review is an hour of judgement that
must survive a glance at the next sheet.

**No quantity could cross sheets, and that was checked rather than assumed.**
Every persisted path — calibrations, measurements, proposals — is keyed by a
`pageId` that is re-verified against the job and company inside the action. The
quantities panel reads the page-guarded value. What leaked was display state,
and the overlay was the visible half.

**The tests that would have caught it.** `perSheet.test.ts` proves the
decision, and three mutations red it, including the one that IS the bug — hand
back whatever was stored last, whatever page is being viewed.
`e2e/specs/takeoff-one-sheet.spec.ts` proves the wiring, which a unit test
structurally cannot: it stitches three different drawings into one set, finds
walls on the first, and asserts zero runs, zero candidates, zero wall groups
and no missed-wall list on the other two — then pages back and requires the
first sheet's work to still be there. Each assertion has a control that fails
if nothing was found in the first place.

### Detection is not offered on a sheet with no floor plan on it

A130 is PARTITION TYPES and A140 is PLAN DETAILS, and both offered Find the
walls exactly as a floor plan does. A wall type drawn in section is two
parallel lines a wall-thickness apart, repeated down the sheet — the most
convincing phantom this product can make, and there is no geometric test that
separates it from a plan. Only the drafter's own words know.

`takeoffSheet.ts` reads the title block and the drawings' captions and returns
a verdict with a REASON. The button stays on the toolbar, greyed, with the
reason beside it and a "Run anyway" next to that — the viewer's own note
records what happens when a control is hidden instead: "no error, no
explanation, just an absence, which reads as 'this feature does not exist'".
The vocabulary is `takeoffRank`'s, which already gets the hard part right,
rather than a third copy of the same word list.

Measured over the real 29-sheet set: 11 offered, 18 refused, with A130 and A140
both reading "Every drawing on this sheet is a details sheet — there is no
floor plan here to measure." A captioned PLAN beats a title that says
otherwise, so a details sheet carrying an enlarged plan is still offered.

There is no automatic multi-sheet run in the product today, so
`skipAutomatically` has no caller yet and says so.

### Smaller things from the same session

An answer key is named from the sheet number the VIEWER reads off the title
block, so it is `A120.key.json` rather than `p15.key.json` on a set whose
ingest never ran the model-backed stage — somebody spent an hour reviewing A120
and then could not find the file. The confirmation names it.

`VERDICT_COLOURS` and `SINGLE_LINE_COLOUR` moved out of the panel into
`answerKeyReview.ts`: `clientBoundary` refused a server module reading them,
which was the right catch — a palette only a browser can read cannot be used by
the thing that grades the browser's work.

All three guards unchanged: 20 fixtures at 15 of 17, the bench at 111 walls
missed and 17 of 60 type-totals outside 2%, the real sheets at 8 of 9 measured.
