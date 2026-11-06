### A sheet-wide wall-height note outranks the ceiling plan; existing jobs get their windows counted (Diego)
`diego/note-over-ceiling`

**Height priority (Chrome's re-test on Baker).** Untyped groups suggested "10'-0" from the
ceiling plan, 2 rooms", while A601 note A says all walls go to the deck (15'-0"). A typed
group already got the note through its type's legend height; an untyped one had only the
ceiling plan. Now the set's sheet-wide height (`generalHeightOf`, stored when the legend's
heights are read) comes after a type's own height and before the ceiling. That applies to an
untyped group, to a type with no height of its own, and to a height-only item.

Green Bay's and McAllen's note is "8" above the highest adjacent ceiling", and their A4.0
prints the dropped-ceiling height, so the note resolves to a figure (8'-8", the key's)
there too.

| ROUND 14 key, correct / wrong / no height | before | after |
| --- | --- | --- |
| Baker A101 | 57.9 / 0 / 42.1 | **94.3 / 0 / 5.7** |
| Green Bay A3.2 | 78.0 / 0 / 22.0 | **99.9 / 0 / 0.1** |
| Green Bay A3.1 | 43.9 / 0 / 56.1 | **72.0 / 0 / 28.0** |
| McAllen A3.2 | 75.6 / 0 / 24.4 | **97.0 / 0 / 3.0** |
| Joplin, Bunkie, Grand Junction | unchanged | unchanged |
| **training total** | 30.0 / 0 / 67.6 | **43.0 / 0 / 54.5** |
| held-out, measured once | 1.3 / 5.9 / 91.0 | 1.3 / 5.9 / 91.0 (no sheet-wide note on either set) |

**Windows on an existing job (Chrome: no Windows part on Baker).** The windows count lived
only inside the rooms step, which runs once per sheet. Baker's rooms were found on 3 Nov,
before #1008, so its windows were never counted. The count is now its own step
(`windowsForSheet`). It runs when a whole-set re-run finds a sheet again, and when the rooms
step finds rooms already there. A sheet whose windows were decided is left alone. An existing
job needs one whole-set re-run to show its windows.

**Sources (Chrome's third point).** Typed groups citing A351 for 15'-0" is right: A351 is a
section that prints "T.O. ROOF FRAMING 15'-0"", as A301 does.
