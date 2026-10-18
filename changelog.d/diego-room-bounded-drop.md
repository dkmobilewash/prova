### The room finder stops asking whether a wall bounds each region (Diego)

`diego/room-bounded-drop`

Second and last filter change behind #712. **The button stays off**, and this is
a recorded step rather than a feature coming back.

Measured against the room tags printed on real sheets, the wall-bounded
requirement was the **single largest cause of a missed room** — 16 tags across
two sheets, more than merging on Augusta and level with it on West Herr:

| | wall-bounded | dropped |
| --- | --- | --- |
| West Herr p21 | 27% | **41%** |
| Augusta p11 | 73% | 73% |
| both | 47% | **55%** |

The filter existed so a notes panel could not come back as a room. **The box
already does that job**, and does it without a threshold: cropping makes the
paper around the drawing reach the edge of the grid, where `open` excludes it.
Keeping both meant paying twice for one guarantee, and the second payment was
coming out of real rooms.

#### The cost is recorded rather than hidden

On West Herr it admits **36 more regions (59 → 95) for 6 more correctly placed
tags**, averaging about 30 square feet — some real closets and toilets, some
not. On Augusta it admits 8 more and gains **nothing**.

So it is a recall trade with a precision cost, taken because this feature's
failure is overwhelmingly one of omission: a room nobody finds is invisible,
and a region nobody wants is one click to reject. **That trade would be the
wrong way round if the button were on.**

#### What the merging investigation found, since it produced no fix

- **Opening width is not a lever.** Sweeping 6 ft, 12 ft and a 1 ft floor moved
  the total by one tag. But sealing AT ALL matters enormously: without it West
  Herr collapses from 27% to 7%. "Rooms merge through unsealed openings" was
  the fifth wrong cause on this feature.
- **Merging is now the dominant remaining failure on West Herr** — 13 of 41
  tags sit in a region holding more than two — and **Augusta has none of it**,
  so it is not one phenomenon across sheets.
- **The ceiling with everything found so far is about 61%**, with a generous
  box. Augusta reaches 79%, West Herr 46%.

61% is not a number anybody should bid from, and the gap to useful is not
another filter.

#### Checks

- The existing 19 cases cover this: **putting the requirement back fails six of
  them**, so the behaviour is held rather than merely changed. Seven mutations,
  all red, including the box being ignored and the margin being admitted.
- The filter that was dropped had **no mutation of its own** before today —
  removing it broke nothing, which is how it survived being measured for so
  long.
