## The wall thickness cap, and a bubble detector that turned out not to be needed

**This entry is mostly a correction of my own diagnosis, so the shape matters
more than the fix.** Everything here was built to remove a column grid line
that does not exist.

### What I thought, and where it came from

After #690 taught the pairer to take the outermost of several parallel faces,
1,849 ft came back in a **12.4in band matching no assembly on the drawing**. A
probe of a two-foot window on one page printed a face at +12.48in, 115 ft long,
and I labelled it `COLUMN GRID LINE` in my own notes. **That label was never a
measurement**, and two days of work followed from it as though it were.

### The grid bubble detector, which works

Built on the one thing always true of a grid line: it ends in a BUBBLE. Sized in
PAPER inches, not feet of building — a bubble holds a character so it is drawn
about the same size at any scale, while in feet the same circle is 3 ft at 1/8in
and 1.5 ft at 1/4in.

**Its first bound was reasoned and wrong, and the way it was wrong is the
reusable part.** At a 0.25in minimum ("nothing readable fits in less") it found
ZERO bubbles on six of seven real pages while passing thirteen of its own
fixtures. A zero like that is two different answers — the sheets have none, or
the detector cannot see CAD — and neither run could tell them apart. A third
probe asked what curved material was on the page at all: **895 of 1,371 short
segments chain into another, and 46 round closed chains per page, every one
0.164in across.** The half-size sheet carries 32 at 0.082in, exactly half. The
circles were there the whole time.

At 0.06in it finds them on both sheet sizes, and the drop now follows the whole
collinear run rather than the single piece touching the bubble — CAD writes a
long line as many segments, which is why the terminal test alone moved nothing.
The propagation tolerance is a fraction of a point on purpose: **walls are
routinely CENTRED on a grid line**, and a loose version deletes the wall it was
meant to leave. The grid line is the centreline and the faces sit either side.

### And then the band, looked at directly

```
B11: 2 walls in the 12.2-12.7in band, 188ft total
    94.0ft  12.44in  vert  (0.087,0.454)-(0.087,0.128)
    94.0ft  12.44in  vert  (0.810,0.454)-(0.810,0.128)
```

**The building's east and west exterior walls.** Not a grid line, not near one.
The envelope was being FOUND and measured half again too thick — which prices it
as an assembly that does not exist, and is the worse failure of the two because
the footage looks right.

### The fix: the cap, swept rather than chosen

The key names every assembly on the drawing and the widest is **EXT-1 at
8-7/8in**. That argues for a 9.2in cap. The sweep argues otherwise:

| cap | recall | phantom | EXT band | 12.4in band |
| --- | --- | --- | --- | --- |
| 18 (was) | 95.3% | 17,401 | 22.8% | 1,849 |
| **12 (now)** | **94.5%** | **15,374** | **23.2%** | **0** |
| 11 | 93.9% | 15,197 | 23.5% | 0 |
| 10 | 91.7% | 15,160 | 25.4% | 0 |
| 9.2 | 91.6% | 14,766 | 25.4% | 0 |

**The band is empty by 12in**, so the defect needs no tighter cap. Below that the
cost rises faster than the gain — 9.2 buys another 608 ft of phantom reduction
and gives up 3.7 points of recall, about 1,560 ft of real wall. A tight cap does
not FIX an over-measured wall, it REJECTS it, and the footage leaves with it.

Phantom falling 2,027 ft was not predicted and is the largest single number here.

### What it gives up, which is not nothing

`wallVectors.test.ts` asserts an 18in shaft wall is "the thickest thing still a
wall" — a deliberate claim, and true: a CMU or double-stud shaft is that thick.
The first draft of this comment said no assembly in this trade is a foot thick.
**That is false, and the test beside the file said so** — this repo's own rule
about reading the test before believing an inference about the code, arriving as
a temptation rather than a warning.

So an 18in wall is now **opt-in**: pass `maxThicknessFeet: 1.5`. The default
serves the common case because the sweep says the common case is worth more — an
18in cap misprices 1,849 ft every time, against a shaft wall that is occasional
and one argument away.

### The bound to state plainly

**12 is measured on ONE answer key.** What would settle it is a second key with a
shaft wall in it, which is also what would say whether the 0.8 points of recall
this costs were real wall or more over-measured envelope. Nobody knows yet.

The bubble detector ships unwired and nothing calls it. It is kept rather than
deleted because the detection is proven on real CAD and grid lines may yet
matter — but it is not the fix for this, and the entry above is the reason.

### Checks

- The cap mutation-tested both ways: restored to 1.5 the new default-refusal
  test reds and names itself.
- 21 bubble tests, including a wall centred on a grid line surviving, and the
  limit the first fixture exposed — a wall ending INSIDE a bubble is caught —
  kept as its own test rather than tuned away.
- 470 takeoff tests. Preflight green. No migrations.

### Click-list

1. Open a calibrated floor plan and press **Find the walls**.
2. The thickness groups should no longer show anything at or above 12in.
3. On a sheet with an exterior wall, confirm the envelope group reads around
   8-9in rather than 12in — that is the whole point of this change.
4. Confirm the total footage has not dropped noticeably; a small fall is
   expected and is the walls that were only ever reported too thick.
