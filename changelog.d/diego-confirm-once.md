### Confirm once per set: a printed tag's twins on the other floors, in one click

Diego, 2026-11-09: once the estimator confirms a wall group, offer the same drawn group on
the set's other floor plans. Apply it in one click, with Undo, and never across different tags.

**Walls.**
- After a group is confirmed, the queue offers "Apply C6 to 2 more groups on A201, A301
  (412 ft)". It covers every open group, on the same sheet or another floor plan, with the
  same PRINTED tag (or the same "unless noted" type) and thickness within ½".
- After "Accept all suggestions on this sheet", the same printed tags on the other floors
  are offered too: "Apply these 2 types to 4 more groups on A201, A301".
- Each twin keeps its own level's height unless it sits on the confirmed group's level.
- Apply goes through `confirmSheetSuggestions`, so the inline Undo and the toolbar Undo put
  every floor back.
- The identity is `Guess.match`, set in `suggestType`:
  - `tag:C6` for a printed tag (C6* is its own mark, never C6);
  - `note:C` for the legend's "unless noted otherwise";
  - nothing for a carried or sibling tag or a thickness guess.

**Why printed tags only.** Measured 2026-11-10 against the type keys with the one scorer
(labels-snap-20261109T0015). The estimator confirms each cluster's first group correctly,
and the offer applies that type to the twins.

| Twins | Training | Held-out (once, Hutto ×3) |
| --- | --- | --- |
| Printed tag | 100% (76 ft) | 100% (900 ft) |
| Printed + carried | 94.9% | 75.1% |
| Untagged, same thickness | 31.3% | 63.1% |

Diego's bar for the untagged button was 90% on training, so it is not built.

**Windows.** Once a sheet's windows are confirmed, any other floor plan whose windows all
carry a tag just kept is offered in one click ("Confirm the same window tags on 1 other
floor (2 windows)"), with one Undo and a real Redo. A sheet with any other tag stays for
the person.

**Heights.** A height is set on the type's item, or on its per-level item, so one confirm
already covers every floor. The 3-floor spec shows a single height question after Apply.

**Touches.** Counted on wall-type groups, Topeka p74–76 / Hutto p61–63:

| Path | Topeka | Hutto |
| --- | --- | --- |
| One by one | 102 | 134 |
| Today: Accept all per sheet, then untagged groups one by one | 72 | 72 |
| With this change | ~70 | ~70 |

Untagged groups are 69 of the 72 actions on each set, so the 50% target needs a better way
to type untagged walls, not wider matching.

**Specs.**
- `e2e/specs/confirm-once-per-set.spec.ts` uses three floor plans, each with ZK6 and ZK8 and
  their own windows. It covers: the offer, the apply, ZK8 untouched, Undo restoring every
  floor, the windows offer skipping a floor that prints W3, and the offer after Accept all.
- `lib/takeoff/confirmOncePerSet.test.ts` tests the two matchers.
