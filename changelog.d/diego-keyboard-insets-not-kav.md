### My first keyboard fix moved the content by zero pixels (Diego)
`diego/keyboard-insets-not-kav`

No migration. One prop replaces a wrapper.

**#645 DID NOTHING, AND EVERY CHECK WAS GREEN.** It wrapped this screen in a
`KeyboardAvoidingView` with `behavior="padding"` — the pattern
`app/sign-in.tsx` uses and the obvious thing to reach for. Build 15 went to a
real phone and **the content did not move by a single pixel**: the note field
and its Place button sat under the keyboard exactly as before, which is a
screenshot rather than an opinion.

`lib/sheet-note-keyboard.test.ts` passed throughout. It asserted the component
was present, and it was.

> A census can tell you the code is THERE.
> It can never tell you a framework HONOURS it.

That is this repo's own rule, written down after three expo-router header fixes
shipped green and rendered nothing. **This is the fourth, and I wrote the
sentence a week ago and then did it anyway.**

**WHY IT FAILED, so the next person does not try it a second time.** A
`KeyboardAvoidingView` measures the keyboard against the WINDOW while its own
frame starts below the navigator's header, so it wants a
`keyboardVerticalOffset` that nothing inside the file can state. `sign-in.tsx`,
where the same pattern demonstrably works, **has no header at all** — the one
difference that matters, and the reason copying it was not the safe move it
looked like.

`automaticallyAdjustKeyboardInsets` needs none of that: UIScrollView adjusts
its own contentInset for the keyboard and brings the first responder into view.
Confirmed to exist in the installed react-native 0.86.3 rather than assumed —
`Libraries/Components/ScrollView/ScrollView.js:190`.

The focus scroll moved from 120ms to **400ms**, which was a second bug in the
first attempt: the inset arrives with the keyboard's own ~250ms animation, so
scrolling at 120ms scrolled to the OLD end — the covered position. The native
inset brings the FIELD into view; the delayed scroll is for the Place button
below it, which first-responder scrolling does not promise.

| mutation | result |
| --- | --- |
| control | green |
| keyboard insets removed | **RED** |
| **the failed fix reinstated** | **RED** |
| persist-taps dropped (first tap eaten) | **RED** |
| the focus scroll removed | **RED** |

The second of those is the one worth having. A `KeyboardAvoidingView` is what
anybody would try next, it is what this app does elsewhere, and it was measured
not to work here — so the test now refuses it by name and says why.

**STILL UNVERIFIED, and the loop is the problem.** This cannot be checked
without another build, and build 15 sat in EAS's submission queue for nearly
three hours. **This app has no `expo-updates`** — no OTA channel, no
`runtimeVersion` — so every JS-only fix costs a full build and a submission.
Adding it would turn this loop from hours into about a minute, and there are now
several unverified mobile changes stacked up behind it.

44 files / 361 tests and 16 / 78, both mobile suites, `expo lint` clean.
