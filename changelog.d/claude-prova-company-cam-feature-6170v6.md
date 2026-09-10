### A walk-through you can hear — video and voice notes on a job (Diego)
`claude/prova-company-cam-feature-6170v6`

Site capture has been photos since #195. A photo shows a condition; it
cannot show a foreman saying what is behind the wall before it closes,
which is the thing an argument with a GC actually turns on. Video and voice
notes ship here, through the same gallery, the same tags, and the same
opt-in client sharing.

**NO MIGRATION, and that is the design rather than luck.** `contentType`
already stores any string and `byteSize` is an `Int` with room to spare, so
nothing about the schema changes. The model comment on that column
predicted this exactly — it says the column stays because it is "the ONE
value a video branch would be derived from on the day video ships, and a
stored `kind` beside it would be a second source of truth that could
disagree with it". So `jobMediaKind()` derives photo/video/audio at read
time and nothing stores it, which is this schema's standing rule about
derived state applied to the case it was written for.

**The recorder is the phone's own, not `MediaRecorder`, and that is the
main decision.** An in-page record button was the obvious build and is the
wrong one: what a browser recorder produces is whatever that browser
supports, and Android Chrome produces `audio/webm`, which Safari cannot
play at all. The natural implementation would therefore have shipped voice
notes that a GC on an iPhone hears as silence — by default, not as an edge
case. A file input with `accept` opens the camera or the voice recorder on
both iOS and Android, and what those produce (`.mov`, `.m4a`) plays
essentially everywhere. The cost is honest: on a desktop this is a file
picker rather than a record button, and a desktop is not where a
walk-through gets narrated.

**Formats that do not play everywhere are flagged, not refused.** A `.mov`
does not play in desktop Chrome; a `webm`/`ogg` voice note does not play in
Safari. Refusing them would refuse what the crew's own phone produced, so
`jobMediaPlaybackWarning` says so on the card AND in the share
confirmation — before the decision to show a GC, rather than after the GC
reports a blank box. Not solved, and saying so: solving it means
transcoding.

**The upload token got tighter, not looser.** It used to sign the whole
five-type allowlist under one 25MB ceiling. Three kinds cannot share one
number — a 200MB video cap applied to every token would let a 200MB
"photo" through — so the client now declares its content type and the
token is minted for THAT ONE TYPE at THAT kind's cap. Declaring
`video/mp4` to earn the bigger ceiling and then sending something else does
not work: the store enforces the signed list and refuses the PUT
(`@vercel/blob@2.8.0` maps exactly that response at
`dist/chunk-YYMLUMXS.js:653`). Large uploads use `multipart: true`, which
splits, parallelises and retries parts rather than losing one long PUT to a
truck driving out of range at 90%.

Two claims in the old code were checked rather than inherited, because both
had discouraged this work. `job-media.ts` said video "needs multipart
upload, a poster frame, and a storage budget nobody has signed off":
multipart is one boolean on the `upload()` call already in use, and a
poster is not required to render video (`preload="metadata"` shows a first
frame; generating a real poster would need ffmpeg in a serverless function,
which is the actual reason there is none). Only the budget was real, and it
is now decided — 25MB a photo, 200MB a video, 25MB a voice note, sized
against the clip that settles an argument rather than against the format.

**Verified against a real Postgres, and the portal test earned its keep.**
`job-media-sharing.dbtest.ts` asserts the exact key set the GC receives,
with a comment saying it exists to fail "on the day somebody widens the
type or the select". It did, naming `kind` — the check working rather than
being in the way — so the list is widened by exactly one field rather than
relaxed. Two new cases prove a shared video reaches the portal AS a video
and an unshared one does not reach it at all, and the derivation was
mutation-tested: forcing the portal to answer "photo" turns the first red
and restores byte-identical.

`FEATURE-AUDIT.md` also gains the row for client-shared galleries that
#214 never added — the file that is meant to be the source of truth for
what is built was understating by a whole shipped feature.
