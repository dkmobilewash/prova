### The landing page shows Ask C Stream doing two real tasks, and every frame of it is the product (Cyrus)
`cyrus/ask-demo`

The public page described the assistant in a sentence on the fact ticker
and nowhere else. A buyer who has just read that "the assistant can propose
a change, but only you can confirm it" has no picture of what that looks
like, and the one thing that would sell it — the card, and the tap — was
invisible outside the app. So there is now a twenty-second scene of it,
between the job-cost section and the evidence section, beside a short list
of what else the box can be told to do.

**What it shows, and why each beat is the shape it is.** Someone types
"Raise an RFI on Northgate Clinic TI — which head-of-wall detail at the
rated corridor?", the panel says "Thinking…" then "Preparing the RFI…", and
a card headed *Raise an RFI* appears with Job, Subject, Question and the
Date-sent note, an amber "Subject taken from the question" line, and the
buttons Cancel and **Open the RFI form**. A tap on that button opens the RFI
form with those fields filled and the sent date blank; a tap on **Save RFI**
saves it, and the row reads *RFI 4 · Draft*. Then someone types "Log 8 hours
for Luis Ortega on Northgate today"; a card headed *Log hours* shows Job,
Person, Date, Hours and Pay type with Cancel and **Log hours**; the tap comes
first, then "Working…", then *Done — Logged 8 hours for Luis Ortega on
Northgate Clinic TI, 2026-09-21.* Pause, loop.

The brief for this asked for "Approve" and "RFI 4 raised" on the card's
tap. That is not what the product does, and the difference is the point.
`raise_rfi` is a HANDOFF command: its button is a link to the RFI form,
and the number is issued by the form's own save, because `createRfi` throws
its refusals and a card cannot show a thrown sentence in production. A scene
in which the card's tap raised the RFI would be a promise about the write
path the product deliberately does not make. So the scene shows the form.
`log_time_entry` IS direct, and its beats are the card's own pending and
settled states. Both facts are asserted in the test, so converting either
command fails this page's build and names the beat to rewrite.

**What holds it to the code.** Every word on the card is checked against
its source rather than copied: the headings, buttons and status lines are
the registry's `title`, `button` and `verb`; the subject is what
`subjectFromQuestion` derives from the question; the date line is
`dayLabel`'s; the hours line is `parseHours`'s display; the outcome is
`executeLogTimeEntry`'s sentence. Both shown commands, and every command
the can-do list stands for, must be registered in `lib/ask/commands.ts` —
and every registered command must be listed, so a new command is a
decision about the page too. Timing is one schedule in a plain module and
`frameAt(t)` is a pure function of it, so the test can walk every
millisecond and assert that at no instant is anything shown as saved
before the tap.

**Motion, the way this page already does motion.** The server render, a
browser with no JavaScript and a reader with `prefers-reduced-motion` all
get one still frame of the scene — the settled hours card, read off the
schedule — so hydration matches and nothing moves for anyone who asked it
not to. The moving layer mounts after hydration, plays only while scrolled
into view, stops off-screen, and has a visible 44px Pause button whose
press sticks across scrolling (WCAG 2.2.2). One `requestAnimationFrame`
clock, clamped so a background tab resumes where it stopped, cancelled on
unmount; React renders on the instants something visible changes rather
than sixty times a second. The stage is `aria-hidden` and a visually
hidden paragraph, built from the same script data, describes the scene
once. No dependency, no video, no image. The tap indicator is drawn inside
the button, so it lands right at any width without measuring anything.

**Measured, not assumed.** Rendered in real Chromium at 1500, 375 and
320: `window.innerWidth` equals the device width at both phone sizes (the
layout-viewport check, not `scrollWidth`, per the 320px headline scar) and
the scene's tallest frame does not push the page sideways. The pause test
and the registry guard were each broken on purpose and watched go red.
Copy is guarded against "fully automated", "hands-free", "no data entry"
and their cousins, and the example is labelled as one, at rest.

**And one thing the demo found in the product, fixed here because the AI
lane is Cyrus's as of 2026-09-21.** The RFI card's last line said the sent
date "defaults to today", and so did the tool description the model reads
— both false since #442 made `RfiForm` start the date BLANK, where a blank
date saves a draft. A person reading the card, or asking the box what it
would do, was told that saving would stamp a send date nobody chose, on
the page whose whole subject is dates being defensible. Both now say the
date starts blank and the RFI saves as a draft until the date it was sent
is entered. The line is exported as `RFI_DATE_SENT_NOTE`; `rfis.test.ts`
pins that neither the preview nor the description says "defaults to
today" (mutation-tested: restoring the old sentence in either place goes
red), and the demo's test holds its copy equal to the constant rather than
to a second literal — the public page cannot say something the card does
not.
