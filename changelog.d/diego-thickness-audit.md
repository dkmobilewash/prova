### Four rules tried on the thickness band, and why none of them is a fix (Diego)
`diego/thickness-audit`

**Docs-only, and an audit under the working agreement's exception.** Nothing in
the product changes. What this records is that a problem which looks like one
bad heuristic is not, and the evidence for that, so the next person does not
spend a day proving it again.

#### The defect

The answer key says 12,830 ft of EXT-1 (8-7/8in) and EXT-2 (8-1/8in). The
8.0–9.2in band holds **23%** of it. The envelope has been FOUND since #689, so
the rest comes back at a thickness that is not its own — priced as an assembly
the building does not have.

#### What it is NOT: fragmentation

Measured first, because it would have wanted the opposite fix. The two long
edges of the building come back as **one run each, at one wrong thickness**:

```
p28   94.0ft  10.19in  V at x=0.0873     the west wall
p28   94.0ft  10.19in  V at x=0.8101     the east wall
p1    45.0ft  10.81in  V at x=0.0872
p1    39.0ft  10.81in  V at x=0.8102
```

Not fragments at several thicknesses. Merging would do nothing.

#### What it IS, read off the faces

p28's west wall, every vertical face within two feet, with its offset:

| offset | longest segment | segments |
| --- | --- | --- |
| +0.00in | 94.0 ft | 23 |
| +2.30in | 94.0 ft | 23 |
| **+8.30in** | 5.5 ft | 24 | ← **EXT-2** |
| **+8.90in** | 5.6 ft | 22 | ← **EXT-1** |
| +12.50in | 115.0 ft | **3** | ← the column grid line |

**12.50 − 2.30 = 10.20.** The pairer matches the stud face to the grid line.
The real answer is at +8.30 or +8.90, against short interrupted segments.

#### The four rules, and what each one did

| rule | what happened |
| --- | --- |
| `MAX_FACE_LENGTH_RATIO` 3 | catches 115 against 28.3, misses 115 against 40.1 |
| widest partner of COMPARABLE length (#690) | 94 against 115 is a ratio of 1.22 — passes |
| **12in thickness cap (#691)** | **moved the error from 12.48in to 10.20in.** The band did not improve because the pairer simply took a nearer wrong face |
| overhang at both ends, tried here | killed the grid band outright, **1,849 ft to ZERO** — and took 2,350 ft of real wall with it, recall 95.3% → 89.8% |

The overhang rule gated on comparable length recovered some of that (91.7%) and
**put 1,619 ft into a new wrong band at 9.6–11.2in.** Net: the footage moved
from one wrong band to another and cost ~1,500 ft of real wall doing it.

Reverted. Losing footage entirely is worse than pricing some of it as the wrong
assembly — one underbids the job, the other misprices part of it.

#### Why the overhang rule cannot work as stated

The correct envelope pairing *looks the same as the grid line*. A 94 ft outer
face pairs with a 5.5 ft inner-face segment and overhangs it by ~44 ft at each
end; the grid line overhangs the outer face by ~10 ft at each end. Rejecting on
overhang refuses the right pair for the same reason as the wrong one.

The length ratio does separate those two cases — 1.22 against 17 — and gating
on it is what recovered the recall. It still is not a fix, because it only moves
which wrong face wins.

#### The conclusion worth keeping

**The error is not ordinal.** Four rules have now been tried that choose
*differently* among the same candidate faces — first, widest, widest-comparable,
non-overhanging — and every one relabels the error rather than removing it. The
pairer has no evidence about which face belongs to the wall, so no rule over
that candidate set can be right more than by luck.

What would be evidence: the drawing's own wall-type tags, which #693 showed sit
0.5–2.2 ft from the runs they label with **zero orphans** across two pages, and
which measured `A1` at 4.75, 4.75, 4.75 and 5.00 inches over four pages —
independently confirming the geometry for the dominant partition. Those cover
**25–43% of footage**, because an architect tags representative walls and not
every wall, so they are a partial answer and not a rule.

Anyone picking this up should start from the tags and from what the drawing
states, not from a fifth way to rank the same faces.

#### Also measured and recorded here

**Non-uniform sheet scaling is not supported by the corpus.** The workflow audit
asked for X and Y calibrated separately for stretched scans, which would touch
every stored quantity in the product. Voting horizontal and vertical dimension
labels separately across nine plan sets, 158 pages had enough of both to
compare: the pages with the **most** evidence agree to three decimals (125/126
dims, 56/39, 64/35, 61/31), and 101 of 158 "disagreements" read 0.042, 18.9,
25.9 — a second SCALE on the page, which `takeoff-zones.ts` already handles with
plural calibrations. There is no stretch to correct.
