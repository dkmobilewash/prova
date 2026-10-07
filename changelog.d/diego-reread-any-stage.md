### The re-read button was invisible on every set anybody had worked with (Diego)
`diego/reread-any-stage`

#663 added **"Read the sheets again — costs nothing"** because the scale a sheet
declares about itself is DERIVED from the file, goes stale when the reader
improves, and there was no way to re-run that stage from the app at all — so a
fix to the reader reached no plan already uploaded.

**It then gated the control on `view.stage === "PAGE_INVENTORY"`, which is the
same bug it was written to fix, one transition later.** `view.stage` is the stage
of the LATEST run, so the moment anybody read the title blocks the re-read button
vanished. It was invisible on exactly the sets that need it, and present only on
freshly uploaded ones that nothing had improved under yet.

The gate is now COMPLETION, not which stage completed.

## What it cost, because the diagnosis is the lesson

A click-test reported a sheet still offering a dimension the form then refused —
the defect #662 fixed. I ran the current reader against that same PDF locally: it
finds **12 dimension labels, matching production's "of 12"**, and declines
(*"the best line to set it from is 1.1% out"*), so the stored reading was plainly
the old one.

I then checked the server path end to end — new job created, fresh tasks per
page, `update: rest` on the upsert, no skip path, `closeIfSettled` genuinely
called from two places — **all of it correct**, and concluded the re-read "did not
happen". That was true, and for none of the reasons I was looking at.

**A screenshot settled it in one glance: the panel was showing the schedule
stage.** The button was not on the page. I had verified the server would accept a
second pass and never checked which screens offered one — the #663 entry says
"the server already allowed this", which was read off the guard rather than
proved by result.

## Why this is a render test and not a census

Every assertion a source census could make was TRUE while the app was broken: the
button existed, called `onStart`, sat in a completed branch, and named its price.
**A census proves the code is THERE; it cannot ask "on which screens."** So the
test supplies props and looks at the output.

- 7 tests: offered at `PAGE_INVENTORY`, at `TITLE_BLOCK`, and at **every stage
  the schema declares** — the list is derived and a further test requires it to
  equal the Prisma enum, so a stage added later inherits the guarantee.
- Not offered mid-run, because pressing it then reuses the in-flight job: it does
  nothing and looks like it did something.
- **Three mutations, each red.** M1 restores the shipped gate and reds precisely
  the stages the user was on while leaving `PAGE_INVENTORY` green. M2 is the
  decisive one this repo names — *make it render nothing*. Restored by rewriting
  bytes.
- The harness proved itself before any result was read: a first draft invented a
  stage called `SCHEDULE` (it is `SCHEDULE_ROWS`) and typecheck caught it, and the
  panel initially rendered its pre-run state because the prop is `existing`, not
  `initialView` — a passing `not.toContain` against an empty panel is the vacuous
  green this directory exists to end, which is why one test asserts the panel
  rendered at all.

Four gates: **9,276 unit tests**, db suite, typecheck, lint. No schema change.

## Click-list

1. Open a plan set whose **title blocks have already been read** — the panel will
   be showing the title-block review list or the schedule stage. *Expected:
   "Read the sheets again — costs nothing" is on the page. It was not, before
   this.*
2. Press it. *Expected: the bar runs and finishes at "Every sheet read".*
3. Press **Set scale** on a sheet whose dimensions are all too short. *Expected:
   it now offers the PRINTED scale with a full-width line, instead of a short
   dimension the form then refuses.*
4. Check your sheet allowance before and after step 2. *Expected: unchanged.*
