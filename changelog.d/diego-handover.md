### What actually changed, in plain English (Diego)
`diego/handover`

The phone can be handed to a crew member so they put their own hours in.

The gap is C15/D-13 and it is not a small one: most hangers and tapers do
not carry a company phone, so their hours are typed by a foreman from
memory at the end of the day. That is where a day gets rounded, misheard
or argued about on Friday. The obvious alternative — each worker signing
into their own account on a borrowed phone — means typing a password into
a co-worker's device over a network that is usually not there, and a
minute of Clerk round-trips each way. Not that.

So the FOREMAN stays signed in and hands the phone across. While it is in
somebody else's hands the app is exactly one screen: their own hours for
today on this job, and a place to sign. When they hand it back, it
returns to the foreman's app.

**What it produces is made of models that already exist**, which is the
whole reason this is small: a TimeEntry carrying that person's
`crewMemberId`, and a TimesheetSignoff they signed. Both go through the
same offline queue as everything else, so it works in the basement it was
built for, and neither invents a new idea of who did what. The signed-in
session is still the foreman's — `crewMemberId` is the only thing saying
the time is Ana's, which is why it is not optional on that write.

**Three rails, and each is a one-line edit from being gone**, so each has
a test that reads the source rather than trusting it:

  - the route is registered with the header and the SWIPE-BACK off;
  - the screen navigates to exactly one destination, the foreman's app,
    and only after the handover has been ended;
  - the flag lives on DISK, and the root layout reads it before it draws
    anything — because a crew member who wants out of a screen force-
    quits, and anything held in React state would hand them the phone.

That third mutation is worth recording: the first version of the test
asserted the gate EXISTED, so deleting the two JSX tags and leaving the
function behind passed. "Written, documented, and never called" is a shape
CLAUDE.md already names, and this file reproduced it on its own first
mutation run. It now asserts the app's screens are inside the gate.

**The PIN is optional and says so.** Without one, handing the phone back
is a two-step confirm and anybody holding it can do that — the protection
is that the foreman is standing there, and the screen says as much. With
one, the phone does not come back until the foreman types it. It is a lock
on a screen and not a security boundary: it sits in the clear beside the
flag, and the session on the device is the foreman's either way. A stored
PIN that is not four digits is ignored rather than honoured, because a
lock nobody can open is worse than no lock on somebody's own phone.

**What Gap 7 asked for that was already built**, said plainly rather than
rebuilt: the audit opens "Two tabs: Jobs and More. No Today screen" — five
tabs and Home landed in #388. Its sequencing list is items 1-5, of which
the queue drain is #403, the camera/GPS/queued upload is #195 and #354,
and the offline read cache and drawings are #398-#401. What is left of
Gap 7 after this is the role shell (the phone still shows every screen to
everyone and ignores the capability model the server enforces) and
Spanish on the field screens.
