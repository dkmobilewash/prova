### Answer-key state belongs to one sheet, and the sheet number is actually read

Reported after a fix that was supposed to have covered this: find the walls on
A102 in answer-key mode, change sheet with the PICKER, and A102's orange and
blue candidates are drawn on the next sheet — including its striped hatch box,
on a drawing that has no such thing.

**There were two current pages.** `TakeoffPlanViewer` owns `pageNumber` and its
own picker changes it; `TakeoffWorkspace` owns `page`, and only the sheet TREE
and the overview changed that — both of which tell the viewer through a
`takeoff-goto` event. Nothing ever went the other way.

So the earlier fix was real and keyed to the wrong variable. Everything the
workspace keys by page belonged to whichever sheet was last picked from the
tree: the candidates, the verdicts, the traced walls, the scale a traced wall
is measured at, and the sheet number a saved key is named after. The ordinary
wall overlay escaped because it is keyed inside the viewer, on `pageNumber` —
both halves were page-keyed, just not to the same page.

The viewer reports the sheet it is showing, and the workspace follows it. A
half-drawn trace is also abandoned on a sheet change: `traceFrom`/`traceTo` are
the viewer's own state and were keyed to no sheet at all, so a trace begun on
one drawing could be finished on the next.

### And a second defect, found while proving the first

The saved key came out as `p9.key.json` rather than `A102.key.json`, and
chasing that found something worse than a filename.

The title block is read in an effect keyed on `[pageNumber, pageSize]`, with a
guard that marks a page as asked BEFORE the read. Paging sets a new `pageSize`
object once the sheet renders, so the effect re-ran, its cleanup cancelled the
in-flight read, and the guard refused to start another. **The title block was
never read for any sheet somebody navigated to** — so the sheet number never
arrived, and neither did the not-a-takeoff-sheet verdict that greys out Find
the walls on a partition legend.

The guard is keyed on the page AND its size now, and released on the way out:
not finished means not asked.

### How it is proved

`e2e/specs/takeoff-key-one-sheet.spec.ts` walks the reported sequence in a real
browser on a real set — review A102, accept two, reject two, trace one, then
A103, then G101, then back — and asserts the other sheets are empty, that A102
returns intact, and that Save produces `A102.key.json` holding three walls and
A102's own scale. It was red on the old code at exactly the step that was
reported.

`components/answerKeySheetCensus.test.ts` is the cheap guard that the wiring
still exists, because no rendered test can reach it: the viewer opens on page 1
and its pager only appears once a real PDF reports `numPages`, which never
happens in happy-dom. Four mutations red it, including one that restores the
old code exactly.
