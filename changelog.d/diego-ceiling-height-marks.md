### A row of identical ceiling heights goes one to a room, and the ceilings eval scores the room it names

**One mark per room.** An RCP that prints the same height mark (`9'-0"`) in each of a row of
small rooms, with the room tags sitting below the marks, handed every mark to the nearest room
tag: one room got three and its neighbours got none, so they showed no height. Where one room
collects several IDENTICAL height-only marks, the nearest stays and each extra goes to the
nearest room tag in reach that has no height yet. Two DIFFERENT heights in one room are a
ceiling and its soffit and still stay together, the higher one winning, as before.

Training ceiling keys (11 sheets), height right 50/65 → **53/65**: MHK 2/7 → 4/7, E Street
3/10 → 4/10; no sheet's height or family score dropped. Held-out (Albany, KSU, O'Reillys),
measured once: unchanged at 6/12.

**The eval's join was wrong first.** `zzCeilings` joined a key room to the first room on the
sheet matching its number OR its name, so key room "10 OFFICE" scored against "11 OFFICE". It
now joins by number first, by name only when the key prints no number, and prefers the room
that was paired with ceiling tags, as the product does. That moved the baseline from 48/66 to
50/65 before any product change.

`CEILING_MEASURE_HELDOUT=1` lets the ceilings eval read held-out pages, to measure them once.

Tried and not built: refusing to pair a ceiling tag with a room tag on the other side of a found
wall (+1 on E Street and Topeka, but −1 on Joplin and −1 on family).
