### A wall at the wrong thickness is priced as the wrong assembly (Diego)
`diego/wall-thickness`

The exterior envelope is found now, and it was being reported at the wrong
thickness — which is the worse of the two failures, because the footage looks
right and the bid is wrong. Measured against the answer key, 12,830 ft of true
EXT-1/EXT-2 was arriving mostly in a **6.6in** band against a true 8-1/8in.

**The cause is the pairing loop taking the FIRST valid partner rather than the
right one.** For a wall drawn as two faces that is the only partner there is, so
it was correct for as long as that was the only case. An exterior wall is drawn
as four — outer finish, sheathing, stud face, inner face — and three of the six
pairings fall inside the thickness band:

| pair | reads | |
| --- | --- | --- |
| outer finish → inner face | **8.28in** | the wall |
| sheathing → inner face | 6.72in | two of its layers |
| stud face → inner face | 6.00in | the stud cavity |

Whichever came first in length order won. What an estimator measures is finish
to finish, so the widest valid pair is the wall and the narrower ones are its
layers.

**Measured, and it is a step rather than a fix:**

| | before | after |
| --- | --- | --- |
| EXT band 8.0–9.2in | 1,921 ft | **2,920 ft** |
| as % of the true 12,830 | 15.0% | **22.8%** |
| the false 6.6in band | 5,961 ft | **4,541 ft** |
| the grid-line 12.4in band | 153 ft | 1,849 ft |
| recall | 95.5% | 95.3% |
| phantom | 17,428 ft | 17,401 ft |

About 1,500 ft left the wrong band and 700 reached the right one, at no cost
anywhere else. **Four fifths of the envelope is still priced as the wrong
assembly**, and this does not claim otherwise.

A second attempt went in on top and is reported here because it mostly did not
work. Preferring the widest partner whose face is a COMPARABLE LENGTH was meant
to stop the pairer reaching past the wall to the column grid line; it lifted the
EXT band again, 20.6% to **22.8%**, and left the grid-line band where it was —
1,839 ft to 1,849. Length is not the discriminator: on one sheet the outer
finish is 94 ft against the grid line's 115, a ratio of 1.22, which is as
balanced as a real pair. It is kept because it is a small genuine gain and costs
nothing, not because it did what it was written for.

The full accounting, so the gain is not read as larger than it is: about 1,000
ft moved into the right band and about 1,700 ft moved into a grid-line band that
was previously empty, while a false 10.2in band largely emptied into it. **Total
wrong footage is roughly flat and has been relabelled** from one wrong thickness
to another; the EXT band is the part that genuinely improved.

What the numbers say about the remainder: the false 6.6in band fell by only a
quarter, so most envelope runs are not reaching a choice between those three
pairings at all — something upstream is keeping the outer finish out of the
candidate set, most likely the 2 ft `minLengthFeet` dropping short finish
segments, or the four faces not all surviving on every export. That is the next
question and it is measurable rather than arguable, which is the only reason
this ships as a step instead of waiting.

Also here, because it was found by this branch's own preflight and should not
wait: **the timing guard added with the thinning fix was a flake.** It compared
the large grid against a tiny one and asserted a ratio; alone it passed, and
under preflight — which runs the build beside the tests — the microsecond
baseline moved and the ratio blew up. A guard that fails when the machine is
busy is noise, and this repo already has one spec that answered differently
twice in an hour.

It now calibrates against the work the defect would actually do: one read of an
array the size of the grid, measured in the same process at the same moment, so
load affects both sides equally. The live-cell thinner does a fraction of one
such pass and a grid-swept one does about eight. Verified both ways — the
mutation that restores the grid sweep still reds, and preflight now passes.
