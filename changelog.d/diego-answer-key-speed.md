### The answer-key tool, faster to use (round 10 labelled 2 of 14 sheets)

- A click beside a line on the drawing selects it: within about 10 screen pixels, and clicking again takes the next line under the pointer. Before, only a hit on the line's 1-3 px stroke selected anything, and a click beside it cleared the selection.
- Each candidate's number is drawn on its own line, following pan and zoom.
- Reviewed by is remembered in this browser and filled in. When it is empty, Save says "Fill in Reviewed by to save", and that sentence takes you to the box.
- A waiting draft is said beside Save, with Restore and Discard; Save stays usable.
- Save to labels says "Saved N decisions to …".
- A reopen no longer restores a trace that is already on screen.
- A, R and U act on the first undecided candidate when nothing is selected, and a focused button or checkbox no longer counts as typing.
- The rules say only NEW walls count: existing, demolished and NIC walls are not walls.

Check: `pnpm test:e2e -- --takeoff-click -g "K[1-8] "`. Answer-key saves in that run go to a throwaway folder.
