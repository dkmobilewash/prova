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
| EXT band 8.0–9.2in | 1,921 ft | **2,638 ft** |
| as % of the true 12,830 | 15.0% | **20.6%** |
| the false 6.6in band | 5,961 ft | **4,469 ft** |
| recall | 95.5% | 95.8% |
| phantom | 17,428 ft | 17,461 ft |

About 1,500 ft left the wrong band and 700 reached the right one, at no cost
anywhere else. **Four fifths of the envelope is still priced as the wrong
assembly**, and this does not claim otherwise.

What the numbers say about the remainder: the false 6.6in band fell by only a
quarter, so most envelope runs are not reaching a choice between those three
pairings at all — something upstream is keeping the outer finish out of the
candidate set, most likely the 2 ft `minLengthFeet` dropping short finish
segments, or the four faces not all surviving on every export. That is the next
question and it is measurable rather than arguable, which is the only reason
this ships as a step instead of waiting.
