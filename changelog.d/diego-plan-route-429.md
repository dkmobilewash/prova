### A big plan set opens: a signed-in user no longer costs a Clerk call per request

- `requireCompanyContext` answered every page and API request with `currentUser()`, which is a Clerk backend API call. The plan viewer reads a big set as hundreds of byte-range requests, each one through the plan route. On EH Hutto (247 MB, 142 pages) the development instance answered 429 to 41 of them, and the viewer sat on "Opening the set…" for 85 s. It now reads the session token locally and answers a user it already knows from the database, the way `requireApiContext` already did for the phone. Only adopting someone it has never seen still asks Clerk, so the verified-email gate is unchanged.
- Production takes the same route for every plan file, so this applies there too. The production instance's rate limit is higher, but every request from every user counted against it.
- Not range handling, memory or a timeout: every error in the :3010 log was a Clerk 429.
- Round 10c's trace-only "Save to labels" refusal was a tab still running the JavaScript from before :3010 was rebuilt. The rebuilt bundle does not contain the old message. A spec step now saves a trace-only sheet through the button.

Check: `pnpm test:e2e -- --takeoff-click -g "K13|K14"`. K14 fires 150 range requests at once; with the old path, 55 came back refused.

Also: since round 10b the viewer says "Opening the set…" before "Drawing…", so a test waiting for "Drawing…" to go could finish before the set had even opened. The local takeoff spec and the real-sheet spec now wait on `viewer-busy`. K5 failed once because of this (stuck on "Opening the set…" when the click came); with the fixed wait it passes in 3.9 s.
