### Walks and e2e runs delete the Clerk users they create, and a daily sweep collects the rest (Diego)
`diego/clerk-user-cleanup`

The striking-jaybird development Clerk instance caps at 100 users, and every local walk or e2e spec
that signs up a fresh company left its user behind. At the cap, sign-up fails, and both the walks and
CI's persona seeding broke more than once (79 users were deleted by hand on 2026-11-11). Every such
spec now takes its address from `throwawayEmail()` and deletes that one user in an `afterAll`, which
runs on pass or fail. It deletes only its own user, never "everything since I started", which would
take a peer session's walk user mid-run. A cleanup error is a warning, never a red run. A run killed
outright (the 25-minute hard limit) skips `afterAll`, so `.github/workflows/clerk-sweep.yml` deletes
throwaway users older than 24 h every day. A throwaway is exactly `<word>-<timestamp>+clerk_test@example.com`,
so the `e2e-*` personas and any other address are never touched, and both the sweep and the per-run
delete refuse anything but an `sk_test_` key. Test: `e2e/lib/throwawayUsers.test.ts`.
