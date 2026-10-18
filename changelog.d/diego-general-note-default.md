### The drawing already answered the question the panel was asking (Diego)

`diego/general-note-default`

Found by clicking School-01's A-101, 2026-10-11. The largest group on the sheet
— **29 runs, 577 ft, about 30% of its footage** — carried no tag, so the panel
asked *"which type?"* and offered **A1, A2 or C1 as equals**.

General Note 1 on that same sheet reads:

> **1. ALL PARTITIONS TYPE A1 U.N.O.**

`U.N.O.` is "unless noted otherwise", and it is the convention that makes an
untagged wall meaningful rather than unknown: the architect tags the exceptions
and lets the note cover the rest. **An estimator who picked A2 from that
dropdown would have mis-priced the biggest group on the drawing**, and the app
offered it as an equally good answer.

#### Measured on the real sheet

The note arrives as ONE text item on every sheet of that set, so no line
joining is needed. With it read:

| | before | after |
| --- | --- | --- |
| the biggest group | ASK — A1, A2 or C1 | **BY_GENERAL_NOTE — A1**, 28 runs, 556 ft |
| 6-5/8" perimeter, untagged | UNKNOWN | **UNKNOWN**, unchanged |
| 10-1/4" chase, tagged D1 | TAG_DISAGREES | **TAG_DISAGREES**, unchanged |

The sentence quotes its evidence rather than announcing a conclusion:

> Nothing is tagged beside these, but this sheet's general notes say “1. ALL
> PARTITIONS TYPE A1 U.N.O.”, and they measure 4-7/8" like your A1. Priced as
> A1 unless you say otherwise — check a few against the drawing.

#### Two independent facts have to agree, and the second is the safety

1. **The note must name a code the company HAS.** A note saying "SEE A-501 FOR
   PARTITION TYPES" mentions a code-shaped string that is a sheet number; it is
   not a wall type, so nothing matches. The library is the filter.
2. **The group's measured thickness must match that type**, enforced in
   `wallGroups`. Without it "ALL PARTITIONS ARE A1" swallows the 6-5/8"
   exterior shell and the 10-1/4" chase — which are untagged too, and which the
   note's own "unless noted otherwise" is precisely what excuses. **A different
   thickness IS a notation.**

A tag always wins: it is printed beside the wall it names, and a note only
covers what nothing tagged. Nothing is applied — the group is PROPOSED and a
person presses the button, the same posture as the scale prefill and every tag
match.

#### The mutation that taught me the anchor was load-bearing

`ALL_PARTITIONS` requires the word ALL, and that looked like belt-and-braces:
"SEE A-501 FOR PARTITION TYPES" is refused twice over — no ALL, and A-501 is
not in the library — so **dropping the anchor changed nothing and no test
noticed**.

It is not redundant. Plenty of small sets number their sheets **A1, A2, A3**,
and those are also the two commonest partition codes there are. On such a set
"SEE A1 FOR PARTITION TYPES" points at a SHEET, and without the anchor it would
be read as "every untagged wall is type A1" — the whole drawing priced off a
cross-reference. There is a case for exactly that now.

#### Checks

Preflight green, 10,087 tests, no migration. **Eight mutations, eight red,
zero blind** — including the thickness guard dropped, the note overruling a
tag, the library stopping filtering, the viewer not reading notes at all, and
the note naming a group but never reaching the button.
