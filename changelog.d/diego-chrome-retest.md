### Chrome's re-test: one picked run in the strip, one review, T for height, one count, a wheel notch per step, a stepper that follows

1. **The bottom strip shows the ONE run or shape picked:** what it measures, its item, its type and its height.
   - It kept the whole group's 652.96 ft, because picking a shape also made its item the rail's active item, and an active item clears the pick.
   - A drawing's pick now lights its item without clearing itself.
   - The strip lets go on Esc, a click on nothing and a sheet change, and the drawing's item goes with it. An item chosen in the rail still shows its properties.
2. **One review.** The top bar's "Review walls" opens the review queue (fast confirm).
   - The old Keep/Drop bar is now a step of the queue, "Check the walls the model doubts · M", with K / D / U and its "looked at · ft dropped" counter, and it returns to the queue when done.
   - A wall held to confirm takes K, D and N in the queue itself, shown on screen.
3. **T edits the height in the queue ("tall"), not H:** H is the Hand tool. The keys are shown on the row.
4. **The count matches.** There is one Review button now (there were two, counting two lists, 38 and 34), and its number is the queue's own "left to review".
5. **A mouse-wheel notch zooms one step of 12%** whatever delta the browser reports (`wheelZoomFactor`). Three notches went 25% → 31%; they now go to about 35%. A pinch stays continuous.
6. **The stepper's Scale step follows a scale saved in another tab.**
   - Scale saves revalidate the job's whole layout.
   - The stepper re-reads its facts when its tab comes back into view (`RefreshOnReturn`).

`e2e/specs/chrome-retest.spec.ts` covers 1, 2, 4, 5 and 6; `fast-confirm.spec.ts` covers 3. The click list's R5-11 and R5-12/13 reach Keep/Drop through the queue.
