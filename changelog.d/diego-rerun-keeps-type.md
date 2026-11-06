### A re-run keeps a confirmed type, and every height suggestion comes in one order

Chrome on Baker A101: after Run takeoff again, a typed group read "untyped, no
height, Ceiling 10'-0"" under its own S6B heading, with no Clear type. The
finder had found the group again with a run a hair off the one on the job, and
the panel, Set type and Clear type all matched runs by exact coordinates, so
the row read untyped and Set type wrote a second row for the same wall. One
tolerant matcher (`sameRunAs`) now serves all three, and a group only partly on
a type says "on 1 of 2 runs" with Clear type and Set type for the rest.

The queue pre-filled 15'-0" from general note A601 while the panel offered the
ceiling's 10'-0" first. Both now read `heightOptionsInOrder`: the type's own
height, then the set's general note, then the ceiling.
