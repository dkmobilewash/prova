### Reading the sheets again took away the button it was read for (Diego)

`diego/schedules-survive-reread`

**Read the schedules** was gated on `view.stage === "TITLE_BLOCK"`. `view.stage`
is the stage of the LATEST run, so any later run hid it — and the control
sitting directly below it is a later run, costs nothing, and the app recommends
pressing it:

> Read the sheets again — costs nothing … Worth doing if C Stream has been
> improved since this set was uploaded.

#### Found by taking that advice

2026-10-11, on School-01's 60-sheet set, immediately after #738 landed. Three
sheets had never been readable; the re-read recovered all three, the headline
went from *"3 couldn't be read"* to **"Every sheet read."** — and the act of
recovering them removed the schedules button, which was the entire point of
recovering them.

The only route back through the UI was **"Read the title blocks — uses 60
sheets"**, a second time, for work already paid for. So a control labelled
*costs nothing* cost 60 sheets of allowance to undo.

#### It is #663's bug, one button higher, with #663's diagnosis beside it

`planIngestReread.test.tsx` already exists because the re-read button had this
exact defect, and its header states the fix in as many words:

> So the gate is now COMPLETION, not which stage completed.

That was applied to the re-read button and not to the one above it. A diagnosis
recorded beside the single call site somebody happened to be looking at.

#### Gated on its own precondition now

The stated reason for the stage gate was sound — the page types a title-block
pass proposes decide which sheets this reads, and therefore what it costs. The
gate just did not express it. The real precondition is that some sheet **is** a
schedule, and `scheduleSheetCount` already counts exactly that, from proposed
and accepted page types, which only a title-block pass can produce.

`view.stage` survives only for the zero case, so *"None of the title blocks on
this set named a schedule"* still appears after a title-block run and not on a
set nobody has read yet, where it would answer a question nobody asked.

#### Two things the harness got wrong, both found by mutation

`paint()` rendered into one root, so a second call in a test re-rendered the
**same component instance**. `PlanIngestPanel` holds its run in
`useState(existing)` and an initialiser runs once, so the second call's props
were accepted and ignored and the assertion read the first call's screen. It
now remounts. The loops already in the file never noticed, because every stage
was expected to give the same answer — which is what a vacuous pass looks like
when the thing it checks happens to be true.

And one mutation is **green and stays green**, written up rather than deleted:
removing `!running` from the gate changes nothing here, because `running` is
component state no prop can set. The test says so. Covering it needs the server
action mocked, which this file deliberately does not do.

#### Checks

Preflight green, 10,051 tests, no migration. **Five mutations, four red** —
including the defect exactly as shipped — and the fifth green for the reason
above, named in the test beside it.
