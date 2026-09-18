### A finished sign-up lands on the dashboard, not a blank page (Cyrus)
`cyrus/signup-redirect`

Found walking the contractor's exact first-day path on production with a
fresh account: sign-up completed, the session existed (`Clerk.user` set),
and the tab stayed on /sign-up showing only the logo. Clerk's card renders
nothing once there is a session, and no redirect fired — the fallback was
left to the production instance's own setting.

Now `/dashboard` is the fallback redirect on `ClerkProvider` and on both
cards, and a signed-in visitor of `/sign-in`, `/sign-up` or `/` is sent to
`/dashboard` server-side. Checked on the dev server: signed in, `/sign-up`
and `/` both land on /dashboard; signed out, `/sign-up` still shows the form.
