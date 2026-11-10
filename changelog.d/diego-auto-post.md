### Auto-post proven items: the machinery, and marked doors are the first source on

Diego, 2026-11-08: a wall group may post to the estimate without the review queue only
when its type comes from a source right ≥97% of the time on the training keys AND ≥95%
on the held-out keys (measured once). A wrong auto-post misprices a bid silently, so both
numbers have to clear.
- **`lib/takeoff/autoPost.ts`** holds each source's measurement: training and held-out
  precision, footage, the date, and sheet counts. `POSTS` in `postingGate.ts` is now read
  off that table, so a source goes on by recording a new measurement, never by flipping
  a flag. On the 2026-11-08 measurement nothing clears the bar. The best candidates were
  printed tags (95.5% training, 82.1% held-out) and tag variants (78.0% / 100%).
- **Auto-posted runs** are labelled "C6 wall (auto, from printed tag)".
- **The queue's header** reads "312 ft posted automatically · 4 groups need you", with
  an Undo per sheet. Undo (`undoAutoPost`) moves that sheet's auto-posted runs back to
  "Walls — untyped", where the queue offers them again.
- **"Auto-post proven items"** is a new owner-only company setting under Settings →
  Estimating. It is ON for new companies (`lib/auth.ts`) and OFF for existing ones.
  The migration `20261109010000_add_company_auto_post` adds the column; it is additive,
  `DEFAULT false`.
- **The evals now record the second signals** the narrow sources need.
  `wallTypes.eval.ts` writes each run's type thickness and the distance to the nearest
  other-type and any-type tag. `zzWallHeights.eval.ts` writes the height's basis and
  the kind of fact it came from.
- **Tests.**
  - `autoPost.test.ts`: the bar's edges, and that no source posts.
  - `autoPost.dbtest.ts`: with the tag source forced on, a run posts itself, the queue
    counts it, Undo returns it, and the setting off posts nothing. Both mutations
    (Undo as a no-op, the setting ignored) turn it red.

**The narrower two-signal sources were measured too (2026-11-09), and none clears, so
none is switched on.**

| Rule | Training | Held-out |
| --- | --- | --- |
| Type: printed tag + legend thickness ±1/2" + no other type's tag ≤3 ft | 78 ft, 97.3% | 0 ft |
| Type: "unless noted" + legend thickness + no tag | 0 ft | 0 ft |
| Height: printed on the type | 0 ft | 142 ft, 17.6% |
| Height: the type's own rule, one section level | 172 ft, 100% | 0 ft |

The thickness signal starves both type rules, because most legends print no thickness.
The table in `autoPost.ts` carries these numbers.

**Doors are the first source past the bar.** Measured 2026-11-10 against ROUND 17's door keys
(labels-snap-20261110T0122). A finder door matches a key door when the key point lies inside
its swing.

| Door source | Training (Baker, Topeka, Joplin) | Held-out (USU, Riverbend, once) |
| --- | --- | --- |
| A door with a printed mark beside it | 97.1% (34 doors, 1 false) | 100% (13, 0 false) |
| Every door found | 93.6% (146, 10 false; recall 57.3%) | 86.5% (45, 7 false; recall 58.4%) |

- **What posts.** On a company with "Auto-post proven items" on (and doors and windows on),
  the rooms stage writes a sheet's marked doors as one count on the job's "Doors" item,
  labelled "Doors (auto, from printed mark)" (`lib/plan-ingest/autoDoors.ts`). A re-run
  replaces it.
- **Undo.** The queue's Undo for the sheet deletes the count and leaves a `doors-auto-undone`
  marker, so a re-run never puts it back.
- **The header.** It reads "312 ft and 14 doors posted automatically · …".
- **Every door found does not post.** Those stay as the wall openings they already were.
- **Marks.** The finder now returns each door's printed mark (`doorMarks`, the nearest
  door-mark symbol within the 3 ft reach it already used). Marks were right 30 of 62 on
  training and 10 of 10 held-out, so the count carries no mark and prices no mark.
- **A thin sample.** 47 marked doors in all, and one more false door on training would fail
  the bar. Re-measure as door keys are added.

**Touch-free.** Wall touch-free stays 0.0%. For doors, keyed doors posted correctly with no
touch: training 34 of 255 (13.3%), held-out 13 of 77 (16.9%).

**Scoring tools.**
- `lib/takeoff/realplan/zzDoorCount.eval.ts` runs the product's door finder against the
  door keys (no model).
- The swing-match scorer is in the session's scratchpad (`door_score.py`, selftest).

