### Site capture now records WHERE, and the GC still does not get it (Diego)
`claude/prova-company-cam-feature-6170v6`

A site photo recorded when it was taken and who took it, and nothing at all
about where. On a job with three buildings and a laydown yard that is a real
gap: "which stairwell is this" was answerable only from the caption, and only
if somebody wrote one.

Three nullable columns on `JobMedia` — `capturedLatitude`,
`capturedLongitude`, `capturedAccuracyMeters` — filled from the browser's
Geolocation API at upload time. **Nullable is the design, not a concession.**
Every capture taken before today has no location and none can be recovered, a
desktop upload has none, and a crew that taps "Don't allow" has none. So a row
without one renders as a completely ordinary row: no placeholder, no greyed-out
pin, and "No location" is a first-class half of the gallery's new filter rather
than a defect list.

**A location failure can never cost you the photo.** `requestCaptureLocation`
cannot reject and cannot hang, and the second half of that is the one worth
writing down: the Geolocation API's own `timeout` option is specified as
excluding the time spent obtaining permission, so a prompt that is DISMISSED
rather than answered calls neither callback and the option's clock never
starts. A single-timer implementation waits forever with the upload behind it.
There are two timers. All six branches — denied, dismissed, insecure page, no
hardware, no fix, timeout — end with the file uploading and a plain sentence
saying why there is no position.

**Five decimals, and an error bar beside them.** A phone reports seven, which
is centimetres — a precision the measurement does not have and which reads to
anyone looking at it as though it does. Five is ~1.1 m, still finer than the
best fix a phone produces, and it is rounded ONCE on the way in so the stored
value is the displayed value. The accuracy radius is stored for the same
reason `createdAt` is kept beside `capturedAt`: an IP-derived 2 km fix and an
8 m GPS fix are the same shape of number once written down, and only the
radius tells them apart. Above 100 m the card says to read it as the area
rather than the spot — derived on every read, so changing that judgement
changes every existing row.

**Only when the fix is contemporary with the capture**, which is what makes
the column's name true. The browser can only read a position at UPLOAD time,
and `capturedAt` can be days earlier — Friday's photos uploaded from the
office on Monday would otherwise every one be recorded in the office car park.
Confidently and specifically wrong is worse than absent on a record whose
whole value is being evidence of a place. Photos older than an hour are filed
unlocated and the upload form says so, per file.

**THE GC DOES NOT SEE COORDINATES, and this was the decision, not an
oversight.** The case for sending it is real — the GC owns the building and
knows its address. It is refused on four grounds: a phone's fix is not the
job's address but where a person was standing to a few metres at a stated
minute, so a shared gallery becomes a movement record of a crew of three; the
portal already withholds WHO took the photo, and publishing where that unnamed
person stood is the same disclosure with the identifier moved; a GPS fix
cannot answer "which floor" anyway, which is what a GC is actually asking; and
handing over five decimals that are routinely 40 m out invites an argument the
number cannot settle, the same reason `MEASURE` annotations do not measure.
Enforced the way this feature enforces every other exclusion — `PortalJobPhoto`
does not HAVE the fields and the portal's `select` does not fetch them — with
a dbtest asserting the digits of a real coordinate appear nowhere in the
serialised portal result, on a photo that IS shared.

**Nothing derived is stored**: no distance from the job, no reverse-geocoded
street, no on-site flag. There is no mapping library and no third-party
script; the card carries a plain OpenStreetMap link, so a crew member's
position reaches a tile server when somebody clicks, not on every render of a
sixty-card gallery.

The specific checks: the migration's two hand-written CHECK constraints were
mutation-tested by dropping them from a real Postgres 16 and watching three
dbtests go red naming each constraint; the falsy-boolean trap on the new
`located` filter was mutation-tested by composing it the truthy way, which
turned three read-side cases red; the portal fence was mutation-tested by
widening the projection to carry the coordinate, which turned the key-list
assertion red. Fifteen further mutations, each restoring byte-identical, are
in the PR body.

**Not done, and named rather than papered over.** There is no way to remove
or correct just the location — a coordinate a person can type is
indistinguishable from one that was measured, so the remedy for a wrong fix is
the accuracy figure beside it and the remedy for one that should not exist is
deleting the capture. The contemporary-fix rule is client-side and cannot be
enforced by the database, which is never told when the fix was taken. And
nothing here has been clicked on a real phone — the click-list is in the PR.

Also fixed, riding along: `media.prisma`'s doc comment on `contentType` still
said only photos can be uploaded and that `jobMediaKind()` "is gone". Both
were true when written and stopped being true when #230 shipped video and
voice notes; the helper has five callers now.
