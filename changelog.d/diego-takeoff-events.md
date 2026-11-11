### Takeoff events: automation measured on real pilot jobs (Diego)
`diego/takeoff-events`

Every review-queue and takeoff act is now a row in a new append-only `TakeoffEvent` table
(additive migration `20261111090000_takeoff_events`, cascading from its job and company):
Enter (ACCEPT), the type a person picked over the pre-filled one (PICK), a typed height
(HEIGHT_EDIT, also from the layers panel), Skip and Next (SKIP), Accept all (ACCEPT_ALL, one
`batch` per press), Undo, a later Set type or Clear type (CHANGE), the auto-post rule (AUTO_POST)
and the signing link (SEND). Each carries the job, the plan and sheet, the time, who, and the
suggestion's source as a `PostSource` code.

**No plan content.** A group is identified by `target`, a hash of its run coordinates, so a later
Undo or Set type on the same group matches its accept and nothing of the drawing can be read back;
`source` is a code, never a tag, a type code or a note. **"Changed after accepting" is derived at
read**, never stored. **Recording never fails the act it records.**

**Per pilot job** (`/internal/pilots/<company>`, linked from each company on the pilot dashboard,
same operator-and-owner gate): touches (an Accept all press counts once), auto-posted, accepted,
changed after accepting (the accuracy signal), and minutes from first upload to the signing link.

Checks: `lib/takeoff/eventStats.test.ts` (touch, change and send rules; the target's stability),
`lib/takeoff/events.dbtest.ts` (every kind from the real actions, the per-job figures, another
company's job never in the figures, no plan content in any row; red with the batch rule or the
company scope removed), `e2e/specs/takeoff-events.spec.ts` (real presses, then the operator's row).
