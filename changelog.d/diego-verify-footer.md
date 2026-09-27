### The 40pt button, measured again on the phone — and a submit that needs no human (Diego)
`diego/verify-footer`

Two small things, both from the same sitting.

**#536's own entry left an open caveat and this closes it.** It said, in
as many words, that the fix "has not yet been seen on a phone… the
structure is proved, the width is not re-measured. Worth one look on the
next build before this entry is trusted about pixels." Build 2
(`6ee4c067`, the #536 squash) went to TestFlight and the look was taken,
with the same instrument and the same 395pt crop as the original
measurement so the two numbers are comparable rather than merely both
true:

| screen | secondaries | primary width | |
| --- | --- | --- | --- |
| **Time** | 2 | **361.5pt** | was **40.0pt** |
| Photos | 1 | 255.0pt | control, unchanged |
| Reports | 1 | 221.0pt | control, unchanged |

Nine times wider, essentially the full content width (395pt crop less the
16pt padding each side), and clear of both the 48pt floor and the 56pt a
primary is supposed to be. **The two controls are the half worth keeping**:
Photos and Reports were already correct before the change and the fix
touched both files, so a repair that fixed Time by breaking them would
have passed every test in #536. They share a row with their one secondary,
which is why they are narrower than Time's own row — the design, not
damage.

**And the thing that could not run unattended.** `eas submit
--non-interactive` refuses outright without `ascAppId`: *"Set ascAppId in
the submit profile (eas.json) or re-run this command in interactive
mode."* Without it, every submit opens an Apple session purely to
re-derive an identifier we already know — the "Ensuring your app exists on
App Store Connect" step — which is exactly the step no CI job and no agent
can complete.

6816567508 is an id, not a credential: it is in the App Store Connect URL
and in the public listing, which is why it can sit in the repo when
nothing else here does. It nests under `ios`; directly on the profile,
eas.json fails schema validation with `"submit.production.ascAppId" is not
allowed` — found by being refused rather than by guessing. Build 2 then
submitted with no login round-trip at all.

**The shape, because it is the same one three times tonight.** A
documented step that works right up until somebody tries to run it without
a person sitting there. `RELEASE.md` taught it as "it asks for the Apple ID,
the team, and the app id, and remembers them", which is true of a human at
a terminal and silently false of everything else.
