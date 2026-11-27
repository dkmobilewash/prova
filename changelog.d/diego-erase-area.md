### "Erase walls in this area": drag a box, see what it takes, erase whole walls

**W2 item 2 of the Walls v1.0 Finish Plan** (coordination/erase-area-tool.md, with Amendments 1-2). The design input is
the second's ceiling (prereg-erase-area.md): on new-build training sheets, 24.0% -> 16.2% error with up to 3 boxes, for
14 ft of real wall erased.

**The tool:**
- **"Erase walls in this area"** is on the tool rail, with the shortcut **X** (E was already Edit).
- **Preview before any write:** drag a box and the sheet asks "Erase 7 walls, 163 ft?" with Erase and Cancel. Nothing is
  written until Erase.
- **The count is honest:** it counts every found wall the box takes. The product cannot know which are real, so it never
  says "real walls".
- **Undo and Clear:** erased walls go to their own aside line, "N walls inside an area you erased — X ft", with Undo and
  "Clear erased areas".

**One predicate, shared by the product, the preview and the scoreboard:** `eraseInBoxes`. A wall goes when its
centreline points at 25%, 50% and 75% all lie inside one box. Whole walls only, never cut, because the ceiling's 14 ft
was measured that way. It applies after the work area, on every sheet. Erase boxes are stored as sheet exclusions and
refresh through the work area's own path.

**The scoreboard move (the v3 rule: a move enters the metric in the PR that ships it):** `actionsToExact` gains `X`,
erase boxes counted after the work area, where a real wall erased is a loss. `zzZeroTouch` builds the candidates with the
second's frozen estimator: 10-ft clusters, 1-ft pad, refused over 10% real LF, up to 3. Each erased set comes from the
product's own `eraseInBoxes`. `ZT_ERASE=0` is the OFF arm. The ship test is `scripts/exam-runs/w2-erase-ab.sh`.

**Migration** `20261127100000_takeoff_exclusion_erase_area`: `ALTER TYPE "TakeoffExclusionKind" ADD VALUE 'ERASE_AREA'`.
It is additive, and Diego approved it by name.

**Checks:** tests first, red on main. Mutations: 10 on the tool and 6 on the scoreboard move, all red. One scoreboard
mutation survived its first case, and the case was narrowed until it distinguished.
