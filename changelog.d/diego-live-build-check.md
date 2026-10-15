### The live-build check, and the hostname that cost an evening — AUDIT, docs-only

Two CLAUDE.md entries under Traps. No code changes.

**The page names its own commit.** Every `<script>` Next emits carries a `dpl=`
parameter whose value is the first 32 characters of the git commit SHA —
confirmed on four deployments (three production, one preview), exact every time.
One line in a console, or `curl | grep`, answers "am I on the new build" with no
dashboard, no token and no MCP.

It outranks every other check in that section because an alias listing, a
project's `latestDeployment` and a deployment's `state` are all assertions
*about* the serving, and this is the serving. The file already has two entries
about a cached `status` field and about green checks on a commit nobody asked
about; this is the first instrument there that is immune to both.

A browser tester produced it unprompted, as circumstantial evidence while
correctly stopping at step 0 of a click-list. It was the fact that cracked the
afternoon.

**And the failure it cracked.** Vercel's GitHub integration refused three
successive merges to `main` with "Deployment rate limited — retry in 24 hours"
(the Hobby daily deploy cap), so each landed with no deployment at all. A direct
deployment request was then accepted *while the cap was still refusing pushes* —
the cap applies to the git integration, not the API, which is the escape hatch
worth recording. That request shipped a commit two newer merges had superseded
and took the production alias, moving production back to its own parent commit
for 26 minutes. Nobody rolled anything back.

The expensive part was a falsifier aimed at the wrong hostname: it read
`cstream.ai` and `www.cstream.ai`, found their `updatedAt` frozen, and reported
production unchanged. The app runs on `app.cstream.ai`, whose `updatedAt` had
moved. Sound reasoning, wrong host, and a tester sent at a build that did not
exist yet — the fourth member of the "name the endpoint, never say 'the
database'" family, after the two Neon projects and the three Clerk instances.
