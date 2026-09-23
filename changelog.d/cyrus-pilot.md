### One public link for WWCCA early testers (Cyrus)
`cyrus/pilot`

Cyrus is demoing to Nick, the door into the Western Wall & Ceiling
Contractors Association — whose members are the actual target market. What
was missing was the thing to hand over afterwards: one shareable link a
member can open on a phone, read in a minute, and sign up from.

`/pilot` (https://app.cstream.ai/pilot) is that page. Public on purpose —
outside the `(app)` group, absent from middleware's protected list the
same way `/privacy` and `/terms` are, with a comment in `middleware.ts`
saying the absence is deliberate. It is a static server component: no
database read, no client JS, dark-theme tokens from `tailwind.config.ts`,
laid out phone-first because that is where a trade-association link gets
opened.

Every feature claim on it was checked against FEATURE-AUDIT.md and the
code before it was written, and each bullet in the page source carries its
receipt in a comment — certified payroll (WH-347-style,
`lib/certified-payroll.ts`), trust-fund remittance
(`lib/fringe-remittance.ts`), apprentice ratios (`lib/apprentice-ratio.ts`,
per day), dispatch slips (`DispatchSlip`), prevailing wage, lien
deadlines, RFIs/submittals, AIA-style pay apps (`lib/pay-application.ts`)
and retainage. Nothing invented: this audience runs certified payroll
monthly and would know.

The specific check: `apps/web/app/pilot/page.test.ts` renders the page
with NO Clerk mock and no request scope — an auth call would throw, so the
passing render is proof the page works signed out, not a claim about it.
It also pins the `/sign-up` href, refuses auth/db imports and `data-tour`
anchors (a public page has no walkthrough), and greps `/pilot` out of
middleware's protected list so a later "protect everything" sweep fails
loudly here.

No support address is printed even though `SUPPORT_EMAIL` wiring exists —
the page points at the in-app Help button instead, which reaches the same
inbox without publishing an address.
