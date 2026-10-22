### A plan set can be read from this machine, for reviewing confidential drawings

Making an answer key means opening a client's issued drawings in the workspace.
The only way to get a plan into the app was to upload it, which puts it in blob
storage that preview deployments can reach — the blob-store half of the rule
CLAUDE.md states for the database, and the thing `e2e/lib/blobStub.ts` exists to
avoid.

A plan may now be recorded as `local:<name>`, resolved inside
`TAKEOFF_LOCAL_PLAN_DIR` and read from disk. The sheets never move.

**The gate, and why each half is there.** The folder must be configured —
unset, which is every deployment, and nothing is read. A production build
refuses outright whatever is configured, because a server that can be told to
read its own filesystem by a value in the database is a file-disclosure bug and
an environment variable is a thin thing to stand between those two states. And
the resolved path must sit inside the folder, `..` resolved first and compared
by prefix WITH the separator, so `/plans-secret` cannot pass as a child of
`/plans`.

**It does not touch `isBlobStorageUrl`.** That guard is what stops the server
fetching an address a caller once chose, and weakening it for a local
convenience would trade a real protection for one. This is a separate scheme
the blob path never sees; every other URL still goes through the same checks.

Range requests are honoured for local files too, which is not a nicety: one of
these sets is 342 MB, and reading it whole on every request is the difference
between a viewer that pages and one that stalls.

Proved by use rather than by the tests alone: the real ingest runner read
**29 of 29** pages of one set and **175 of 175** of the other from disk, with
no failures, through `readPlanBytes` unchanged apart from the new branch.

Also here: `?key=1` opens the takeoff workspace straight into answer-key
review, so a session starts on the right sheet in one link rather than
remembering a toggle that changes what every colour on the overlay means. And
two scripts for setting a review up — both refuse any database that is not
local, because seeding a client's plan set into the demo project, which every
preview reads, is exactly the failure this arrangement exists to prevent.
