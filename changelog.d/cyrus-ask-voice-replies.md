### Ask C Stream can read its answers aloud, and hold a spoken conversation (Cyrus)
`cyrus/ask-voice-replies`

The Ask box could already take a question by voice; now it can answer by
voice too. "Read replies aloud" (off by default, remembered per browser)
speaks each finished answer with the browser's own speech synthesis — no
new dependency, no paid voice API, nothing leaves the device. "Talk it
through" is the hands-free loop: it listens, sends when you pause, reads the
answer, and listens again. It ends on the button, after two turns in a row
with nothing heard, when the answer is a card or a question to look at, or
when the panel closes.

What is spoken is not the raw answer. Links keep their words and drop the
URL, tables and code are skipped (they are on screen), and anything past
~600 characters becomes "…the rest is on screen" — a phone reading a whole
table aloud on a deck is the failure this exists to avoid. The text is only
spoken once the answer is whole, so the voice never says a first clause the
rest of the answer corrects.

Controls render only where the browser has the API (Firefox has no speech
recognition, so it gets the read-aloud toggle and no conversation button).
Checks: `components/speechOutput.test.ts` (stripping, the cap, storage that
throws) and `components/askVoice.test.tsx`, which renders the real panel and
fails if closing it no longer calls `speechSynthesis.cancel()` — verified by
removing that line and watching it go red.
