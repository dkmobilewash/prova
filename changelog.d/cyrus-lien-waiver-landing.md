### A front door for the free lien waiver generator (Cyrus)
`cyrus/lien-waiver-landing`

New public page at `/lien-waiver`, in the main landing page's own theme,
type and motion, and deliberately naming no state so every sub reads it as
theirs. A waiver that fills itself in (the hero), what a lien waiver is in
three cards, the four waiver types with a risk meter and when to use each,
three steps, the retainage warning, nine "before you sign" questions with full answers, and sign-up
repeated down the page with "Sign in" as a quiet link. Every button goes to
sign-up until Diego's generator is live; `CTA_HREF` in
`components/LienWaiverLanding.tsx` is the one line to change.

Below the hero, each section's cards rise in one after another, the risk
meters fill segment by segment, icons land with a small overshoot and the
warning triangle shakes once. All of it is keyed on Reveal's `visible`
state, so it plays only for a section confirmed off-screen and then
scrolled to — never on something already being read. Transform and opacity
only, finished at rest, reduced motion respected in JS and CSS, nothing
changes height. Its CSS lives in its own files because
`globals.motion.test.ts` counts the animation rules in `globals.css`; the
page test guards the new file the same way. Registered in
`e2e/lib/publicRoutes.ts` so the public browser suite walks it.
