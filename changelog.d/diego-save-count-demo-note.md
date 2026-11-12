### "Saved N" is what the file holds; a sheet paired with its demolition plan says what was set aside, every visit (Diego, via Chrome)
`diego/save-count-demo-note`

**The save count.** Chrome saw "Saved 164" on Bluetooth AI101 while the file held 163. The number
was the browser's own sum of what it sent (new verdicts plus the hidden ones carried); nothing
compared it with the file. The labels route now returns how many verdicts it wrote, and the line
reports that number. If the two ever differ, it says so ("164 were sent: check the file").

**E Street A2.1 against demolition plan A1.1 (waiting since 2026-11-06).** The set-aside line and the
split total existed, but only after a Find the walls in the same browser session. Run takeoff now
posts the walls stored when the scale was saved. A2.1 was scaled before plan comparison was on, so
its stored walls were the whole sheet, existing included, and were posted as they were: nothing set
aside, and the yellow "This sheet shows existing work…" prompt was back on every visit.

- Run takeoff on a sheet paired with a demolition plan, with plan comparison on and no comparison
  kept for it, finds the sheet's walls again first. That compares with the demolition plan, sets the
  existing walls aside, keeps what it did, and replaces the walls on the job unless one has gone to
  the estimate. The screen then waits for the new walls instead of keeping the old ones.
- A comparison made in the browser is kept too (`savePlanComparison`), so a reload shows it.
- The yellow prompt shows only on a renovation sheet with NO demolition plan paired.
- E Street A2.1 now reads "Existing walls set aside using demolition plan A1.1: 26 walls, 486 ft" and
  "Walls on this sheet: 632 ft new (486 ft existing set aside)". 632 + 486 = 1,118, the whole sheet
  with the comparison off. A1.1 reads "Not counted: used to set aside existing walls on A2.1."

Checked by `takeoff-click.local.spec.ts` B9 (6 passed, including the new B9-2b: leave A2.1 and come
back), the labels route test (the count is the file's), and `labelSaveMessage.test.ts`.
