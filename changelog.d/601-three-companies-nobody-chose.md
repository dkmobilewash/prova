### The importer could import three companies nobody chose, and the e2e journey caught it on its first run

`required()` and `text()` **trim**, and `listingText` was read through `required`. So the
review screen parsed what was in the textarea and `importSubListing` parsed the trimmed
copy — every line number one lower. The selection travels as POSITIONS, so it resolved
to the rows BELOW the ticked ones.

Measured end to end in CI, on a four-row listing with one leading blank line: the
reviewer ticked **Ridgeline, Harbor Lath and Cedar Ceilings**; the import created
**Harbor Lath, Cedar Ceilings and Pinnacle Electric — the electrical sub deliberately
left unticked** — and Ridgeline never arrived. The screen then said *"15 signals to
check across 3 new leads"*, truthfully, about three companies nobody picked. Every lead
this importer writes is permanently undeletable by design, so the wrong three could not
have been cleaned up.

A leading blank line is not an exotic input. It is what a paste out of a PDF looks like.

**Nothing else in this repo could have found it.** 483 unit tests, 61 db tests and a
real-Chromium run of the component all parse ONE string; the defect is a disagreement
between two readings of one paste, so it only exists across the browser → Server Action
boundary. The signed-in `e2e` journey added hours earlier went red on its first run, on
the step that asserts the ticked companies appear on `/sales`, and the page snapshot
named the electrical sub sitting where Ridgeline should have been.

### And the guard written for exactly this could not see it

*"The listing does not read the same way now as it did on screen"* compares the number
of keys with the number of rows they resolve to. A reading shifted by one line resolves
three keys to three rows, so the count agreed and nothing fired. The row-key fix landed
earlier today does not help either — measured: with keys, the shifted reading still
returns the wrong three.

So the screen now posts the NAME each key stood for, and the server refuses when a
resolved row does not carry it. An identity check rather than an arity one, which is the
shape this class needs.

### Verification, and two guards that had to earn their place

Three db cases: the premise (the two readings disagree about every line number, by
exactly one), that the ticked three are what arrive, and the refusal reached directly.
61 db tests, from 58. 483 unit, from 482.

Five mutations. The trim restored, and the trim-plus-no-guard state that shipped, both
red the import case. Removing the name check alone was GREEN until the third case was
written — with both sides parsing the same bytes the names always agree, so the guard had
no reachable failure. By this repo's rule that argues for deleting it; the reason it
cannot fire is a property of one normalisation that was wrong until today rather than of
the design, so it is kept and made **checkable** instead of kept and unverifiable.

The fifth is the one worth reading. Deleting the line in the COMPONENT that sends those
names left all 61 db tests green — they build the FormData themselves, so they exercise
the server's half and can never exercise the screen's. Every import in production would
have been refused with the whole suite passing: "written, documented, and never called",
with the caller being the one thing no test here renders. An AST census now asserts the
screen sends it, and both the deletion and a hoist out of the per-row loop red it.

One assertion was written and then removed: "sent for every selected row, not once
outside the loop". It cannot fire — a `name:` field built from `row.name` can only exist
where `row` is in scope — and the mutation meant to kill it killed the assertion above
instead. A guard whose only reachable failure is another guard's is not a guard.
