### The answer key marks doors too (round 17's door answer key)

The door answer key (ROUND 17 in sheets-to-label.md: Baker A101, Topeka A-101 and
Joplin A-101 for training; USU A121 and Riverbend A1.1 held-out) needs doors marked
the way windows are. Storage already held `kind: "door"`; the screen could only mark
windows.
- **"Mark doors"** sits beside "Mark windows". One kind is armed at a time, and
  either one disarms tracing.
- **A click adds the armed kind.** A door is drawn as an amber square, a window as
  a blue circle.
- **The mark picker.** A door's 1–9 keys are the door schedule's marks where a
  schedule was read; otherwise the mark is typed. 0 is "no mark shown".
- **Counts.** "N doors marked" sits beside "N windows marked".
- **Tests.** `answerKeyDoors.test.tsx` checks the panel, and that a door point with
  its mark round-trips through `labelFile` and `restoreSaved`.
