### A reviewer can trace the wall the finder missed

`addTraced` has existed since answer-key mode shipped and nothing ever called
it — the "written, documented, and never called" shape this repo keeps paying
for. The consequence was specific and bad: a key could only ever be built from
what the detector proposed, so it graded the detector against its own output.
A wall on the drawing that nothing found had no way into the key at all.

Press **t**, click the start of the wall, click its end, press **Enter**. It
goes in accepted.

**Accepted by definition, with no verdict asked for.** Every other candidate
starts unreviewed because the app proposed it; this one was drawn by the person
whose judgement the key records, so there is nobody left to ask.

**No thickness, honestly.** Two clicks give a centreline and say nothing about
how thick the wall is, so `thicknessIn` is null rather than a default — the
same reason an unpaired line records none. A guess would be in the key for
ever, and a key is what everything else is graded against.

The points snap to the drawing's own geometry like every other point this
viewer places, Shift locks to an axis, and Escape abandons a half-drawn one.
Enter and Escape are handled in the viewer rather than the panel, although
every other key in this mode is the panel's: they are about two points only the
viewer holds, and routing them through a prop would have the panel deciding
something it cannot see.

### And a census that was failing for the wrong reason

`viewerDayCensus` pinned its clock reads as `path:line`, and that broke three
times in one session — every time for an edit elsewhere in the same file that
moved the line down. A census failing for a reason it is not about teaches
people to update the number without reading why, which is the opposite of what
it is for. It now pins the file and the expression, so a NEW clock read still
fails and a moved one does not.
