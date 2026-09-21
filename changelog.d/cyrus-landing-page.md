### The public landing page stopped being a headline and two buttons (Cyrus)
`cyrus/landing-page`

The founder opened app.cstream.ai on his phone and described it as "just a
blank page that says sign up or log in" that "definitely needs to look way
more professional." He was right — `apps/web/app/page.tsx` was one `<h1>`,
one line of tagline and two buttons, and it is the first thing anyone sees
who types the domain or is handed a bare link, days before a pilot with
real contractors.

Rebuilt using `/pilot` as the quality bar (not touched, not copied): a
headline that says what the product is and who it is for in one line, the
five trades it is built for named explicitly (framing & drywall, plaster,
EIFS, ceilings, fireproofing — the list CLAUDE.md itself uses), six concrete
capability cards, and an honest "C Stream is new" section instead of any
invented customer count or testimonial. No gradient hero, no stock photos,
no SaaS-startup abstraction — plain, specific, dark-theme, phone-first,
built entirely from existing design tokens (`ink`/`ink-body`/`surface`/
`line-card`/`brand`) and the existing wordmark.

Every capability claim carries the same receipt discipline `/pilot` uses —
a comment naming the file that actually does it (`lib/certified-payroll.ts`,
`lib/apprentice-ratio.ts`, `lib/pay-application.ts`, ARCHITECTURE.md's
unified `Job`/`JobLineItem` object, and so on).

**The one behavior that had to survive the rewrite: a signed-in visitor is
still redirected to `/dashboard`, never seeing the marketing page.**
Preserved exactly (`auth()` from `@clerk/nextjs/server`, `redirect()` from
`next/navigation`), and mutation-tested both directions in
`app/page.test.ts` — removing the redirect line is caught (the signed-in
test fails), and inverting the condition to redirect when signed OUT is
also caught (the signed-out test fails). 2 mutants requested, 2 caught.

The visitor-facing markup moved out of `app/page.tsx` into
`components/LandingPage.tsx` — not a stylistic choice, a build requirement.
Next's page-file type checking rejects any named export from a page module
besides the ones it recognises (`metadata`, `generateMetadata`, the
default), so a `LandingPage` export sitting beside `HomePage` typechecks
clean and fails only at `next build`: "LandingPage is not a valid Page
export field." `app/page.tsx` now exports only `metadata` and the default
guard; the static content lives where it can be rendered directly with no
Clerk mock and no request scope, the same proof `/pilot`'s own test uses.
