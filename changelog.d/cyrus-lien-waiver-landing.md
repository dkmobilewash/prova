### A front door for the free lien waiver generator (Cyrus)
`cyrus/lien-waiver-landing`

New public page at `/lien-waiver`, in the main landing page's own theme,
type and motion. Mostly picture: a waiver that fills itself in (the hero),
the four states as tiles, the four waiver types with a risk meter on each,
three steps, and the one warning that matters — a final waiver signed with
retainage still held. Every button goes to sign-up until Diego's generator
is live; `CTA_HREF` in the page is the one line to change.

The animation follows the main page's rules: transform and opacity only,
finished at rest, reduced motion respected in both JS and CSS, a fixed-height
stage so nothing below it moves. Its CSS lives in its own file because
`globals.motion.test.ts` counts the animation rules in `globals.css`.
Registered in `e2e/lib/publicRoutes.ts` so the public browser suite walks it.
