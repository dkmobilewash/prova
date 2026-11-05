### A new sign-up lands on /welcome, and the new-customer walk is a spec

Signing up through Clerk's real form, a brand-new owner landed on a blank `/dashboard`
and was never asked its trade. The network showed `/dashboard`, then `/welcome`, then
`/dashboard` again: the dashboard's redirect to the onboarding screen raced Clerk's own
refresh after sign-up, and the redirect was dropped. 2 of 2 sign-ups did it. A later
sign-in redirected correctly, which is why no spec saw it — every spec signs in.

A sign-up now lands on `/welcome` itself (the provider's `signUpFallbackRedirectUrl`
and the sign-up card's `fallbackRedirectUrl`). `/welcome` already sends anyone it is
not for — an invited member, an owner who has answered — on to `/dashboard`. Sign-in
still lands on `/dashboard`, where the gate catches an owner who has not answered.
`onboardingGateCensus.test.ts` pins both destinations.

`e2e/local/new-customer-walk.local.spec.ts` is the walk that found it: sign-up to a
signing link on a real 65-sheet set, following the stepper's Next button, timing each
step and writing STUCK where the next move is not on the screen. The findings are in
`coordination/new-job-walkthrough-v2.md`.
