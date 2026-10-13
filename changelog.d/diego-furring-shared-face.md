### A face has two sides, and the block had been taking both

The last 145 ft of holdout furring. **86% now, against 53%**, with not-on-a-wall
unchanged on both sets.

| | before | after |
| --- | --- | --- |
| holdout F1 furring | 162 / 307 (53%) | **263 / 307 (86%)** |
| holdout found | 31,998 (96.9%) | **32,100 (97.2%)** |
| holdout not-on-a-wall | 389 | **389** |
| Mesa Ridge found | 64,993 (83.3%) | **65,021 (83.3%)** |
| Mesa Ridge not-on-a-wall | 3,610 | **3,610** |

### What the key said, rather than what was assumed

Every one of the holdout's eleven furring walls is furring on CMU — the
generator adds `CMU-V` and `FR` in the same branch — and the furring's inner
face is drawn exactly on the block's outer face. One line, two assemblies.

Six were found and five were missed, with identical geometry and identical
diagnosis. The split is **which face happens to be longer**: the pairing loop
walks faces in descending length, so whichever assembly is reached first claims
the shared face and the other is orphaned. A coin flip decided whether a sub saw
their furring or the block they do not build.

### Why this works now and measured as a wash two hours ago

`secondAssemblyPass` lets a face serve a second wall **on its other side**, at a
thickness the schedule names, where no layer line or hatch series explains it.
That is the condition the previous test asked for in as many words: *"it needs a
way to admit the second side of a face WITHOUT admitting all of them."*

It was built, measured, and bought **27 ft for nothing** — because the thing it
was looking for was being eaten by a different defect. The span across block and
furring was being read as a single 9-1/8in wall, so there was no free side to
find: the phantom had claimed both faces. Fixing that first (#769) is what made
this pass worth having. **On its own it is a wash; after the decomposition fix it
is 101 ft of holdout furring at no cost.** The order mattered, and nothing about
either change says so on its own.

### The guards, and one that does not earn its place on the evidence

Mutation-tested six ways. **Only "never call the pass" reds the unit suite** —
the fixtures are three parallel lines, and three lines cannot produce the junk
the guards refuse. So they were measured on the bench instead, and the result is
written into the test file rather than dressed up:

```
opposite-side condition removed:  Mesa found    65,021 -> 65,078  (+57)
                                  holdout nowall   389 ->    408  (+19)
```

Nearly behaviour-neutral — and **not** the 2,900 ft the earlier unguarded
attempt cost, which means the work is being done by the scheduled-thickness and
layer-line checks rather than by the side condition. It is kept because it is
the physical statement the pass rests on and because 19 ft on the holdout is the
direction this bench is graded in, but the next person weighing a simplification
now starts from a number instead of an argument.

### What is left

**44 ft of holdout furring**, and 74 ft on Mesa Ridge. Not diagnosed — the five
previously-missed walls are now found, so whatever remains is a different
shape from the one this fixes.
