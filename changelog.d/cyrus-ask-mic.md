### Dictation in the Ask box

A mic button beside the Ask input, for the requests nobody types standing on
a deck with gloves on. Browser-native speech recognition — no API, no upload,
no audio leaves the machine, no new permission from us; the browser asks for
the microphone itself and the person can see and revoke it in their own
browser chrome.

**It renders only where the browser has the API.** `speechRecognitionFrom`
returns null on Firefox and on the server, and no button is drawn at all. A
mic that is visible and does nothing reads as broken rather than as
unavailable, and the person concludes the feature is faulty instead of absent.
That decision is a test, not a comment: a mutation making support
unconditional turns it red.

**Why there is a module and not just a button.** Everything that can be wrong
about dictation is invisible on screen, and a `.tsx` file cannot be unit-tested
in this repo. So the arithmetic is in `components/speechInput.ts` and the
component is six lines of markup plus a toggle. Three things it gets right that
a naive version does not:

- **Chunks append; they do not replace.** Speech recognition hands back a final
  phrase at a time, so "log eight hours for Tino on Riverside" can arrive as
  three results. Assigning each one leaves only the last phrase — the most
  confident-looking way to lose most of what somebody said.
- **Interim results are dropped.** They rewrite themselves as the recogniser
  changes its mind, and appending them puts the same words in the box three
  times while the person watches their own sentence stutter.
- **The cap is reported, never silent.** The input carries `maxLength={1000}`
  and a typed field enforces that visibly — characters stop appearing and the
  typist stops. Dictation has no such feedback: the speaker keeps talking, the
  browser keeps producing text, and a naive append drops the tail with nothing
  on screen. `mergeDictation` returns `truncated`, the panel says *"That is as
  much as the box holds. Send this, then dictate the rest as a second
  question."*, and it cuts at a WORD boundary — a half word reads as a bug the
  person will try to fix, where a short sentence plus a warning reads as a
  limit they reached.

It also never trims what the person typed to make room for speech they cannot
see: with no room for one more word, their own text stands and `truncated` is
true.

**The cap is asserted in both places.** `ASK_MAX_LENGTH` is read back out of
`AskPanel.tsx`'s own `maxLength` in the test, because a cap enforced in two
files is a cap enforced in neither.

Four mutations applied and watched RED, then restored green (21/21):
dropping the `isFinal` guard, replacing instead of appending, dropping the
truncation report, and claiming support unconditionally.

**Clicked live** on a dev server at `/dashboard`, signed in: the button renders
between the input and Ask, its accessible name is "Dictate your question",
tapping it flips the name to "Stop dictating" and prints *"Listening — say it,
then tap the mic again."*, and tapping again clears both.

**Not verified, and not claimed:** no actual speech was dictated into it — the
click test proves the control, its labels and its two states, not a
transcription. And the mic is stopped on unmount and on submit, which was
reasoned about rather than observed; a live mic the person cannot see is the
one failure here worse than the feature not working.

**Known limitation, deliberately not fixed in this branch:** the Ask box is a
single-line `<input>`, so a long dictated request scrolls out of sight as it
lands. Dictation is exactly the case that makes that hurt, and the fix is a
different change to a shared component.
