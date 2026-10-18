### The index check reported sheets nobody had read yet as missing (Diego)

`diego/index-unread`

Found on production the day #704 shipped, by a browser run on a real set.

Reading had paused at **21 of 55 sheets**, so 34 pages had no sheet number yet.
The check compared the printed index against the 21 it could see and said:

> The index on page 2 lists 55 sheets. **39 are NOT in what was uploaded**:
> SE0.01, SE4.01, SE7.01, … and 27 more.

Every one of those was sitting in the file. The page count was 55; nothing was
missing at all.

#### It is the distinction this module was built around, pointing the wrong way

`drawingIndex.ts` was careful that **"the index could not be read" must never
read as "nothing is missing"** — `readDrawingIndex` returns `null`, the types
refuse to let a caller read it as an empty list, and there is a test for it.

Then it let **"the PAGES have not been read"** read as **"everything is
missing"**, which is the same error pointing the other way and considerably
louder: the first says too little, this one names real drawings and sends
somebody to the GC about them.

#### The comparison is refused outright, not qualified

> *34 sheets in this set have not been read yet, so this can't tell you what is
> missing — anything unread would be reported as absent. Let the reading
> finish, then check again.*

`missing` and `unlisted` are both `null`, as they are for an unreadable index.
**Half an answer is worse than none here**: an estimator told four sheets are
missing goes to the GC, and finding them in the file is how a check stops being
read at all.

#### Both ways to get the count wrong were green against the action

The counting lived in the Server Action, which nothing could test, and mutation
found two:

- **a constant zero** — the production bug straight back;
- **counting PROPOSALS rather than NUMBERED ones**, so a page the reader
  reached and could not name counts as read, and the index's entry for it comes
  back missing. The same bug wearing a different hat.

So it is `unreadPageCount()` now — pure, six cases, and it is never negative:
a re-run of the reader leaves two proposals on one page, and a negative would
read as "everything is read" to any caller testing `> 0`.

#### Checks

- 34 cases in `drawingIndex.test.ts`. **Nine mutations, all red**, including
  the production bug itself, a partial list leaking out of the refusal, and the
  unreadable-index branch being overruled.
- The call-site census in `planIndexCheck.test.tsx` grows one case: a census,
  because the action opens a PDF from blob storage and nothing here can run it.
  It can see that the counter is called and that its result reaches
  `indexCheck`; **it cannot see that the page count is right.**
- No schema change. `PlanSheetText` is one row per page and was already there.
